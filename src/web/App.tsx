/**
 * App 外壳: antd ConfigProvider 驱动暗黑/亮色(darkAlgorithm),
 * 顶栏(连接状态/团队计数/时钟/主题与刷新控制) + 画布 + 侧栏 + 浮层。
 */
import { Button, ConfigProvider, Space, theme as antdTheme } from "antd";
import { useEffect, useState } from "react";
import CanvasBoard from "./CanvasBoard";
import DetailDrawer from "./DetailDrawer";
import SettingsModal from "./SettingsModal";
import SidePanel from "./SidePanel";
import WorkerPop from "./WorkerPop";
import {
  allTasks, closeWorkerPage, hostport, openDrawerCron, openSession,
  openWorkerPage, setChatAll, setConfigOpen, setTheme, startPolling,
  stopPolling, teamCounts, togglePause,
} from "./state";
import { applyStatusVars, DARK_TOKEN, LIGHT_TOKEN } from "./theme";
import { useStore } from "./useStore";

/** ?layout=1 调试: 在页面上打印关键元素几何, 用于无头验证布局不跳动 */
function layoutDump(): void {
  const sel = [
    ".tb-header", ".tb-main", "#canvasWrap", ".tb-aside",
    "#cronJobs", "#unassigned", "#chatSessions", ".side-hint", "#statsCard", ".legend",
  ];
  const lines = sel.map((s) => {
    const el = document.querySelector(s) as HTMLElement | null;
    if (!el) return s + " -> (missing)";
    const r = el.getBoundingClientRect();
    return `${s} -> x=${Math.round(r.left)} y=${Math.round(r.top)} w=${Math.round(r.width)} h=${Math.round(r.height)}`;
  });
  const pre = document.createElement("pre");
  pre.id = "layoutDump";
  pre.textContent = "layout @ " + new Date().toLocaleTimeString("zh-CN", { hour12: false }) + "\n" + lines.join("\n");
  pre.style.cssText =
    "position:fixed;left:8px;top:56px;z-index:99999;background:#000000e6;color:#7CFC00;" +
    "font:11px/1.5 monospace;white-space:pre-wrap;border:1px solid #7CFC0055;padding:6px;";
  document.body.appendChild(pre);
}

export default function App() {
  const snap = useStore();
  const dark = snap.theme === "dark";
  const c = teamCounts();
  const unassignedN = allTasks().unassigned.length;
  const h = snap.health;
  const connText = h?.connected
    ? "已连接 " + hostport(h.base_url)
    : h?.error || "连接中…";

  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    applyStatusVars(snap.theme);
    const t = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.theme]);

  useEffect(() => {
    startPolling();
    return () => stopPolling();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && snap.workerPageId) closeWorkerPage();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [snap.workerPageId]);

  /* 深链接: ?worker= ?session= ?cron= ?chatall=1 ?layout=1 ?theme= (theme 由 pre-paint 处理) */
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const w = q.get("worker");
    if (w) window.setTimeout(() => openWorkerPage(w), 1000);
    const s = q.get("session");
    if (s) window.setTimeout(() => openSession(s), 1500);
    const c = q.get("cron");
    if (c) window.setTimeout(() => openDrawerCron(c), 1500);
    if (q.get("chatall") === "1" && !snap.chatShowAll) setChatAll(true);
    if (q.get("layout") === "1") window.setTimeout(layoutDump, 3000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ConfigProvider
      theme={{
        cssVar: true,
        algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: dark ? DARK_TOKEN : LIGHT_TOKEN,
      }}
    >
      <div className="tb-app">
        <header className="tb-header">
          <div className="logo">
            ⬡ Hermes <span>多 Agent 组织看板</span>
          </div>
          <span className={"conn " + (h?.connected ? "on" : "off")}>
            <span className="dot" />
            {connText}
          </span>
          <div className="stats">
            <span className="s-run">
              进行中 <b>{c.run}</b>
              {c.stale ? <span className="stale-mark" title="疑似卡死"> ⚠{c.stale}</span> : null}
            </span>
            <span className="s-block">阻塞 {c.blocked}</span>
            <span className="s-review">待审核 {c.review}</span>
            <span className="s-ready">就绪 {c.ready}</span>
            <span className="s-unassigned">未分配 {unassignedN}</span>
            <span className="s-done">完成(24h) {c.done24}</span>
          </div>
          <span className="spacer" />
          <span id="clock" className="mono">
            {clock.toLocaleTimeString("zh-CN", { hour12: false })}
          </span>
          <Space size={8}>
            <Button size="small" onClick={() => setTheme(dark ? "light" : "dark")}>
              {dark ? "☀ 亮色" : "🌙 暗色"}
            </Button>
            <Button size="small" onClick={togglePause}>
              {snap.paused ? "▶ 继续刷新" : "⏸ 暂停刷新"}
            </Button>
            <Button size="small" onClick={() => setConfigOpen(true)}>
              ⚙ 接口设置
            </Button>
          </Space>
        </header>
        <div className="tb-main">
          <CanvasBoard />
          <SidePanel />
        </div>
        <WorkerPop />
        <DetailDrawer />
        <SettingsModal />
      </div>
    </ConfigProvider>
  );
}