/**
 * 详情抽屉: antd Drawer 承载 任务详情 / 聊天会话详情。
 * 打开期间随轮询自动刷新; Esc 由 antd keyboard 默认行为关闭。
 */
import { Drawer, Spin, Tag } from "antd";
import { useEffect, useRef, useState } from "react";
import {
  STALE_MIN, closeDrawer, fetchJSON, profLabel, rel, srcLabel,
  type Session, type SessionMessage, type TaskDetail,
} from "./state";
import { useStore } from "./useStore";

const TAG_COLOR: Record<string, string> = {
  running: "processing",
  blocked: "error",
  review: "warning",
  ready: "success",
  todo: "default",
  scheduled: "default",
  triage: "purple",
  done: "default",
  stale: "volcano",
};

const STATUS_ZH_LOCAL: Record<string, string> = {
  running: "进行中", blocked: "阻塞", review: "待审核", ready: "就绪",
  scheduled: "已排期", todo: "排队", triage: "分诊", done: "已完成",
};

export default function DetailDrawer() {
  const snap = useStore();
  const taskOpen = !!snap.drawerTaskId;
  const sessOpen = !!snap.drawerSessionId;

  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null);
  const [taskErr, setTaskErr] = useState("");
  const [sess, setSess] = useState<Session | null>(null);
  const [msgs, setMsgs] = useState<SessionMessage[]>([]);
  const [sessErr, setSessErr] = useState("");
  const [loading, setLoading] = useState(false);
  const msgListRef = useRef<HTMLDivElement>(null);

  /* ---------- 任务详情(打开期间随轮询刷新) ---------- */
  useEffect(() => {
    const id = snap.drawerTaskId;
    if (!id) {
      setTaskDetail(null);
      setTaskErr("");
      return;
    }
    let cancelled = false;
    fetchJSON<TaskDetail>("/proxy/api/plugins/kanban/tasks/" + encodeURIComponent(id))
      .then((d) => {
        if (!cancelled) {
          setTaskDetail(d);
          setTaskErr("");
        }
      })
      .catch((e) => {
        if (!cancelled) setTaskErr(String((e as Error).message ?? e));
      });
    return () => {
      cancelled = true;
    };
  }, [snap.drawerTaskId, snap.version]);

  /* ---------- 会话详情(打开期间随轮询刷新) ---------- */
  useEffect(() => {
    const id = snap.drawerSessionId;
    if (!id) {
      setSess(null);
      setMsgs([]);
      setSessErr("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchJSON<Session>("/proxy/api/sessions/" + encodeURIComponent(id)),
      fetchJSON<{ messages?: SessionMessage[] }>(
        "/proxy/api/sessions/" + encodeURIComponent(id) + "/messages",
      ).then((r) => r.messages || []),
    ])
      .then(([s, m]) => {
        if (cancelled) return;
        setSess(s);
        setMsgs(m);
        setSessErr("");
      })
      .catch((e) => {
        if (!cancelled) setSessErr(String((e as Error).message ?? e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [snap.drawerSessionId, snap.version]);

  useEffect(() => {
    const el = msgListRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, sessOpen]);

  /* ---------- 标题与徽章 ---------- */
  let title = "详情";
  let sub: React.ReactNode = null;
  let body: React.ReactNode = null;

  if (taskOpen && snap.drawerTaskId) {
    const t = (taskDetail && taskDetail.task) || {};
    const now = (snap.last.board && snap.last.board.now) || Math.floor(Date.now() / 1000);
    title = (t.title as string) || "—";
    const stale =
      t.status === "running" &&
      (t.last_heartbeat_at || t.started_at) != null &&
      now - ((t.last_heartbeat_at || t.started_at) as number) > STALE_MIN;
    const badgeCls = stale ? "stale" : (t.status ?? "");
    sub = (
      <>
        <Tag color={TAG_COLOR[badgeCls] || "default"} style={{ marginInlineEnd: 6 }}>
          {stale ? "疑似卡死" : STATUS_ZH_LOCAL[badgeCls] || t.status || "?"}
        </Tag>
        <Tag style={{ marginInlineEnd: 6 }}>{t.assignee || "未分配"}</Tag>
        {t.priority ? <Tag style={{ marginInlineEnd: 6 }}>优先级 {t.priority}</Tag> : null}
        <span className="mono" style={{ fontSize: 11, opacity: 0.7 }}>{t.id || ""}</span>
      </>
    );
    if (taskErr) body = <pre className="tb-pre">加载失败: {taskErr}</pre>;
    else if (taskDetail) {
      const secs: React.ReactNode[] = [];
      const kv: [string, string][] = [];
      if (t.created_at) kv.push(["创建", rel(now - t.created_at)]);
      if (t.started_at) kv.push(["开始", rel(now - t.started_at)]);
      if (t.completed_at) kv.push(["完成", rel(now - t.completed_at)]);
      if (t.last_heartbeat_at) kv.push(["心跳", rel(now - t.last_heartbeat_at)]);
      if (t.workspace_path) kv.push(["工作区", String(t.workspace_path)]);
      if (t.completion_contract) kv.push(["完成约定", String(t.completion_contract)]);
      if (kv.length)
        secs.push(
          <div className="tb-sec" key="kv">
            <h3>时间线</h3>
            <div className="kv">
              {kv.map(([k, v]) => (
                <div key={k} style={{ display: "contents" }}>
                  <span className="k">{k}</span>
                  <span>{v}</span>
                </div>
              ))}
            </div>
          </div>,
        );
      if (t.block_reason)
        secs.push(
          <div className="tb-sec" key="br">
            <h3 style={{ color: "var(--c-block)" }}>阻塞原因</h3>
            <pre className="tb-pre">{t.block_reason}</pre>
          </div>,
        );
      else if (t.status === "blocked")
        secs.push(
          <div className="tb-sec" key="br">
            <h3 style={{ color: "var(--c-block)" }}>阻塞</h3>
            <pre className="tb-pre">{`block_kind: ${t.block_kind || "—"}\n复发次数: ${t.block_recurrences ?? 0}`}</pre>
          </div>,
        );
      if (t.last_failure_error)
        secs.push(
          <div className="tb-sec" key="err">
            <h3 style={{ color: "var(--c-stale)" }}>最近失败</h3>
            <pre className="tb-pre">{t.last_failure_error}</pre>
          </div>,
        );
      if (t.latest_summary || t.result)
        secs.push(
          <div className="tb-sec" key="sum">
            <h3>结果摘要</h3>
            <pre className="tb-pre">{t.latest_summary || t.result}</pre>
          </div>,
        );
      if (t.body && t.status !== "done")
        secs.push(
          <div className="tb-sec" key="body">
            <h3>卡片正文</h3>
            <pre className="tb-pre">{String(t.body).slice(0, 1200)}{String(t.body).length > 1200 ? " …" : ""}</pre>
          </div>,
        );
      const evs = taskDetail.events || [];
      if (evs.length) {
        const hbCnt = evs.filter((e) => (e.kind || e.type) === "heartbeat").length;
        secs.push(
          <div className="tb-sec" key="ev">
            <h3>事件流 (最近 12 / 心跳共 {hbCnt})</h3>
            {evs
              .slice(-12)
              .reverse()
              .map((e, i) => {
                const kind = e.kind || e.type || "?";
                const ts = e.created_at ? rel(now - e.created_at) : "";
                let extra = "";
                if (kind === "completed") extra = String((e.payload && e.payload.summary) || "").slice(0, 60);
                if (kind === "commented") extra = "评论 by " + String((e.payload && e.payload.author) || "?");
                if (kind === "blocked") extra = String((e.payload && e.payload.reason) || "").slice(0, 60);
                return (
                  <div className="ev" key={i}>
                    <b>{kind}</b>
                    <span>{ts}</span>
                    <span style={{ color: "var(--tb-text-tertiary, #5a6580)" }}>{extra}</span>
                  </div>
                );
              })}
          </div>,
        );
      }
      const cts = (taskDetail.comments || []).slice(-3).reverse();
      if (cts.length)
        secs.push(
          <div className="tb-sec" key="ct">
            <h3>评论 (最近 3)</h3>
            {cts.map((c, i) => {
              const bodyTxt = String(c.body ?? "");
              return (
                <pre className="tb-pre" key={i} style={{ marginBottom: 8 }}>
                  {`[${c.author ?? "?"}]\n${bodyTxt.slice(0, 400)}`}
                  {bodyTxt.length > 400 ? " …" : ""}
                </pre>
              );
            })}
          </div>,
        );
      const dg = ((snap.last.diag && snap.last.diag.diagnostics) || []).find(
        (x) => x.task_id === (t.id ?? ""),
      );
      if (dg)
        secs.push(
          <div className="tb-sec" key="dg">
            <h3 style={{ color: "var(--c-block)" }}>诊断</h3>
            {dg.diagnostics.map((x, i) => (
              <pre className="tb-pre" key={i} style={{ color: "var(--c-block)" }}>
                {(x.title || "") + "\n" + String(x.detail ?? "").slice(0, 300)}
              </pre>
            ))}
          </div>,
        );
      body = secs.length ? secs : <pre className="tb-pre">暂无更多详情</pre>;
    } else body = <Spin style={{ margin: "40px auto" }} />;
  }

  if (sessOpen && snap.drawerSessionId) {
    if (sessErr) {
      title = "会话详情";
      body = <pre className="tb-pre">加载失败: {sessErr}</pre>;
    } else if (sess) {
      const nowS = Date.now() / 1000;
      const la = sess.last_activity_at ? Number(sess.last_activity_at) : null;
      const sa = sess.started_at ? Number(sess.started_at) : null;
      title = String(sess.title || sess.preview || sess.display_name || "会话详情");
      sub = (
        <>
          <Tag color={sess.is_active ? "processing" : "success"} style={{ marginInlineEnd: 6 }}>
            {sess.is_active ? "运行中" : "空闲"}
          </Tag>
          <Tag style={{ marginInlineEnd: 6 }}>{profLabel(String(sess.profile ?? ""))}</Tag>
          <Tag style={{ marginInlineEnd: 6 }}>
            {srcLabel(String(sess.source ?? ""))}
            {sess.chat_type === "group" ? " · 群" : sess.chat_type === "dm" ? " · 单聊" : ""}
          </Tag>
          {sess.model ? <Tag style={{ marginInlineEnd: 6 }}>{String(sess.model)}</Tag> : null}
          <span className="mono" style={{ fontSize: 11, opacity: 0.7 }}>{sess.id}</span>
        </>
      );
      const secs: React.ReactNode[] = [];
      const kv: [string, string][] = [];
      if (sa != null) kv.push(["开始", rel(nowS - sa)]);
      if (la != null)
        kv.push([
          "最近活动",
          rel(nowS - la) + (sess.last_activity_description ? ` · ${sess.last_activity_description}` : ""),
        ]);
      if (sess.message_count != null) kv.push(["消息数", String(sess.message_count)]);
      if (sess.tool_call_count != null) kv.push(["工具调用", String(sess.tool_call_count)]);
      if (sess.api_call_count != null) kv.push(["API 调用", String(sess.api_call_count)]);
      if (kv.length)
        secs.push(
          <div className="tb-sec" key="kv">
            <h3>会话</h3>
            <div className="kv">
              {kv.map(([k, v]) => (
                <div key={k} style={{ display: "contents" }}>
                  <span className="k">{k}</span>
                  <span>{v}</span>
                </div>
              ))}
            </div>
          </div>,
        );
      const tail = msgs.slice(-8);
      if (tail.length) {
        secs.push(
          <div className="tb-sec" key="msg">
            <h3>最近消息 (最后 {tail.length} 条)</h3>
            <div className="msglist" ref={msgListRef}>
              {tail.map((m) => {
                const role =
                  m.role === "user"
                    ? "👤 你"
                    : m.role === "assistant"
                      ? "🤖 agent"
                      : "🔧 " + String(m.tool_name || "tool");
                const t = m.timestamp
                  ? new Date(Number(m.timestamp) * 1000).toLocaleTimeString("zh-CN", { hour12: false })
                  : "";
                let content = String(m.content ?? "");
                if (content.length > 500) content = content.slice(0, 500) + " …";
                return (
                  <div className={"msg m-" + String(m.role)} key={m.id}>
                    <div className="msg-h">
                      <b>{role}</b>
                      <span>{t}</span>
                    </div>
                    <pre>{content}</pre>
                  </div>
                );
              })}
            </div>
          </div>,
        );
      } else {
        secs.push(
          <div className="tb-sec" key="msg">
            <pre className="tb-pre">暂无消息</pre>
          </div>,
        );
      }
      body = secs;
    } else body = <Spin style={{ margin: "40px auto" }} spinning={loading || true} />;
  }

  return (
    <Drawer
      open={taskOpen || sessOpen}
      onClose={() => closeDrawer()}
      width={400}
      styles={{ body: { padding: "14px 16px 24px" } }}
      title={
        <div>
          <div>{title}</div>
          {sub ? <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4 }}>{sub}</div> : null}
        </div>
      }
    >
      {body}
    </Drawer>
  );
}