/**
 * worker 悬浮面板: 锚定在画布节点下方, 显示该 Agent 的全部任务(当前工作 / 已完成)。
 * 面板外点击或 Esc 收起; 缩放/平移/数据刷新时跟随节点重定位(不跳变)。
 */
import { Tag } from "antd";
import { useEffect, useRef } from "react";
import {
  avatarBg, chipMeta, closeWorkerPage, nodeRects, openDrawerTask, rel, roster, sortTasks,
  workerState, zhState,
} from "./state";
import { useStore } from "./useStore";

const WP_POP_W = 400;

const TAG_COLOR: Record<string, string> = {
  running: "processing",
  blocked: "error",
  review: "warning",
  ready: "success",
  idle: "default",
  stale: "volcano",
};

export default function WorkerPop() {
  const snap = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const name = snap.workerPageId;
  const w = name ? roster().workers.find((p) => p.name === name) : undefined;
  const st = name ? workerState(name) : undefined;

  // 节点消失(比如 profile 被删)时自动收起
  useEffect(() => {
    if (name && !w) closeWorkerPage();
  }, [name, w]);

  // 重新测量节点(缩放/平移后坐标已变)再定位悬浮面板
  useEffect(() => {
    if (!name) return;
    const measure = (): void => {
      const el = document.getElementById("wnode-" + name);
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width > 0)
        nodeRects[name] = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height };
      const rc = nodeRects[name];
      const pop = ref.current;
      if (!rc || !pop) return;
      const popH = Math.min(460, window.innerHeight - 90);
      let left = rc.cx - WP_POP_W / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - WP_POP_W - 8));
      let top = rc.cy + rc.h / 2 + 10;
      if (top + popH > window.innerHeight - 8) top = Math.max(8, rc.cy - rc.h / 2 - popH - 10);
      pop.style.left = left + "px";
      pop.style.top = top + "px";
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [name, snap.version]);

  // 点击面板外任意处(节点除外, 节点自身是开关)收起面板
  useEffect(() => {
    if (!name) return;
    const h = (e: MouseEvent): void => {
      const t = e.target as HTMLElement;
      if (ref.current?.contains(t)) return;
      if (t.closest && t.closest(".wnode")) return;
      closeWorkerPage();
    };
    document.addEventListener("click", h);
    return () => document.removeEventListener("click", h);
  }, [name]);

  if (!name || !w || !st) return <div id="wpPop" ref={ref} />;

  const now = st.now;
  const sub: string[] = [];
  if (w.description) sub.push(w.description);
  if (st.act) sub.push("dispatcher 活跃 (pid " + (st.act.pid ?? "?") + ")");
  if (st.hbAge != null) sub.push("最近心跳 " + rel(st.hbAge));
  if (st.counts.running) sub.push(st.counts.running + " 张在做");
  if (st.counts.blocked) sub.push(st.counts.blocked + " 张阻塞");
  if (st.counts.review) sub.push(st.counts.review + " 张待审");

  const act = sortTasks(st.ts).filter((t) => t.status !== "done");
  const done = st.ts
    .filter((t) => t.status === "done")
    .sort((a, b) => (b.completed_at || 0) - (a.completed_at || 0));
  const last24 = done.filter((t) => t.completed_at && now - t.completed_at < 86400).length;

  const row = (t: (typeof act)[number], isDone: boolean) => {
    const meta = isDone ? `✓ 完成 ${rel(now - (t.completed_at || now))}` : chipMeta(t, st, now);
    return (
      <div
        key={t.id}
        className={"wp-row st-" + (isDone ? "done" : t.status)}
        onClick={() => openDrawerTask(t.id)}
        title={t.title + "  (点击查看详情)"}
      >
        <div className="wp-r-main">
          <div className="wp-r-title">{t.title}</div>
          {isDone && t.latest_summary ? (
            <div className="wp-r-sum" title={String(t.latest_summary)}>
              {String(t.latest_summary).slice(0, 140)}
            </div>
          ) : null}
        </div>
        <div className="wp-r-meta">{meta}</div>
      </div>
    );
  };

  return (
    <div id="wpPop" className="open" ref={ref}>
      <div className="wp-head">
        <span className={"chipdot " + st.state} />
        <span className="n-avatar" style={{ background: avatarBg(name) }}>
          {(name.trim().charAt(0) || "?").toUpperCase()}
        </span>
        <span className="wp-name">{name}</span>
        <Tag color={TAG_COLOR[st.state] || "default"} style={{ marginInlineEnd: 0 }}>
          {zhState(st.state).replace(/^[^ ]+ /, "")}
        </Tag>
        <button className="wp-close" title="关闭 (Esc)" onClick={closeWorkerPage}>
          ✕
        </button>
      </div>
      <div className="wp-sub">{sub.join("  ·  ") || "当前无任务"}</div>
      <div className="wp-body">
        <div className="wp-sec">
          <h3>
            当前工作<span className="wp-n">{act.length}</span>
          </h3>
          {act.length ? act.map((t) => row(t, false)) : <div className="empty">当前没有进行中的任务</div>}
        </div>
        <div className="wp-sec">
          <h3>
            已完成<span className="wp-n">{done.length}</span>（24h: {last24}）
          </h3>
          {done.length ? done.map((t) => row(t, true)) : <div className="empty">暂无已完成任务</div>}
        </div>
      </div>
    </div>
  );
}