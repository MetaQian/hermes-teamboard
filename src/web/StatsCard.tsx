/**
 * 团队状态卡: ECharts 环形图(总体状态) + 条形图(各 worker 在做/完成)。
 * 配色取 theme.ts 的双主题 ChartPalette, 主题切换时整体重设(notMerge)。
 */
import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";
import { LAST, allTasks, roster, teamCounts, type Task } from "./state";
import { CHARTS, PALETTES, type ThemeMode, type ChartPalette } from "./theme";
import { useStore } from "./useStore";

const CHART_FONT = '-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif';

let donut: echarts.ECharts | null = null;
let bars: echarts.ECharts | null = null;
let barsWorkerN = 0;
let lastNames: string[] = [];
let lastPer: Record<string, { run: number; done24: number }> = {};
let initTimer: number | null = null;

function tooltip(pal: ChartPalette, trigger: "item" | "axis", formatter?: string): any {
  const base: any = {
    trigger,
    backgroundColor: pal.tooltipBg,
    borderColor: pal.tooltipBorder,
    textStyle: { color: pal.tooltipText, fontSize: 11.5, fontFamily: CHART_FONT },
  };
  if (formatter) base.formatter = formatter;
  if (trigger === "axis")
    base.axisPointer = { type: "shadow", shadowStyle: { color: pal.axisPointer } };
  return base;
}

function barsOption(names: string[], per: Record<string, { run: number; done24: number }>, pal: ChartPalette): any {
  return {
    textStyle: { fontFamily: CHART_FONT },
    animationDurationUpdate: 500,
    grid: { left: 6, right: 34, top: 10, bottom: 4, containLabel: true },
    tooltip: tooltip(pal, "axis"),
    xAxis: {
      type: "value",
      minInterval: 1,
      axisLabel: { color: pal.axisLabel, fontSize: 10, fontFamily: CHART_FONT },
      splitLine: { lineStyle: { color: pal.splitLine, type: "dashed" } },
    },
    yAxis: {
      type: "category",
      data: names,
      axisLabel: { color: pal.axisLabelDim, fontSize: 11, fontFamily: CHART_FONT },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    series: [
      {
        name: "在做", type: "bar", stack: "t", barWidth: 7,
        itemStyle: { color: pal.barRun, borderRadius: [0, 3, 3, 0] },
        data: names.map((n) => (per[n] && per[n].run) || 0),
      },
      {
        name: "完成24h", type: "bar", stack: "t", barWidth: 7,
        itemStyle: { color: pal.barDone, borderRadius: [0, 3, 3, 0] },
        data: names.map((n) => (per[n] && per[n].done24) || 0),
      },
    ],
  };
}

function computePer(): Record<string, { run: number; done24: number }> {
  const { byA, unassigned } = allTasks();
  const { workers } = roster();
  const now = (LAST.board && LAST.board.now) || Math.floor(Date.now() / 1000);
  const per: Record<string, { run: number; done24: number }> = {};
  for (const w of workers) per[w.name] = { run: 0, done24: 0 };
  const count = (t: Task, key?: string): void => {
    if (key) per[key] = per[key] || { run: 0, done24: 0 };
    if (t.status === "running") {
      if (key) per[key].run++;
    } else if (t.status === "done" && t.completed_at && now - t.completed_at < 86400) {
      if (key) per[key].done24++;
    }
  };
  for (const k in byA) for (const t of byA[k]) count(t, k);
  for (const t of unassigned) count(t);
  return per;
}

/** full=true(主题切换)时整体重设, 否则只按 worker 数变化决定 notMerge */
function applyCharts(mode: ThemeMode, full: boolean): void {
  if (!donut || !bars) return;
  const pal = CHARTS[mode];
  const st = PALETTES[mode];
  const c = teamCounts();
  const donutData = [
    { value: c.run, name: "进行中", itemStyle: { color: st.run } },
    { value: c.blocked, name: "阻塞", itemStyle: { color: st.block } },
    { value: c.review, name: "待审核", itemStyle: { color: st.review } },
    { value: c.ready, name: "就绪", itemStyle: { color: st.ready } },
    { value: c.queued, name: "排队", itemStyle: { color: st.todo } },
    { value: c.done24, name: "完成24h", itemStyle: { color: st.done } },
  ];
  donut.setOption(
    {
      tooltip: tooltip(pal, "item", "{b}: {c} ({d}%)"),
      series: [
        { data: [{ value: 1, itemStyle: { color: pal.track } }] },
        {
          data: donutData,
          itemStyle: { borderColor: pal.sliceBorder, borderWidth: 2, borderRadius: 4 },
        },
      ],
    },
    full,
  );

  const per = computePer();
  const names = [...roster().workers.map((w) => w.name)].reverse();
  lastNames = names;
  lastPer = per;
  const notMerge = full || names.length !== barsWorkerN;
  barsWorkerN = names.length;
  bars.setOption(barsOption(names, per, pal), notMerge);
}

function initChartsOnce(): void {
  const dEl = document.getElementById("scDonut");
  const bEl = document.getElementById("scBars");
  if (!dEl || !bEl || donut || bars) return;
  donut = echarts.init(dEl as HTMLElement);
  donut.setOption({
    textStyle: { fontFamily: CHART_FONT },
    animation: true,
    series: [
      {
        // 底圈: 全空闲时仍有一个浅环
        type: "pie", silent: true, radius: ["48%", "72%"], center: ["50%", "52%"],
        label: { show: false }, labelLine: { show: false },
        data: [{ value: 1, itemStyle: { color: CHARTS[THEME].track } }],
      },
      {
        type: "pie", radius: ["48%", "72%"], center: ["50%", "52%"],
        label: { show: false }, labelLine: { show: false },
        itemStyle: { borderColor: CHARTS[THEME].sliceBorder, borderWidth: 2, borderRadius: 4 },
        data: [],
        animationDurationUpdate: 600,
      },
    ],
  });
  bars = echarts.init(bEl as HTMLElement);
  bars.setOption(barsOption([], {}, CHARTS[THEME]));
  applyCharts(THEME, true);
}

let THEME: ThemeMode = "dark";

export function resizeCharts(): void {
  donut?.resize();
  bars?.resize();
}

export default function StatsCard() {
  const snap = useStore();
  const [collapsed, setCollapsed] = useState(false);
  THEME = snap.theme;
  const c = teamCounts();

  // 等首帧布局完成再初始化图表
  useEffect(() => {
    initTimer = window.setTimeout(initChartsOnce, 120);
    return () => {
      if (initTimer != null) window.clearTimeout(initTimer);
    };
  }, []);

  useEffect(() => {
    if (donut && bars) applyCharts(snap.theme, false);
  }, [snap.version]);

  useEffect(() => {
    if (donut && bars) applyCharts(snap.theme, true);
    else initChartsOnce(); // 首帧前就切主题时兜底初始化
  }, [snap.theme]);

  return (
    <div id="statsCard" className={collapsed ? "collapsed" : ""}>
      <div
        className="sc-head"
        onClick={() =>
          setCollapsed((v) => {
            const nv = !v;
            if (!nv) setTimeout(() => resizeCharts(), 30);
            return nv;
          })
        }
      >
        <span>📊 团队状态</span>
        <span className="sc-tg">{collapsed ? "▸" : "▾"}</span>
      </div>
      <div className="sc-body">
        <div className="sc-donut-wrap">
          <div id="scDonut" />
          <div className="sc-center">
            <b>{c.run + c.blocked + c.review + c.ready}</b>
            <span>进行中</span>
          </div>
        </div>
        <div id="scBars" />
      </div>
    </div>
  );
}