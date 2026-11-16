/**
 * 右栏: 定时任务(cron) + 未分配/待分诊 + 聊天工作(非 Kanban 会话) + 图例。
 * 24h/全部 切换用 antd Segmented; 列表行样式沿用画布体系(主题变量跟随 antd 算法)。
 */
import { Segmented, Tooltip } from "antd";
import {
  READY_MIN, allTasks, chipMeta, openDrawerCron, openDrawerTask, openSession, profLabel,
  recentSessions, rel, setChatAll, sortTasks, srcLabel, whenIso,
} from "./state";
import { useStore } from "./useStore";

const LEGEND: [string, string][] = [
  ["进行中", "run"], ["阻塞", "block"], ["待审核", "review"], ["就绪", "ready"],
  ["排队", "todo"], ["分诊", "triage"], ["疑似卡死", "stale"], ["已完成", "done"],
];

export default function SidePanel() {
  const snap = useStore();
  const { unassigned } = allTasks();
  const ts = sortTasks(unassigned);
  const now = (snap.last.board && snap.last.board.now) || Math.floor(Date.now() / 1000);
  const list = recentSessions(snap.chatShowAll);
  const nowS = Date.now() / 1000;
  // 定时任务: 启用的在前, 按名字排序
  const crons = [...snap.last.crons].sort(
    (a, b) => Number(b.enabled ?? false) - Number(a.enabled ?? false) || a.name.localeCompare(b.name),
  );

  return (
    <aside className="tb-aside">
      <div className="side-head">⏰ 定时任务 <span className="count">{crons.length}</span></div>
      <div id="cronJobs">
        {crons.length === 0 ? (
          <div className="empty">🗓 没有定时任务<br />Hermes cron 任务会显示在这里</div>
        ) : (
          crons.map((j) => {
            const on = !!j.enabled;
            const lastTs = j.last_run_at ? new Date(j.last_run_at).getTime() / 1000 : null;
            const mode = j.script
              ? "📜 " + j.script
              : j.skill
                ? "🧩 " + j.skill
                : "🤖 agent";
            const meta =
              profLabel(String(j.profile ?? "default")) +
              " · " +
              (j.schedule_display || "—") +
              " · " +
              mode;
            const when =
              (on ? "下次 " + whenIso(j.next_run_at, nowS) : "已暂停") +
              (lastTs != null
                ? " · 上次 " + rel(nowS - lastTs) + (j.last_status === "error" ? " ✗ 失败" : j.last_status === "ok" ? " ✓" : "")
                : "");
            return (
              <div
                key={j.id}
                className={"cj-row " + (on ? "cj-on" : "cj-off")}
                title={j.name + "  (点击查看详情)"}
                onClick={() => openDrawerCron(j.id)}
              >
                <span className="cj-dot" />
                <div className="cj-main">
                  <div className="cj-title">
                    {j.name}
                    {(j.failure_streak ?? 0) >= 3 ? <span className="cj-warn" title={"连续失败 " + j.failure_streak + " 次"}>⚠</span> : null}
                  </div>
                  <div className="cj-meta">{meta}</div>
                  <div className="cj-meta">{when}</div>
                  {j.last_error ? <div className="cj-err">{String(j.last_error).slice(0, 60)}</div> : null}
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="side-head">📥 未分配 / 待分诊 <span className="count">{unassigned.length}</span></div>
      <div id="unassigned">
        {ts.length === 0 ? (
          <div className="empty">🎉 没有未分配的工作<br />新需求会先进这里, 等 chief 分解</div>
        ) : (
          ts.map((t) => {
            const meta =
              t.status === "ready" && now - (t.created_at || now) > READY_MIN
                ? `⏳ 已等待 ${rel(now - (t.created_at || now))} — 积压`
                : chipMeta(t, null, now);
            return (
              <div
                key={t.id}
                className={"chip st-" + t.status}
                style={{ width: "100%" }}
                title={t.title + "  (点击查看详情)"}
                onClick={() => openDrawerTask(t.id)}
              >
                <div className="c-title">{t.title}</div>
                <div className="c-meta">{meta}</div>
              </div>
            );
          })
        )}
      </div>
      <div className="side-head">
        🗨 聊天工作 <span className="count">{list.length}</span>
        <Tooltip title={snap.chatShowAll ? "当前显示全部会话, 点击切回近 24h" : "当前显示近 24h, 点击查看全部"}>
          <Segmented
            size="small"
            style={{ marginLeft: "auto", flex: "0 0 auto" }}
            options={[{ label: "24h", value: "24h" }, { label: "全部", value: "all" }]}
            value={snap.chatShowAll ? "all" : "24h"}
            onChange={(v) => setChatAll(v === "all")}
          />
        </Tooltip>
      </div>
      <div className="side-hint">
        {snap.chatShowAll
          ? "全部 · 非 Kanban（最多 100 个, 含历史会话）"
          : "近 24h · 非 Kanban（飞书 / 微信直接进行的会话）"}
      </div>
      <div id="chatSessions">
        {list.length === 0 ? (
          <div className="empty">
            🗨 {snap.chatShowAll ? "无聊天会话" : "近 24h 无聊天工作"}
            <br />
            飞书 / 微信里直接干的活会显示在这里
          </div>
        ) : (
          list.map((s) => {
            const la = s.last_activity_at ? Number(s.last_activity_at) : null;
            const age = la != null ? nowS - la : null;
            const dot = s.is_active ? "cs-active" : age != null && age < 3600 ? "cs-recent" : "cs-idle";
            const title = String(s.title || s.preview || s.display_name || s.id || "未命名会话");
            const meta =
              profLabel(String(s.profile ?? "")) +
              " · " +
              srcLabel(String(s.source ?? "")) +
              (s.chat_type === "group" ? " · 群" : s.chat_type === "dm" ? " · 单聊" : "") +
              (age != null ? " · " + rel(age) : "");
            const desc = s.is_active && s.last_activity_description ? ` — ${s.last_activity_description}` : "";
            return (
              <div key={s.id} className={"cs-row " + dot} title={title} onClick={() => openSession(s.id)}>
                <span className="cs-dot" />
                <div className="cs-main">
                  <div className="cs-title">
                    {title}
                    {s.unread ? <span className="cs-unread" title="有未读" /> : null}
                  </div>
                  <div className="cs-meta">
                    {meta}
                    {desc}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="legend">
        {LEGEND.map(([label, k]) => (
          <span key={k}>
            <i style={{ background: `var(--c-${k})` }} />
            {label}
          </span>
        ))}
      </div>
    </aside>
  );
}