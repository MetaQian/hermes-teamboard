/**
 * Hermes 多 Agent 组织看板 — 前端逻辑(TypeScript, 编译为 dist/web/app.js)。
 * DOM + SVG + vendored 第三方库: d3(画布缩放/平移、悬停高亮) 与 echarts
 * (左下角团队状态卡), 均由 /vendor/* 本地加载, 运行时零 npm 依赖。
 * 数据经同源 /proxy/* 代理拉取(后端自动带会话 cookie)。
 */

/* ================= 类型 ================= */

interface Task {
  id: string;
  title: string;
  status: string;
  assignee?: string | null;
  priority?: number | null;
  created_at?: number | null;
  started_at?: number | null;
  completed_at?: number | null;
  last_heartbeat_at?: number | null;
  last_failure_error?: string | null;
  block_kind?: string | null;
  block_recurrences?: number | null;
  block_reason?: string | null;
  latest_summary?: string | null;
  result?: string | null;
  body?: string | null;
  workspace_path?: string | null;
  completion_contract?: string | null;
}

interface Profile {
  name: string;
  is_default: boolean;
  description?: string;
  model?: string;
  provider?: string;
}

interface Worker {
  profile: string;
  pid?: number | null;
}

interface BoardColumn {
  name: string;
  tasks: Task[];
}

interface Board {
  columns: BoardColumn[];
  now: number;
}

interface DiagEntry {
  kind?: string;
  severity?: string;
  title?: string;
  detail?: string;
}

interface DiagGroup {
  task_id: string;
  task_title?: string;
  task_status?: string;
  task_assignee?: string | null;
  diagnostics: DiagEntry[];
}

interface BoardResp {
  board?: Board;
  [k: string]: unknown;
}

interface WorkersResp {
  workers?: Worker[];
  count?: number;
}

interface ProfilesResp {
  profiles?: Profile[];
}

interface DiagResp {
  diagnostics?: DiagGroup[];
}

interface Cfg {
  base_url?: string;
  username?: string;
  password_set?: boolean;
  provider?: string;
  refresh_ms?: number;
  port?: number;
}

interface Health {
  connected: boolean;
  error?: string | null;
  base_url?: string;
}

interface TaskDetail {
  task?: Partial<Task>;
  comments?: { author?: string; body?: string }[];
  events?: { kind?: string; type?: string; created_at?: number; payload?: Record<string, unknown> }[];
  [k: string]: unknown;
}

interface Session {
  id: string;
  profile?: string;
  source?: string;
  title?: string | null;
  display_name?: string | null;
  chat_type?: string | null;
  started_at?: number | null;
  ended_at?: number | null;
  last_activity_at?: number | null;
  last_activity_description?: string | null;
  is_active?: boolean;
  unread?: boolean | number;
  archived?: number | boolean;
  hidden?: number | boolean;
  model?: string;
  message_count?: number;
  tool_call_count?: number;
  api_call_count?: number;
  [k: string]: unknown;
}

interface SessionsResp {
  sessions?: Session[];
}

interface SessionMessage {
  id: string;
  role: string;
  content: string;
  tool_name?: string | null;
  timestamp?: number | string | null;
}

type ByAssignee = Record<string, Task[]>;

interface WorkerState {
  state: string;
  run: Task | undefined;
  act: Worker | undefined;
  ts: Task[];
  stale: boolean;
  hbAge: number | null;
  diag: DiagGroup | undefined;
  now: number;
  counts: Record<string, number>;
}

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

interface LastData {
  board: Board | null;
  workers: WorkersResp | null;
  stats: unknown;
  profiles: ProfilesResp | null;
  diag: DiagResp | null;
  sessions: SessionsResp | null;
  ok: boolean;
  error: string | null;
  at: number;
}

/* ================= 工具 ================= */

const $ = (s: string): HTMLElement => document.querySelector(s) as HTMLElement;
const $in = (s: string): HTMLInputElement => document.querySelector(s) as HTMLInputElement;

const ESC_MAP: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: unknown): string => String(s ?? "").replace(/[&<>"']/g, (c) => ESC_MAP[c] ?? c);

const STATUS_ZH: Record<string, string> = {
  running: "进行中", blocked: "阻塞", review: "待审核", ready: "就绪",
  scheduled: "已排期", todo: "排队", triage: "分诊", done: "已完成",
};

const STATUS_ORDER: Record<string, number> = {
  running: 0, blocked: 1, stale: 1, review: 2, ready: 3, scheduled: 4, todo: 5, triage: 6, done: 7,
};

const STALE_MIN = 45 * 60; // 心跳超过 45 分钟视为疑似卡死
const READY_MIN = 30 * 60; // ready 超过 30 分钟视为积压
const SESSION_WINDOW = 24 * 3600; // 聊天工作区: 显示 24h 内有活动的会话(排除 cron)
let chatShowAll = false; // 聊天工作区: false=近 24h 窗口, true=全部会话

const SOURCE_ZH: Record<string, string> = { feishu: "飞书", weixin: "微信", cli: "CLI", curator: "curator" };
const srcLabel = (s: string): string => SOURCE_ZH[s] ?? s;
const profLabel = (p: string): string => (p === "default" ? "chief" : p);

const ZH_STATE: Record<string, string> = {
  running: "🟢 工作中", idle: "⚪ 空闲", blocked: "🔴 阻塞", review: "🟡 待审核",
  ready: "🟢 就绪", stale: "🟠 疑似卡死",
};
const zhState = (s: string): string => ZH_STATE[s] ?? s;

function div(cls: string): HTMLDivElement {
  const d = document.createElement("div");
  d.className = cls;
  return d;
}

/* ---------- 头像 & 连线高亮 ---------- */

function avatarHue(s: string): number {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

function avatar(name: string, chief = false): string {
  const hue = avatarHue(name);
  const letter = (name.trim().charAt(0) || "?").toUpperCase();
  const bg = chief
    ? "linear-gradient(135deg,#3b82f6,#1e40af)"
    : `linear-gradient(135deg,hsl(${hue},72%,55%),hsl(${(hue + 50) % 360},72%,42%))`;
  return `<span class="n-avatar" style="background:${bg}">${esc(letter)}</span>`;
}

/** name 为 null 时高亮全部连线(chief 悬停)。 */
function highlightEdges(name: string | null, on: boolean): void {
  for (const [n, p] of pathEdges) {
    if (name == null || n === name) p.classList.toggle("hl", on);
    else p.classList.toggle("dim", on);
  }
}

/* ================= 全局状态 ================= */

let CFG: Cfg | null = null;
let LAST: LastData = { board: null, workers: null, stats: null, profiles: null, diag: null, sessions: null, ok: false, error: null, at: 0 };
let paused = false;
let refreshMs = 10000;
let pollTimer: number | null = null;
const knownChips = new Set<string>();
let drawerTaskId: string | null = null;
let drawerSessionId: string | null = null;
let workerPageId: string | null = null;
let pulses: Pulse[] = [];
let rafStarted = false;
let nodeRects: Record<string, { cx: number; cy: number; w: number; h: number }> = {};
const nodeEls: Record<string, HTMLDivElement> = {};
const pathEdges = new Map<string, SVGPathElement>();
let donutChart: any = null;
let barsChart: any = null;
let barsWorkerN = 0;
let zoomB: any = null;

/* ================= 数据 ================= */

async function fetchJSON<T = unknown>(u: string): Promise<T> {
  const r = await fetch(u);
  const t = await r.text();
  if (!r.ok) {
    // 后端错误体是 {"error":"..."} 时直接取其内容, 不再套一层 JSON
    let msg = t.slice(0, 200);
    try {
      const j = JSON.parse(t) as { error?: unknown };
      if (j && typeof j.error === "string" && j.error) msg = j.error;
    } catch {
      /* 非 JSON 响应体 */
    }
    throw new Error(`HTTP ${r.status}: ${msg}`.slice(0, 500));
  }
  return JSON.parse(t) as T;
}

/* ---------- 连接状态(顶栏): 不用 toast, 断线时顶栏红点+短错误, 恢复即消失 ---------- */

let lastGoodBase: string | null = null;

function hostport(u: string | null | undefined): string {
  if (!u) return "?";
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
}

async function poll(): Promise<void> {
  try {
    const [board, workers, stats, profiles, diag, sessions] = await Promise.all([
      fetchJSON<Board>("/proxy/api/plugins/kanban/board"),
      fetchJSON<WorkersResp>("/proxy/api/plugins/kanban/workers/active"),
      fetchJSON<unknown>("/proxy/api/plugins/kanban/stats"),
      fetchJSON<ProfilesResp>("/proxy/api/plugins/kanban/profiles"),
      fetchJSON<DiagResp>("/proxy/api/plugins/kanban/diagnostics").catch(() => ({ diagnostics: [] })),
      // Hermes sessions 接口 limit 上限为 100(超过 422), 这里已是全量
fetchJSON<SessionsResp>("/proxy/api/sessions?limit=100").catch(() => ({ sessions: [] })),
    ]);
    LAST = { board, workers, stats, profiles, diag, sessions, ok: true, error: null, at: Date.now() };
  } catch (e) {
    // 断线时保留最后成功数据; 顶栏状态由 pollHealth 显示(不用 toast)
    LAST.ok = false;
    LAST.error = String((e as Error).message ?? e);
  }
  render();
  if (drawerTaskId) refreshDrawer();
  if (drawerSessionId) refreshSessionDrawer();
  if (workerPageId) renderWorkerPage();
}

/** 非 cron 聊天会话: all=false 时仅近 24h 有活动(或正在运行)的, all=true 时全部(仍排除归档/隐藏), 活跃在前、按最后活动时间倒序。 */
function recentSessions(all: boolean): Session[] {
  const list: Session[] = (LAST.sessions && LAST.sessions.sessions) || [];
  const now = Date.now() / 1000;
  return list
    .filter((s) => s.source !== "cron" && !s.archived && !s.hidden)
    .filter((s) => {
      if (all) return true;
      const la = s.last_activity_at ? Number(s.last_activity_at) : null;
      return Boolean(s.is_active) || (la != null && now - la < SESSION_WINDOW);
    })
    .sort((a, b) => {
      if (Boolean(b.is_active) !== Boolean(a.is_active)) return b.is_active ? 1 : -1;
      return Number(b.last_activity_at || 0) - Number(a.last_activity_at || 0);
    });
}

async function pollHealth(): Promise<void> {
  try {
    const h = await fetchJSON<Health>("/api/health");
    const d = $("#connDot");
    if (h.connected) {
      d.className = "dot on";
      lastGoodBase = h.base_url || null;
      const t = $("#connTxt");
      t.className = "";
      t.textContent = "已连接 " + hostport(h.base_url);
    } else {
      d.className = "dot off";
      const t = $("#connTxt");
      t.className = "err";
      t.textContent = h.error || "连接失败";
    }
  } catch (e) {
    $("#connDot").className = "dot off";
    $("#connTxt").textContent = "代理不可用: " + String((e as Error).message ?? e);
  }
}

function roster(): { chief: Profile; workers: Profile[] } {
  const ps: Profile[] = (LAST.profiles && LAST.profiles.profiles) || [];
  const chief = ps.find((p) => p.is_default) ?? { name: "default", is_default: true, description: "总调度" };
  const workers = ps.filter((p) => !p.is_default);
  return { chief, workers };
}

function allTasks(): { byA: ByAssignee; unassigned: Task[]; columns: BoardColumn[] } {
  const byA: ByAssignee = {};
  const unassigned: Task[] = [];
  const board = LAST.board;
  if (!board) return { byA, unassigned, columns: [] };
  for (const col of board.columns)
    for (const t of col.tasks) {
      if (!t.assignee) unassigned.push(t);
      else (byA[t.assignee] = byA[t.assignee] || []).push(t);
    }
  return { byA, unassigned, columns: board.columns };
}

function workerState(name: string): WorkerState {
  const { byA } = allTasks();
  const ts = byA[name] || [];
  const now = (LAST.board && LAST.board.now) || Math.floor(Date.now() / 1000);
  const act: Worker | undefined = ((LAST.workers && LAST.workers.workers) || []).find((w) => w.profile === name);
  const has = (s: string): boolean => ts.some((t) => t.status === s);
  const run = ts.find((t) => t.status === "running");
  let stale = false;
  let hbAge: number | null = null;
  if (run) {
    const hb = run.last_heartbeat_at || run.started_at;
    hbAge = hb ? now - hb : null;
    stale = hb ? now - hb > STALE_MIN : run.started_at ? now - run.started_at > STALE_MIN : false;
  }
  let state = "idle";
  if (has("blocked")) state = "blocked";
  else if (has("running")) state = stale ? "stale" : "running";
  else if (has("review")) state = "review";
  else if (has("ready") || has("scheduled")) state = "ready";
  if (act && state === "idle") state = "running";
  const diag: DiagGroup | undefined =
    ((LAST.diag && LAST.diag.diagnostics) || []).find((d) => d.task_assignee === name && d.diagnostics.length);
  return { state, run, act, ts, stale, hbAge, diag, now, counts: countBy(ts) };
}

function countBy(ts: Task[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const t of ts) c[t.status] = (c[t.status] || 0) + 1;
  return c;
}

function sortTasks(ts: Task[]): Task[] {
  return [...ts].sort((a, b) => {
    const ka = STATUS_ORDER[a.status] ?? 9;
    const kb = STATUS_ORDER[b.status] ?? 9;
    if (ka !== kb) return ka - kb;
    if ((b.priority || 0) !== (a.priority || 0)) return (b.priority || 0) - (a.priority || 0);
    return (b.created_at || 0) - (a.created_at || 0);
  });
}

function rel(sec: number | null | undefined): string {
  if (sec == null) return "—";
  let s = Math.floor(sec);
  if (s < 0) s = 0;
  if (s < 10) return "刚刚";
  if (s < 60) return s + "s 前";
  if (s < 3600) return Math.floor(s / 60) + "m 前";
  if (s < 86400) return (s / 3600).toFixed(1) + "h 前";
  return (s / 86400).toFixed(1) + "d 前";
}

function chipMeta(t: Task, _st: WorkerState | null, now: number): string {
  switch (t.status) {
    case "running": {
      return (
        "⏱ " +
        (t.last_heartbeat_at ? "心跳 " + rel(now - t.last_heartbeat_at) : "暂无心跳") +
        (t.started_at ? " · 跑了 " + rel(now - t.started_at) : "")
      );
    }
    case "blocked":
      return "⏸ " +
        String(t.block_reason || t.last_failure_error || (t.block_kind ? "类型:" + t.block_kind : "阻塞")).slice(0, 40);
    case "review":
      return "⏳ 等待 chief 审核";
    case "ready":
      return "⏲ 待派单 " + rel(now - (t.created_at || now));
    case "scheduled":
      return "⏰ 已排期";
    case "todo":
      return "队列中";
    case "triage":
      return "待 chief 分解";
    case "done":
      return "✓ 完成 " + rel(now - (t.completed_at || now));
    default:
      return t.status;
  }
}

/* ================= 渲染 ================= */

function render(): void {
  const { chief, workers } = roster();
  renderStats(workers);
  const wrap = $("#canvasWrap");
  const W = wrap.clientWidth;
  const H = wrap.clientHeight;
  const nodes = $("#nodes");
  const svg = $("#edges") as unknown as SVGSVGElement;
  svg.setAttribute("viewBox", "0 0 " + W + " " + H);
  nodes.innerHTML = "";
  svg.innerHTML = "";
  pulses = [];
  pathEdges.clear();
  for (const k in nodeEls) delete nodeEls[k];

  const laneW = W / Math.max(workers.length, 1);
  const chiefY = 86;
  const workerY = Math.max(248, H * 0.3);
  const chiefPos = { x: W / 2, y: chiefY };
  const workerPos = workers.map((w, i) => ({ x: laneW * (i + 0.5) + 6, y: workerY }));

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
    pathEdges.set(w.name, path);
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
        { n: 3, dir: 1, color: "#22d3ee", r: 3.8, speed: 0.55, glow: true },
        { n: 2, dir: -1, color: "#60a5fa", r: 2.6, speed: 0.4, glow: false },
        { n: 1, dir: 1, color: "#e0faff", r: 2, speed: 0.95, glow: true }, // 快速亮火花
      ]);
    } else if (st.state === "review") {
      addPulses(path, [{ n: 2, dir: -1, color: "#fbbf24", r: 3, speed: 0.35, glow: false }]);
    } else if (st.state === "ready") {
      addPulses(path, [{ n: 1, dir: 1, color: "#a3e635", r: 2.4, speed: 0.25, glow: false }]);
    }
    if (st.state === "blocked" || st.state === "stale") {
      const mid = midPoint(path);
      const badge = div("warn-badge");
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
  const chiefEl = div("node st-chief" + (activeCnt || blockedCnt || chiefChatN ? " busy" : ""));
  chiefEl.style.left = chiefPos.x + "px";
  chiefEl.style.top = chiefPos.y + "px";
  chiefEl.innerHTML =
    `<div class="n-head">${avatar(chief.name, true)}
      <div><div class="n-name">${esc(chief.name)} · chief</div>
      <div class="n-sub">${esc(chief.description || "总调度 · 派单与审核")}</div></div></div>
     <div class="n-status"><span class="chipdot ${activeCnt ? "running" : blockedCnt ? "blocked" : ""}"></span>
       ${activeCnt ? `调度中 · <b style="color:var(--run)">${activeCnt}</b> 人在干活`
        : blockedCnt ? `有 <b style="color:var(--block)">${blockedCnt}</b> 人阻塞, 待处理`
        : chiefChatN ? `聊天工作中 · <b style="color:var(--run)">${chiefChatN}</b> 个会话`
         : "团队空闲"}</div>
     <div class="n-act">每 30 分钟自动巡检 · 审核质量门禁</div>
      ${chiefChatN ? `<div class="n-chat">🗨 ${chiefChatN} 个聊天会话活跃 — 点击右侧列表查看详情</div>` : ""}`;
  chiefEl.onmouseenter = () => highlightEdges(null, true);
  chiefEl.onmouseleave = () => highlightEdges(null, false);
  nodes.appendChild(chiefEl);

  /* ---- worker 节点 + 任务挂卡 ---- */
  workers.forEach((w, i) => {
    const st = states[i];
    const x = workerPos[i].x;
    const el = div("node wnode st-" + st.state);
    el.style.left = x + "px";
    el.style.top = workerY + "px";
    el.onclick = () => (workerPageId === w.name ? closeWorkerPage() : openWorkerPage(w.name));
    el.onmouseenter = () => highlightEdges(w.name, true);
    el.onmouseleave = () => highlightEdges(w.name, false);
    el.title = w.name + "（点击查看该 Agent 全部任务, 再次点击收起）";
    let actLine = "当前无任务";
    if (st.state === "blocked" && st.run) actLine = "⏸ " + String(st.run.block_reason || "阻塞").slice(0, 46);
    else if (st.run) actLine = "▸ " + st.run.title.slice(0, 46);
    else if (st.act) actLine = "▸ dispatcher 活跃 (pid " + (st.act.pid ?? "?") + ")";
    else if (st.counts.review) actLine = "⏳ 有待审件, 等 chief";
    const diagLine = st.diag ? `⚠ ${esc(st.diag.diagnostics[0].title || "异常")}` : "";
    const chatN = activeChats.filter((s) => profLabel(String(s.profile ?? "")) === w.name).length;
    el.innerHTML =
      `<div class="n-head">${avatar(w.name)}
        <div><div class="n-name">${esc(w.name)}</div>
        <div class="n-sub" title="${esc(w.description || "")}">${esc(w.description || "—")}</div></div></div>
       <div class="n-status">${zhState(st.state)}
         ${st.state === "running" ? `<span style="color:var(--dim)">· 心跳 ${st.hbAge == null ? "—" : rel(st.hbAge)}</span>` : ""}
         ${st.counts.running ? `<span style="color:var(--run)">· ${st.counts.running} 张在做</span>` : ""}
         ${st.counts.blocked ? `<span style="color:var(--block)">· ${st.counts.blocked} 张阻塞</span>` : ""}
         ${st.counts.review ? `<span style="color:var(--review)">· ${st.counts.review} 张待审</span>` : ""}
       </div>
       <div class="n-act">${esc(actLine)}</div>
       ${diagLine ? `<div class="n-diag">${diagLine}</div>` : ""}
       ${chatN ? `<div class="n-chat">🗨 ${chatN} 个聊天会话活跃</div>` : ""}`;
    nodeEls[w.name] = el;
    nodes.appendChild(el);

    /* 挂卡 lane */
    const lane = div("lane");
    lane.style.left = x + "px";
    lane.style.top = workerY + 58 + "px";
    const ts = sortTasks(st.ts).filter((t) => t.status !== "done");
    if (ts.length === 0) {
      const e = div("empty-lane");
      e.textContent = "（无任务）";
      lane.appendChild(e);
    } else {
      for (const t of ts) {
        lane.appendChild(makeChip(t, st, st.state === "stale" && t.status === "running"));
      }
    }
    nodes.appendChild(lane);
  });

  renderUnassigned();
  renderChatSessions();
  // 测量各 worker 节点屏幕位置(含当前缩放/平移, 供悬浮面板锚定)
  for (const w of workers) {
    const el = nodeEls[w.name];
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0)
      nodeRects[w.name] = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height };
  }
  if (!rafStarted) {
    rafStarted = true;
    requestAnimationFrame(tickPulses);
  }
  updateCharts();
}

function makeChip(t: Task, st: WorkerState | null, forceStale: boolean): HTMLDivElement {
  const key = t.id;
  const isNew = !knownChips.has(key);
  knownChips.add(key);
  const c = div("chip st-" + (forceStale ? "stale" : t.status) + (isNew ? " new" : ""));
  c.dataset.id = t.id;
  c.innerHTML = `<div class="c-title">${esc(t.title)}</div>
    <div class="c-meta">${esc(chipMeta(t, st, (st && st.now) || 0))}</div>`;
  c.title = t.title + "  (点击查看详情)";
  c.onclick = () => openDrawer(t.id);
  return c;
}

function renderUnassigned(): void {
  const { unassigned } = allTasks();
  const now = (LAST.board && LAST.board.now) || Math.floor(Date.now() / 1000);
  $("#noneCount").textContent = String(unassigned.length);
  const box = $("#unassigned");
  const ts = sortTasks(unassigned);
  if (!ts.length) {
    box.innerHTML = `<div class="empty">🎉 没有未分配的工作<br>新需求会先进这里, 等 chief 分解</div>`;
    return;
  }
  box.innerHTML = ts
    .map((t) => {
      const meta =
        t.status === "ready" && now - (t.created_at || now) > READY_MIN
          ? `⏳ 已等待 ${rel(now - (t.created_at || now))} — 积压`
          : chipMeta(t, null, now);
      return `<div class="chip st-${t.status}" data-id="${t.id}" style="width:100%">
        <div class="c-title">${esc(t.title)}</div>
        <div class="c-meta">${esc(meta)}</div></div>`;
    })
    .join("");
  box.querySelectorAll<HTMLElement>(".chip").forEach((el) => {
    const id = el.dataset.id;
    if (id) knownChips.add(id);
    el.onclick = () => id && openDrawer(id);
  });
}

/* ================= 聊天工作(非 Kanban 的会话) ================= */

function renderChatSessions(): void {
  const list = recentSessions(chatShowAll);
  const cnt = document.getElementById("chatCount");
  if (cnt) cnt.textContent = String(list.length);
  const btn = document.getElementById("chatAll") as HTMLButtonElement | null;
  if (btn) {
    btn.textContent = chatShowAll ? "全部" : "24h";
    btn.classList.toggle("on", chatShowAll);
    btn.title = chatShowAll ? "当前显示全部会话, 点击切回近 24h" : "当前显示近 24h, 点击查看全部";
  }
  const hint = document.getElementById("chatHint");
  if (hint)
    hint.textContent = chatShowAll
      ? "全部 · 非 Kanban（最近 100 个会话, 含已结束的历史会话）"
      : "近 24h · 非 Kanban（飞书 / 微信直接进行的会话）";
  const box = $("#chatSessions");
  if (!box) return;
  if (!list.length) {
    box.innerHTML = `<div class="empty">🗨 ${chatShowAll ? "无聊天会话" : "近 24h 无聊天工作"}<br>飞书 / 微信里直接干的活会显示在这里</div>`;
    return;
  }
  const now = Date.now() / 1000;
  box.innerHTML = list
    .map((s) => {
      const la = s.last_activity_at ? Number(s.last_activity_at) : null;
      const age = la != null ? now - la : null;
      const dot = s.is_active ? "cs-active" : age != null && age < 3600 ? "cs-recent" : "cs-idle";
      const title = String(s.title || s.preview || s.display_name || s.id || "未命名会话");
      const meta =
        profLabel(String(s.profile ?? "")) +
        " · " +
        srcLabel(String(s.source ?? "")) +
        (s.chat_type === "group" ? " · 群" : s.chat_type === "dm" ? " · 单聊" : "") +
        (age != null ? " · " + rel(age) : "");
      const desc = s.is_active && s.last_activity_description ? ` — ${esc(s.last_activity_description)}` : "";
      return `<div class="cs-row ${dot}" data-sid="${esc(s.id)}" title="${esc(title)}">
        <span class="cs-dot"></span>
        <div class="cs-main">
          <div class="cs-title">${esc(title)}${s.unread ? '<span class="cs-unread" title="有未读"></span>' : ""}</div>
          <div class="cs-meta">${meta}${desc}</div>
        </div>
      </div>`;
    })
    .join("");
  box.querySelectorAll<HTMLElement>(".cs-row").forEach((el) => {
    const id = el.dataset.sid;
    el.onclick = () => id && openSessionDrawer(id);
  });
}

function renderStats(workers: Profile[]): void {
  const { byA, unassigned } = allTasks();
  let run = 0, blocked = 0, review = 0, ready = 0, done24 = 0, stale = 0;
  const now = (LAST.board && LAST.board.now) || Math.floor(Date.now() / 1000);
  for (const k in byA)
    for (const t of byA[k]) {
      if (t.status === "running") {
        run++;
        const hb = t.last_heartbeat_at || t.started_at;
        if (hb && now - hb > STALE_MIN) stale++;
      } else if (t.status === "blocked") blocked++;
      else if (t.status === "review") review++;
      else if (t.status === "ready" || t.status === "scheduled") ready++;
      else if (t.status === "done" && t.completed_at && now - t.completed_at < 86400) done24++;
    }
  void workers;
  $("#stats").innerHTML =
    `<span class="s-run">进行中 <b>${run}</b>${stale ? ` <span style="color:var(--stale)">(卡死 ${stale})</span>` : ""}</span>` +
    `<span class="s-block">阻塞 <b>${blocked}</b></span>` +
    `<span class="s-review">待审核 <b>${review}</b></span>` +
    `<span class="s-ready">就绪 <b>${ready}</b></span>` +
    `<span class="s-none">未分配 <b>${unassigned.length}</b></span>` +
    `<span>完成(24h) <b>${done24}</b></span>`;
}

/* ================= 连线动画 ================= */

function addPulses(path: SVGPathElement, specs: PulseSpec[]): void {
  const svg = $("#edges") as unknown as SVGSVGElement;
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
    pulses.push({ path, dir: s.dir, speed: s.speed, dots: grp });
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
  for (const p of pulses) {
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
  requestAnimationFrame(tickPulses);
}

/* ================= 画布缩放 / 平移 (d3.zoom) ================= */

function initZoom(): void {
  if (typeof d3 === "undefined") return;
  const wrap = $("#canvasWrap");
  const vp = $("#viewport") as HTMLElement;
  const zoom = d3
    .zoom()
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
      repositionPop();
    });
  zoomB = zoom;
  (d3.select(wrap) as any).call(zoom).on("dblclick.zoom", null);
}

function resetZoom(): void {
  if (!zoomB) return;
  (d3.select($("#canvasWrap")) as any).transition().duration(300).call(zoomB.transform, d3.zoomIdentity);
}

/* ================= 团队状态图 (ECharts) ================= */

const CHART_FONT = '-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif';

function barsOption(names: string[], per: Record<string, { run: number; done24: number }>): any {
  return {
    textStyle: { fontFamily: CHART_FONT },
    animationDurationUpdate: 500,
    grid: { left: 6, right: 34, top: 10, bottom: 4, containLabel: true },
    tooltip: {
      trigger: "axis",
      backgroundColor: "#0d1428",
      borderColor: "#2a3a66",
      textStyle: { color: "#e6ebf5", fontSize: 11.5, fontFamily: CHART_FONT },
      axisPointer: { type: "shadow", shadowStyle: { color: "#1e2a4a44" } },
    },
    xAxis: {
      type: "value",
      minInterval: 1,
      axisLabel: { color: "#5a6580", fontSize: 10, fontFamily: CHART_FONT },
      splitLine: { lineStyle: { color: "#1c2748", type: "dashed" } },
    },
    yAxis: {
      type: "category",
      data: names,
      axisLabel: { color: "#9aa5bd", fontSize: 11, fontFamily: CHART_FONT },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    series: [
      {
        name: "在做", type: "bar", stack: "t", barWidth: 7,
        itemStyle: { color: "#22d3ee", borderRadius: [0, 3, 3, 0] },
        data: names.map((n) => (per[n] && per[n].run) || 0),
      },
      {
        name: "完成24h", type: "bar", stack: "t", barWidth: 7,
        itemStyle: { color: "#546079", borderRadius: [0, 3, 3, 0] },
        data: names.map((n) => (per[n] && per[n].done24) || 0),
      },
    ],
  };
}

function initCharts(): void {
  if (typeof echarts === "undefined") return;
  const dEl = document.getElementById("scDonut");
  const bEl = document.getElementById("scBars");
  if (!dEl || !bEl) return;
  if (!donutChart) {
    donutChart = echarts.init(dEl as HTMLElement);
    donutChart.setOption({
      textStyle: { fontFamily: CHART_FONT },
      animation: true,
      tooltip: {
        trigger: "item",
        formatter: "{b}: {c} ({d}%)",
        backgroundColor: "#0d1428",
        borderColor: "#2a3a66",
        textStyle: { color: "#e6ebf5", fontSize: 11.5, fontFamily: CHART_FONT },
      },
      series: [
        {
          // 底圈: 全空闲时仍有一个浅灰环
          type: "pie", silent: true, radius: ["48%", "72%"], center: ["50%", "52%"],
          label: { show: false }, labelLine: { show: false },
          data: [{ value: 1, itemStyle: { color: "#151d38" } }],
        },
        {
          type: "pie", radius: ["48%", "72%"], center: ["50%", "52%"],
          label: { show: false }, labelLine: { show: false },
          itemStyle: { borderColor: "#0e1630", borderWidth: 2, borderRadius: 4 },
          data: [],
          animationDurationUpdate: 600,
        },
      ],
    });
  }
  if (!barsChart) {
    barsChart = echarts.init(bEl as HTMLElement);
    barsChart.setOption(barsOption([], {}));
  }
  updateCharts();
}

function updateCharts(): void {
  if (!donutChart || !barsChart) return;
  const { byA, unassigned } = allTasks();
  const { workers } = roster();
  const now = (LAST.board && LAST.board.now) || Math.floor(Date.now() / 1000);
  const per: Record<string, { run: number; done24: number }> = {};
  for (const w of workers) per[w.name] = { run: 0, done24: 0 };
  let run = 0, blocked = 0, review = 0, ready = 0, queued = 0, done24 = 0;
  const count = (t: Task, key?: string): void => {
    if (key) per[key] = per[key] || { run: 0, done24: 0 };
    if (t.status === "running") {
      run++;
      if (key) per[key].run++;
    } else if (t.status === "blocked") blocked++;
    else if (t.status === "review") review++;
    else if (t.status === "ready" || t.status === "scheduled") ready++;
    else if (t.status === "todo" || t.status === "triage") queued++;
    else if (t.status === "done" && t.completed_at && now - t.completed_at < 86400) {
      done24++;
      if (key) per[key].done24++;
    }
  };
  for (const k in byA) for (const t of byA[k]) count(t, k);
  for (const t of unassigned) count(t);

  const cN = document.getElementById("scCenterN");
  if (cN) cN.textContent = String(run + blocked + review + ready);
  const donutData = [
    { value: run, name: "进行中", itemStyle: { color: "#22d3ee" } },
    { value: blocked, name: "阻塞", itemStyle: { color: "#f87171" } },
    { value: review, name: "待审核", itemStyle: { color: "#fbbf24" } },
    { value: ready, name: "就绪", itemStyle: { color: "#a3e635" } },
    { value: queued, name: "排队", itemStyle: { color: "#94a3b8" } },
    { value: done24, name: "完成24h", itemStyle: { color: "#546079" } },
  ];
  donutChart.setOption({
    series: [
      { data: [{ value: 1, itemStyle: { color: "#151d38" } }] },
      { data: donutData },
    ],
  });

  const names = [...workers.map((w) => w.name)].reverse();
  const notMerge = names.length !== barsWorkerN;
  barsWorkerN = names.length;
  barsChart.setOption(barsOption(names, per), notMerge);
}

/* ================= worker 独立页面 ================= */

function wpRow(t: Task, st: WorkerState, isDone: boolean): string {
  const cls = "wp-row st-" + (isDone ? "done" : t.status);
  const meta = isDone ? `✓ 完成 ${rel(st.now - (t.completed_at || st.now))}` : chipMeta(t, st, st.now);
  const extra =
    isDone && t.latest_summary
      ? `<div class="wp-r-sum" title="${esc(t.latest_summary)}">${esc(String(t.latest_summary).slice(0, 140))}</div>`
      : "";
  return `<div class="${cls}" data-id="${t.id}">
    <div class="wp-r-main">
      <div class="wp-r-title">${esc(t.title)}</div>
      ${extra}
    </div>
    <div class="wp-r-meta">${esc(meta)}</div>
  </div>`;
}

const WP_POP_W = 400; // 与 CSS 中 #wpPop 的宽度保持一致

function positionWpPop(name: string): void {
  const rc = nodeRects[name];
  if (!rc) return;
  const pop = $("#wpPop") as HTMLElement;
  const popH = Math.min(460, window.innerHeight - 90);
  // 水平居中于节点, 夹在窗口内
  let left = rc.cx - WP_POP_W / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - WP_POP_W - 8));
  // 悬在节点下方; 空间不足时上移到节点上方
  let top = rc.cy + rc.h / 2 + 10;
  if (top + popH > window.innerHeight - 8) top = Math.max(8, rc.cy - rc.h / 2 - popH - 10);
  pop.style.left = left + "px";
  pop.style.top = top + "px";
}

/** 重新测量节点(缩放/平移后坐标已变)再定位悬浮面板。 */
function repositionPop(): void {
  if (!workerPageId) return;
  const el = nodeEls[workerPageId];
  if (el) {
    const r = el.getBoundingClientRect();
    nodeRects[workerPageId] = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height };
  }
  positionWpPop(workerPageId);
}

function openWorkerPage(name: string): void {
  workerPageId = name;
  $("#wpPop").classList.add("open");
  renderWorkerPage();
}

function closeWorkerPage(): void {
  workerPageId = null;
  $("#wpPop").classList.remove("open");
}

// 点击面板外任意处(节点除外, 节点自身是开关)收起面板
document.addEventListener("click", (e) => {
  if (!workerPageId) return;
  const t = e.target as HTMLElement;
  if ($("#wpPop").contains(t)) return;
  if (t.closest(".wnode")) return;
  closeWorkerPage();
});

function renderWorkerPage(): void {
  if (!workerPageId) return;
  const name = workerPageId;
  const { workers } = roster();
  const w = workers.find((p) => p.name === name);
  if (!w) {
    closeWorkerPage();
    return;
  }
  const st = workerState(name);
  const now = st.now;

  $("#wpName").textContent = name;
  const av = document.getElementById("wpAvatar") as HTMLElement | null;
  if (av) {
    const hue = avatarHue(name);
    av.style.background = `linear-gradient(135deg,hsl(${hue},72%,55%),hsl(${(hue + 50) % 360},72%,42%))`;
    av.textContent = (name.trim().charAt(0) || "?").toUpperCase();
  }
  $("#wpDot").className = "chipdot " + st.state;
  const badge = $("#wpState");
  badge.className = "badge " + (st.state === "stale" ? "stale" : st.state);
  badge.textContent = zhState(st.state).replace(/^[^ ]+ /, "");
  const sub: string[] = [];
  if (w.description) sub.push(w.description);
  if (st.act) sub.push("dispatcher 活跃 (pid " + (st.act.pid ?? "?") + ")");
  if (st.hbAge != null) sub.push("最近心跳 " + rel(st.hbAge));
  if (st.counts.running) sub.push(st.counts.running + " 张在做");
  if (st.counts.blocked) sub.push(st.counts.blocked + " 张阻塞");
  if (st.counts.review) sub.push(st.counts.review + " 张待审");
  $("#wpSub").textContent = sub.join("  ·  ") || "当前无任务";

  const act = sortTasks(st.ts).filter((t) => t.status !== "done");
  const done = st.ts
    .filter((t) => t.status === "done")
    .sort((a, b) => (b.completed_at || 0) - (a.completed_at || 0));
  const last24 = done.filter((t) => t.completed_at && now - t.completed_at < 86400).length;

  let html =
    `<div class="wp-sec"><h3>当前工作<span class="wp-n">${act.length}</span></h3>` +
    (act.length ? act.map((t) => wpRow(t, st, false)).join("") : `<div class="empty">当前没有进行中的任务</div>`) +
    `</div>`;
  html +=
    `<div class="wp-sec"><h3>已完成<span class="wp-n">${done.length}</span>（24h: ${last24}）</h3>` +
    (done.length ? done.map((t) => wpRow(t, st, true)).join("") : `<div class="empty">暂无已完成任务</div>`) +
    `</div>`;
  $("#wpBody").innerHTML = html;
  $("#wpBody").querySelectorAll<HTMLElement>(".wp-row").forEach((el) => {
    const id = el.dataset.id;
    if (id) el.onclick = () => openDrawer(id);
  });
  positionWpPop(name);
}

$("#wpClose").onclick = closeWorkerPage;

/* ================= 详情抽屉 ================= */

async function openDrawer(id: string): Promise<void> {
  drawerTaskId = id;
  drawerSessionId = null;
  $("#drawer").classList.add("open");
  await refreshDrawer();
}

/* ================= 会话详情(聊天工作) ================= */

async function openSessionDrawer(id: string): Promise<void> {
  drawerTaskId = null;
  drawerSessionId = id;
  $("#drawer").classList.add("open");
  await refreshSessionDrawer();
}

async function refreshSessionDrawer(): Promise<void> {
  if (!drawerSessionId) return;
  const id = drawerSessionId;
  let s: Session | null = null;
  let msgs: SessionMessage[] = [];
  try {
    const [sRaw, mRaw] = await Promise.all([
      fetchJSON<Session>("/proxy/api/sessions/" + encodeURIComponent(id)),
      fetchJSON<{ messages?: SessionMessage[] }>(
        "/proxy/api/sessions/" + encodeURIComponent(id) + "/messages"
      ).then((r) => r.messages || []),
    ]);
    s = sRaw;
    msgs = mRaw;
  } catch (e) {
    $("#dBody").innerHTML = `<div class="d-sec"><pre>加载失败: ${esc(String((e as Error).message ?? e))}</pre></div>`;
    return;
  }
  const now = Date.now() / 1000;
  const la = s.last_activity_at ? Number(s.last_activity_at) : null;
  const sa = s.started_at ? Number(s.started_at) : null;
  $("#dTitle").textContent = String(s.title || s.preview || s.display_name || "会话详情");
  $("#dSub").innerHTML =
    `<span class="badge ${s.is_active ? "running" : "ready"}">${s.is_active ? "运行中" : "空闲"}</span>` +
    `<span class="badge">${esc(profLabel(String(s.profile ?? "")))}</span>` +
    `<span class="badge">${esc(srcLabel(String(s.source ?? "")))}${
      s.chat_type === "group" ? " · 群" : s.chat_type === "dm" ? " · 单聊" : ""
    }</span>` +
    (s.model ? `<span class="badge">${esc(String(s.model))}</span>` : "") +
    `<span style="font-family:ui-monospace,monospace">${esc(id)}</span>`;
  const kv: [string, string][] = [];
  if (sa != null) kv.push(["开始", rel(now - sa)]);
  if (la != null)
    kv.push(["最近活动", rel(now - la) + (s.last_activity_description ? ` · ${s.last_activity_description}` : "")]);
  if (s.message_count != null) kv.push(["消息数", String(s.message_count)]);
  if (s.tool_call_count != null) kv.push(["工具调用", String(s.tool_call_count)]);
  if (s.api_call_count != null) kv.push(["API 调用", String(s.api_call_count)]);
  const secs: string[] = [];
  if (kv.length)
    secs.push(
      `<div class="d-sec"><h3>会话</h3><div class="kv">${kv
        .map(([k, v]) => `<span class="k">${k}</span><span>${esc(String(v))}</span>`)
        .join("")}</div></div>`
    );
  const tail = msgs.slice(-8);
  if (tail.length) {
    const list = tail
      .map((m) => {
        const role =
          m.role === "user"
            ? "👤 你"
            : m.role === "assistant"
            ? "🤖 agent"
            : "🔧 " + esc(String(m.tool_name || "tool"));
        const t = m.timestamp
          ? new Date(Number(m.timestamp) * 1000).toLocaleTimeString("zh-CN", { hour12: false })
          : "";
        let content = String(m.content ?? "");
        if (content.length > 500) content = content.slice(0, 500) + " …";
        return `<div class="msg m-${esc(String(m.role))}"><div class="msg-h"><b>${role}</b><span>${t}</span></div><pre>${esc(
          content
        )}</pre></div>`;
      })
      .join("");
    secs.push(`<div class="d-sec"><h3>最近消息 (最后 ${tail.length} 条)</h3><div class="msglist">${list}</div></div>`);
  } else {
    secs.push(`<div class="d-sec"><pre>暂无消息</pre></div>`);
  }
  $("#dBody").innerHTML = secs.join("");
  const ml = $("#dBody .msglist");
  if (ml) ml.scrollTop = ml.scrollHeight;
}

async function refreshDrawer(): Promise<void> {
  if (!drawerTaskId) return;
  let d: TaskDetail;
  try {
    d = await fetchJSON<TaskDetail>("/proxy/api/plugins/kanban/tasks/" + encodeURIComponent(drawerTaskId));
  } catch (e) {
    $("#dBody").innerHTML = `<div class="d-sec"><pre>加载失败: ${esc(String((e as Error).message ?? e))}</pre></div>`;
    return;
  }
  const t: Partial<Task> = d.task || {};
  const now = (LAST.board && LAST.board.now) || Math.floor(Date.now() / 1000);
  $("#dTitle").textContent = t.title || "—";
  const stale =
    t.status === "running" &&
    (t.last_heartbeat_at || t.started_at) != null &&
    now - (t.last_heartbeat_at || t.started_at!) > STALE_MIN;
  const badgeCls = stale ? "stale" : (t.status ?? "");
  $("#dSub").innerHTML =
    `<span class="badge ${badgeCls}">${stale ? "疑似卡死" : STATUS_ZH[t.status ?? ""] || t.status || "?"}</span>` +
    `<span class="badge">${esc(t.assignee || "未分配")}</span>` +
    (t.priority ? `<span class="badge">优先级 ${t.priority}</span>` : "") +
    `<span style="font-family:ui-monospace,monospace">${esc(t.id || "")}</span>`;
  const secs: string[] = [];
  const kv: [string, string][] = [];
  if (t.created_at) kv.push(["创建", rel(now - t.created_at)]);
  if (t.started_at) kv.push(["开始", rel(now - t.started_at)]);
  if (t.completed_at) kv.push(["完成", rel(now - t.completed_at)]);
  if (t.last_heartbeat_at) kv.push(["心跳", rel(now - t.last_heartbeat_at)]);
  if (t.workspace_path) kv.push(["工作区", String(t.workspace_path)]);
  if (t.completion_contract) kv.push(["完成约定", String(t.completion_contract)]);
  if (kv.length)
    secs.push(
      `<div class="d-sec"><h3>时间线</h3><div class="kv">${kv
        .map(([k, v]) => `<span class="k">${k}</span><span>${esc(String(v))}</span>`)
        .join("")}</div></div>`
    );
  if (t.block_reason)
    secs.push(`<div class="d-sec"><h3 style="color:var(--block)">阻塞原因</h3><pre>${esc(t.block_reason)}</pre></div>`);
  else if (t.status === "blocked")
    secs.push(
      `<div class="d-sec"><h3 style="color:var(--block)">阻塞</h3><pre>block_kind: ${esc(t.block_kind || "—")}\n复发次数: ${esc(
        t.block_recurrences ?? 0
      )}</pre></div>`
    );
  if (t.last_failure_error)
    secs.push(`<div class="d-sec"><h3 style="color:var(--stale)">最近失败</h3><pre>${esc(t.last_failure_error)}</pre></div>`);
  if (t.latest_summary || t.result)
    secs.push(`<div class="d-sec"><h3>结果摘要</h3><pre>${esc(t.latest_summary || t.result)}</pre></div>`);
  if (t.body && t.status !== "done")
    secs.push(
      `<div class="d-sec"><h3>卡片正文</h3><pre>${esc(t.body.slice(0, 1200))}${t.body.length > 1200 ? " …" : ""}</pre></div>`
    );
  const evs = d.events || [];
  if (evs.length) {
    const list = evs
      .slice(-12)
      .reverse()
      .map((e) => {
        const kind = e.kind || e.type || "?";
        const ts = e.created_at ? rel(now - e.created_at) : "";
        let extra = "";
        if (kind === "completed") extra = String((e.payload && e.payload.summary) || "").slice(0, 60);
        if (kind === "commented") extra = "评论 by " + (String((e.payload && e.payload.author) || "?"));
        if (kind === "blocked") extra = String((e.payload && e.payload.reason) || "").slice(0, 60);
        return `<div class="ev"><b>${esc(kind)}</b><span>${esc(ts)}</span><span style="color:var(--faint)">${esc(extra)}</span></div>`;
      })
      .join("");
    const hbCnt = evs.filter((e) => (e.kind || e.type) === "heartbeat").length;
    secs.push(`<div class="d-sec"><h3>事件流 (最近 12 / 心跳共 ${hbCnt})</h3>${list}</div>`);
  }
  const cts = (d.comments || []).slice(-3).reverse();
  if (cts.length) {
    secs.push(
      `<div class="d-sec"><h3>评论 (最近 3)</h3>${cts
        .map((c) => {
          const body = String(c.body ?? "");
          return `<pre style="margin-bottom:8px"><b style="color:var(--txt)">[${esc(c.author ?? "?")}]</b>\n${esc(
            body.slice(0, 400)
          )}${body.length > 400 ? " …" : ""}</pre>`;
        })
        .join("")}</div>`
    );
  }
  const dg = ((LAST.diag && LAST.diag.diagnostics) || []).find((x) => x.task_id === (t.id ?? ""));
  if (dg)
    secs.push(
      `<div class="d-sec"><h3 style="color:var(--block)">诊断</h3>${dg.diagnostics
        .map((x) => `<pre style="color:var(--block)">${esc(x.title || "")}\n${esc(String(x.detail ?? "").slice(0, 300))}</pre>`)
        .join("")}</div>`
    );
  $("#dBody").innerHTML = secs.join("") || `<div class="d-sec"><pre>暂无更多详情</pre></div>`;
}

$("#dClose").onclick = () => {
  drawerTaskId = null;
  drawerSessionId = null;
  $("#drawer").classList.remove("open");
};

/* ================= 设置 ================= */

$("#btnCfg").onclick = async () => {
  const c = await fetchJSON<Cfg>("/api/config");
  $in("#cfgBase").value = c.base_url || "";
  $in("#cfgUser").value = c.username || "";
  $in("#cfgPass").value = "";
  $in("#cfgPass").placeholder = c.password_set ? "已设置 ••••（留空不修改）" : "••••••••";
  $in("#cfgProvider").value = c.provider || "basic";
  $in("#cfgRefresh").value = String(c.refresh_ms || 10000);
  $("#cfgMsg").textContent = "";
  $("#modalMask").classList.add("open");
};

$("#cfgCancel").onclick = () => $("#modalMask").classList.remove("open");

$("#modalMask").onclick = (e) => {
  if ((e.target as HTMLElement).id === "modalMask") $("#modalMask").classList.remove("open");
};

$("#cfgSave").onclick = async () => {
  const body: Record<string, unknown> = {
    base_url: $in("#cfgBase").value.trim(),
    username: $in("#cfgUser").value.trim(),
    provider: $in("#cfgProvider").value.trim() || "basic",
    refresh_ms: parseInt($in("#cfgRefresh").value || "10000", 10),
  };
  if ($in("#cfgPass").value) body.password = $in("#cfgPass").value;
  const m = $("#cfgMsg");
  m.className = "";
  m.textContent = "连接中…";
  try {
    const r = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await r.json()) as { ok: boolean; error?: string; refresh_ms?: number };
    if (j.ok) {
      m.className = "ok";
      m.textContent = "✓ 已保存并连接成功";
      refreshMs = j.refresh_ms || refreshMs;
      restartPoll();
      setTimeout(() => $("#modalMask").classList.remove("open"), 600);
    } else {
      m.className = "err";
      m.textContent = "✗ " + (j.error || "unknown");
    }
  } catch (e) {
    m.className = "err";
    m.textContent = "✗ " + String((e as Error).message ?? e);
  }
};

$("#btnPause").onclick = () => {
  paused = !paused;
  $("#btnPause").textContent = paused ? "▶ 继续刷新" : "⏸ 暂停刷新";
  if (!paused) restartPoll();
};

const chatAllBtn = document.getElementById("chatAll");
if (chatAllBtn)
  chatAllBtn.onclick = () => {
    chatShowAll = !chatShowAll;
    restartPoll(); // 立即用新的 limit 重新拉取并渲染
  };

document.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key !== "Escape") return;
  if ($("#drawer").classList.contains("open")) {
    drawerTaskId = null;
    drawerSessionId = null;
    $("#drawer").classList.remove("open");
  } else if (workerPageId) {
    closeWorkerPage();
  }
  $("#modalMask").classList.remove("open");
});

/* ================= 启动 ================= */

function restartPoll(): void {
  if (pollTimer != null) window.clearInterval(pollTimer);
  pollTimer = null;
  poll();
  if (!paused) pollTimer = window.setInterval(poll, refreshMs);
}

async function init(): Promise<void> {
  try {
    CFG = await fetchJSON<Cfg>("/api/config");
    refreshMs = CFG.refresh_ms || 10000;
  } catch {
    /* 配置不可用时用默认值 */
  }
  window.setInterval(pollHealth, 15000);
  pollHealth();
  restartPoll();
  initZoom();
  setTimeout(() => initCharts(), 120); // 等首帧布局完成再初始化图表
  const btnReset = document.getElementById("btnZoomReset");
  if (btnReset) (btnReset as HTMLElement).onclick = resetZoom;
  const scHead = document.getElementById("scHead");
  if (scHead)
    (scHead as HTMLElement).onclick = () => {
      const card = document.getElementById("statsCard") as HTMLElement;
      card.classList.toggle("collapsed");
      const tg = document.getElementById("scToggle");
      if (tg) tg.textContent = card.classList.contains("collapsed") ? "▸" : "▾";
      if (!card.classList.contains("collapsed")) {
        if (donutChart) donutChart.resize();
        if (barsChart) barsChart.resize();
      }
    };
  // 深链: /?worker=<profile> 直接打开该 worker 的独立页面; /?session=<id> 直接打开会话详情
  const qs = new URLSearchParams(window.location.search);
  const wp = qs.get("worker");
  if (wp) setTimeout(() => openWorkerPage(wp), 1000);
  const ws = qs.get("session");
  if (ws) setTimeout(() => openSessionDrawer(ws), 1500);
  if (qs.get("chatall") === "1" && !chatShowAll) {
    chatShowAll = true;
    restartPoll();
  }
  window.setInterval(() => {
    $("#clock").textContent = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  }, 1000);
  window.addEventListener("resize", () => {
    render();
    if (workerPageId) renderWorkerPage();
    if (donutChart) donutChart.resize();
    if (barsChart) barsChart.resize();
  });
}

init();