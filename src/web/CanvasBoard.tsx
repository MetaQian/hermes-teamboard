/**
 * 组织画布: chief + worker 节点、任务挂卡、状态连线与流光动画。
 * 渲染部分沿用命令式 DOM/SVG(性能与现有视觉不变), 颜色全部走 CSS 变量
 * (antd token + --c-* 状态色), 主题切换时自动跟随; 数据变化触发重绘。
 */
import { useEffect, useRef } from "react";
import { select, zoom, zoomIdentity } from "d3";
import {
  chipMeta, chatShowAll, knownChips, nodeRects, openDrawerTask, openWorkerPage, closeWorkerPage,
  emit, profLabel, recentSessions, rel, roster, sortTasks, workerState, zhState,
  avatarBg, type Task, type WorkerState,
} from "./state";
import { PALETTES, type ThemeMode } from "./theme";
import { useStore } from "./useStore";
import StatsCard from "./StatsCard";

/* ---------- 光点动画 ---------- */

interface PulseSpec {
  n: number;
  dir: 1 | -1;
  color: string;
  r: number;
  speed: number;
  glow: boolean;
}
interface PulseDot {
  el: SVGCircleElement;
  phase: number;
}
interface Pulse {
  path: SVGPathElement;
  dir: 1 | -1;
  speed: number;
  dots: PulseDot[];
}

interface Engine {
  pulses: Pulse[];
  pathEdges: Map<string, SVGPathElement>;
  nodeEls: Record<string, HTMLDivElement>;
  rafStarted: boolean;
  zoomBehavior: any;
}

const $ = (s: string): HTMLElement => document.querySelector(s) as HTMLElement;

function addPulses(path: SVGPathElement, specs: PulseSpec[]): void {
  const svg = document.getElementById("edges") as unknown as SVGSVGElement;
  for (const s of specs) {
    const grp: PulseDot[] = [];
    for (let i = 0; i < s.n; i++) {
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle") as SVGCircleElement;
      c.setAttribute("r", String(s.r));
      c.setAttribute("fill", s.color);
      c.setAttribute("opacity", s.glow ? "1" : "0.55");
      if (s.glow) c.style.filter = "drop-shadow(0 0 4px " + s.color + ")";
      svg.appendChild(c);
      grp.push({ el: c, phase: i / s.n });
    }
    ENGINE.pulses.push({ path, dir: s.dir, speed: s.speed, dots: grp });
  }
}

function midPoint(path: SVGPathElement): { x: number; y: number } {
  try {
    const l = path.getTotalLength();
    return path.getPointAtLength(l / 2);
  } catch {
    return { x: 0, y: 0 };
  }
}

function tickPulses(t: number): void {
  for (const p of ENGINE.pulses) {
    let len = 0;
    try {
      len = p.path.getTotalLength();
    } catch {
      continue;
    }
    for (const d of p.dots) {
      const k = ((t / 1000) * p.speed + d.phase) % 1;
      const kk = p.dir === 1 ? k : 1 - k;
      let pt: DOMPoint;
      try {
        pt = p.path.getPointAtLength(kk * len);
      } catch {
        continue;
      }
      d.el.setAttribute("cx", String(pt.x));
      d.el.setAttribute("cy", String(pt.y));
    }
  }
  if (ENGINE.pulses.length) requestAnimationFrame(tickPulses);
  else ENGINE.rafStarted = false;
}

let ENGINE: Engine = {
  pulses: [],
  pathEdges: new Map(),
  nodeEls: {},
  rafStarted: false,
  zoomBehavior: null,
};

/** name 为 null 时高亮全部连线(chief 悬停)。 */
function highlightEdges(name: string | null, on: boolean): void {
  for (const [n, p] of ENGINE.pathEdges) {
    if (name == null || n === name) p.classList.toggle("hl", on);
    else p.classList.toggle("dim", on);
  }
}

function makeChip(t: Task, st: WorkerState | null, forceStale: boolean): HTMLDivElement {
  const key = t.id;
  const isNew = !knownChips.has(key);
  knownChips.add(key);
  const c = document.createElement("div");
  c.className = "chip st-" + (forceStale ? "stale" : t.status) + (isNew ? " new" : "");
  c.dataset.id = t.id;
  const now = (st && st.now) || 0;
  c.innerHTML =
    `<div class="c-title"></div><div class="c-meta"></div>`;
  c.querySelector(".c-title")!.textContent = t.title;
  c.querySelector(".c-meta")!.textContent = chipMeta(t, st, now);
  c.title = t.title + "  (点击查看详情)";
  c.onclick = () => openDrawerTask(t.id);
  return c;
}

/* ---------- 整帧渲染 ---------- */

function renderBoard(): void {
  const { chief, workers } = roster();
  const wrap = document.getElementById("canvasWrap") as HTMLElement;
  const W = wrap.clientWidth;
  const H = wrap.clientHeight;
  const nodes = document.getElementById("nodes") as HTMLElement;
  const svg = document.getElementById("edges") as unknown as SVGSVGElement;
  svg.setAttribute("viewBox", "0 0 " + W + " " + H);
  nodes.innerHTML = "";
  svg.innerHTML = "";
  ENGINE.pulses = [];
  ENGINE.pathEdges.clear();
  for (const k in ENGINE.nodeEls) delete ENGINE.nodeEls[k];

  const laneW = W / Math.max(workers.length, 1);
  const chiefY = 86;
  const workerY = Math.max(248, H * 0.3);
  const chiefPos = { x: W / 2, y: chiefY };
  const workerPos = workers.map((w, i) => ({ x: laneW * (i + 0.5) + 6, y: workerY }));
  const pal = PALETTES[THEME_NOW];

  /* ---- edges (先画线, 节点覆盖其上) ---- */
  workers.forEach((w, i) => {
    const st = workerState(w.name);
    const x2 = workerPos[i].x;
    const y2 = workerY - 52;
    const x1 = chiefPos.x;
    const y1 = chiefPos.y + 46;
    const my = (y1 + y2) / 2;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path") as SVGPathElement;
    path.setAttribute("d", `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`);
    path.setAttribute("class", "edge " + st.state);
    svg.appendChild(path);
    ENGINE.pathEdges.set(w.name, path);
    // 线旁标签: 当前主任务
    const main =
      st.ts.find((t) => t.status === "running") ||
      st.ts.find((t) => t.status === "blocked") ||
      st.ts.find((t) => t.status === "review");
    if (main) {
      const tx = (x1 + x2) / 2 + (x2 >= x1 ? 10 : -10);
      const ty = my - 8;
      const lab = document.createElementNS("http://www.w3.org/2000/svg", "text") as SVGTextElement;
      lab.setAttribute("class", "edge-label");
      lab.setAttribute("x", String(tx));
      lab.setAttribute("y", String(ty));
      lab.setAttribute("text-anchor", x2 >= x1 ? "start" : "end");
      lab.textContent = main.title.length > 16 ? main.title.slice(0, 16) + "…" : main.title;
      svg.appendChild(lab);
    }
    // 动态光点
    if (st.state === "running") {
      addPulses(path, [
        { n: 3, dir: 1, color: pal.run, r: 3.8, speed: 0.55, glow: true },
        { n: 2, dir: -1, color: pal.blue2, r: 2.6, speed: 0.4, glow: false },
        { n: 1, dir: 1, color: pal.spark, r: 2, speed: 0.95, glow: true }, // 快速亮火花
      ]);
    } else if (st.state === "review") {
      addPulses(path, [{ n: 2, dir: -1, color: pal.review, r: 3, speed: 0.35, glow: false }]);
    } else if (st.state === "ready") {
      addPulses(path, [{ n: 1, dir: 1, color: pal.ready, r: 2.4, speed: 0.25, glow: false }]);
    }
    if (st.state === "blocked" || st.state === "stale") {
      const mid = midPoint(path);
      const badge = document.createElement("div");
      badge.className = "warn-badge";
      badge.textContent = st.state === "stale" ? "⌛" : "⚠";
      badge.style.left = mid.x + "px";
      badge.style.top = mid.y + "px";
      nodes.appendChild(badge);
    }
  });

  /* ---- chief 节点 ---- */
  const states = workers.map((w) => workerState(w.name));
  const activeCnt = states.filter((s) => ["running", "stale"].includes(s.state)).length;
  const blockedCnt = states.filter((s) => s.state === "blocked").length;
  const activeChats = recentSessions(chatShowAll).filter((s) => s.is_active);
  const chiefChatN = activeChats.filter((s) => profLabel(String(s.profile ?? "")) === "chief").length;
  const chiefEl = document.createElement("div");
  chiefEl.className = "node st-chief" + (activeCnt || blockedCnt || chiefChatN ? " busy" : "");
  chiefEl.style.left = chiefPos.x + "px";
  chiefEl.style.top = chiefPos.y + "px";
  chiefEl.innerHTML =
    `<div class="n-head"><span class="n-avatar" style="background:${avatarBg(chief.name, true)}"></span>
      <div><div class="n-name"></div><div class="n-sub"></div></div></div>
     <div class="n-status"><span class="chipdot ${activeCnt ? "running" : blockedCnt ? "blocked" : ""}"></span><span class="n-status-txt"></span></div>
     <div class="n-act">每 30 分钟自动巡检 · 审核质量门禁</div>
     ${chiefChatN ? `<div class="n-chat"></div>` : ""}`;
  chiefEl.querySelector(".n-avatar")!.textContent = (chief.name.trim().charAt(0) || "?").toUpperCase();
  chiefEl.querySelector(".n-name")!.textContent = chief.name + " · chief";
  chiefEl.querySelector(".n-sub")!.textContent = chief.description || "总调度 · 派单与审核";
  const stx = chiefEl.querySelector(".n-status-txt") as HTMLElement;
  if (activeCnt) stx.innerHTML = `调度中 · <b style="color:var(--c-run)">${activeCnt}</b> 人在干活`;
  else if (blockedCnt) stx.innerHTML = `有 <b style="color:var(--c-block)">${blockedCnt}</b> 人阻塞, 待处理`;
  else if (chiefChatN) stx.innerHTML = `聊天工作中 · <b style="color:var(--c-run)">${chiefChatN}</b> 个会话`;
  else stx.textContent = "团队空闲";
  const nchat = chiefEl.querySelector(".n-chat");
  if (nchat) nchat.textContent = `🗨 ${chiefChatN} 个聊天会话活跃 — 点击右侧列表查看详情`;
  chiefEl.onmouseenter = () => highlightEdges(null, true);
  chiefEl.onmouseleave = () => highlightEdges(null, false);
  nodes.appendChild(chiefEl);

  /* ---- worker 节点 + 任务挂卡 ---- */
  workers.forEach((w, i) => {
    const st = states[i];
    const x = workerPos[i].x;
    const el = document.createElement("div");
    el.className = "node wnode st-" + st.state;
    el.id = "wnode-" + w.name;
    el.style.left = x + "px";
    el.style.top = workerY + "px";
    el.onclick = () => (lastWorker === w.name ? closeWorkerPage() : openWorkerPage(w.name));
    el.onmouseenter = () => highlightEdges(w.name, true);
    el.onmouseleave = () => highlightEdges(w.name, false);
    el.title = w.name + "（点击查看该 Agent 全部任务, 再次点击收起）";
    let actLine = "当前无任务";
    if (st.state === "blocked" && st.run) actLine = "⏸ " + String(st.run.block_reason || "阻塞").slice(0, 46);
    else if (st.run) actLine = "▸ " + st.run.title.slice(0, 46);
    else if (st.act) actLine = "▸ dispatcher 活跃 (pid " + (st.act.pid ?? "?") + ")";
    else if (st.counts.review) actLine = "⏳ 有待审件, 等 chief";
    const chatN = activeChats.filter((s) => profLabel(String(s.profile ?? "")) === w.name).length;
    el.innerHTML =
      `<div class="n-head"><span class="n-avatar" style="background:${avatarBg(w.name)}"></span>
        <div><div class="n-name"></div><div class="n-sub"></div></div></div>
       <div class="n-status"></div>
       <div class="n-act"></div>
       ${st.diag ? `<div class="n-diag"></div>` : ""}
       ${chatN ? `<div class="n-chat"></div>` : ""}`;
    el.querySelector(".n-avatar")!.textContent = (w.name.trim().charAt(0) || "?").toUpperCase();
    el.querySelector(".n-name")!.textContent = w.name;
    const sub = el.querySelector(".n-sub") as HTMLElement;
    sub.textContent = w.description || "—";
    sub.title = w.description || "";
    const ns = el.querySelector(".n-status") as HTMLElement;
    ns.textContent = zhState(st.state);
    if (st.state === "running") ns.append(` · 心跳 ${st.hbAge == null ? "—" : rel(st.hbAge)}`);
    if (st.counts.running) {
      const b = document.createElement("span");
      b.style.color = "var(--c-run)";
      b.textContent = ` · ${st.counts.running} 张在做`;
      ns.append(b);
    }
    if (st.counts.blocked) {
      const b = document.createElement("span");
      b.style.color = "var(--c-block)";
      b.textContent = ` · ${st.counts.blocked} 张阻塞`;
      ns.append(b);
    }
    if (st.counts.review) {
      const b = document.createElement("span");
      b.style.color = "var(--c-review)";
      b.textContent = ` · ${st.counts.review} 张待审`;
      ns.append(b);
    }
    el.querySelector(".n-act")!.textContent = actLine;
    const diagEl = el.querySelector(".n-diag");
    if (diagEl && st.diag) diagEl.textContent = `⚠ ${st.diag.diagnostics[0].title || "异常"}`;
    const chatEl = el.querySelector(".n-chat");
    if (chatEl) chatEl.textContent = `🗨 ${chatN} 个聊天会话活跃`;
    ENGINE.nodeEls[w.name] = el;
    nodes.appendChild(el);

    /* 挂卡 lane */
    const lane = document.createElement("div");
    lane.className = "lane";
    lane.style.left = x + "px";
    lane.style.top = workerY + 58 + "px";
    const ts = sortTasks(st.ts).filter((t) => t.status !== "done");
    if (ts.length === 0) {
      const e = document.createElement("div");
      e.className = "empty-lane";
      e.textContent = "（无任务）";
      lane.appendChild(e);
    } else {
      for (const t of ts) lane.appendChild(makeChip(t, st, st.state === "stale" && t.status === "running"));
    }
    nodes.appendChild(lane);
  });

  // 测量各 worker 节点屏幕位置(含当前缩放/平移, 供悬浮面板锚定)
  for (const w of workers) {
    const el = ENGINE.nodeEls[w.name];
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0)
      nodeRects[w.name] = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height };
  }
  if (!ENGINE.rafStarted && ENGINE.pulses.length) {
    ENGINE.rafStarted = true;
    requestAnimationFrame(tickPulses);
  }
}

/* ---------- 组件 ---------- */

let THEME_NOW: ThemeMode = "dark";
let lastWorker: string | null = null;

export default function CanvasBoard() {
  const snap = useStore();
  const wrapRef = useRef<HTMLDivElement>(null);
  const inited = useRef(false);

  THEME_NOW = snap.theme;
  lastWorker = snap.workerPageId;

  useEffect(() => {
    if (inited.current) return;
    inited.current = true;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const vp = document.getElementById("viewport") as HTMLElement;
    const zoomB = zoom<HTMLDivElement, unknown>()
      .scaleExtent([0.5, 2.5])
      .filter((ev: any) => {
        const t = (ev.target || wrap) as Element;
        // 悬浮卡片与按钮上的交互不触发缩放
        if (t.closest && t.closest("#statsCard, #btnZoomReset")) return false;
        if (ev.type === "wheel") return true; // 滚轮随处可缩放
        if (ev.type === "dblclick") return false;
        // 鼠标拖拽: 仅从空白画布开始平移
        return !t.closest(".node, .chip, .lane");
      })
      .on("zoom", (ev: any) => {
        const t = ev.transform;
        vp.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.k})`;
        const btn = document.getElementById("btnZoomReset") as HTMLElement | null;
        if (btn) btn.textContent = "⌂ " + Math.round(t.k * 100) + "%";
        emit(); // 缩放/平移后让悬浮面板跟随重定位
      });
    ENGINE.zoomBehavior = zoomB;
    (select(wrap) as any).call(zoomB).on("dblclick.zoom", null);

    const ro = new ResizeObserver(() => renderBoard());
    ro.observe(wrap);
    return () => {
      ro.disconnect();
      inited.current = false;
    };
  }, []);

  // 数据 / 主题变化时重绘整帧
  useEffect(() => {
    if (inited.current) renderBoard();
  }, [snap.version, snap.theme]);

  return (
    <div id="canvasWrap" ref={wrapRef}>
      <div id="viewport">
        <svg id="edges" />
        <div id="nodes" />
      </div>
      <button
        id="btnZoomReset"
        title="重置视图（滚轮缩放, 空白处拖拽平移）"
        onClick={() => {
          const wrap = wrapRef.current;
          if (!wrap || !ENGINE.zoomBehavior) return;
          (select(wrap) as any).transition().duration(300).call(ENGINE.zoomBehavior.transform, zoomIdentity);
        }}
      >
        ⌂ 100%
      </button>
      <StatsCard />
    </div>
  );
}