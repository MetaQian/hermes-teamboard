/**
 * 数据层 + 全局 UI 状态(与渲染无关)。
 * 数据经同源 /proxy/* 代理拉取(后端自动带会话 cookie), 轮询更新;
 * React 组件通过 useSyncExternalStore 订阅 version 变化后重新读取。
 */
import { applyStatusVars, initialTheme, persistTheme, type ThemeMode } from "./theme";

/* ================= 类型 ================= */

export interface Task {
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

export interface Profile {
  name: string;
  is_default: boolean;
  description?: string;
  model?: string;
  provider?: string;
}

export interface Worker {
  profile: string;
  pid?: number | null;
}

export interface BoardColumn {
  name: string;
  tasks: Task[];
}

export interface Board {
  columns: BoardColumn[];
  now: number;
}

export interface DiagEntry {
  kind?: string;
  severity?: string;
  title?: string;
  detail?: string;
}

export interface DiagGroup {
  task_id: string;
  task_title?: string;
  task_status?: string;
  task_assignee?: string | null;
  diagnostics: DiagEntry[];
}

export interface WorkersResp {
  workers?: Worker[];
  count?: number;
}

export interface ProfilesResp {
  profiles?: Profile[];
}

export interface DiagResp {
  diagnostics?: DiagGroup[];
}

export interface Cfg {
  base_url?: string;
  username?: string;
  password_set?: boolean;
  provider?: string;
  refresh_ms?: number;
  port?: number;
}

export interface Health {
  connected: boolean;
  error?: string | null;
  base_url?: string;
}

export interface TaskDetail {
  task?: Partial<Task>;
  comments?: { author?: string; body?: string }[];
  events?: { kind?: string; type?: string; created_at?: number; payload?: Record<string, unknown> }[];
  [k: string]: unknown;
}

export interface Session {
  id: string;
  profile?: string;
  source?: string;
  title?: string | null;
  display_name?: string | null;
  preview?: string | null;
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

export interface SessionsResp {
  sessions?: Session[];
}

export interface SessionMessage {
  id: string;
  role: string;
  content: string;
  tool_name?: string | null;
  timestamp?: number | string | null;
}

/** Hermes 定时任务(cron job), GET /api/cron/jobs 返回的数组元素 */
export interface CronJob {
  id: string;
  name: string;
  profile?: string | null;
  state?: string; // scheduled | paused | running
  enabled?: boolean;
  schedule_display?: string | null;
  next_run_at?: string | null;
  last_run_at?: string | null;
  last_status?: string | null; // ok | error
  last_error?: string | null;
  failure_streak?: number | null;
  script?: string | null;
  no_agent?: boolean;
  skill?: string | null;
  prompt?: string | null;
  deliver?: string | null;
  origin?: { platform?: string | null; chat_name?: string | null } | null;
  workdir?: string | null;
  paused_at?: string | null;
  paused_reason?: string | null;
  created_at?: string | null;
  live_execution?: unknown;
  latest_execution?: {
    id?: string;
    status?: string;
    started_at?: string | null;
    finished_at?: string | null;
    error?: string | null;
  } | null;
}

export type ByAssignee = Record<string, Task[]>;

export interface WorkerState {
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

export interface LastData {
  board: Board | null;
  workers: WorkersResp | null;
  stats: unknown;
  profiles: ProfilesResp | null;
  diag: DiagResp | null;
  sessions: SessionsResp | null;
  crons: CronJob[];
  ok: boolean;
  error: string | null;
  at: number;
}

/* ================= 常量与工具 ================= */

export const STATUS_ZH: Record<string, string> = {
  running: "进行中", blocked: "阻塞", review: "待审核", ready: "就绪",
  scheduled: "已排期", todo: "排队", triage: "分诊", done: "已完成",
};

const STATUS_ORDER: Record<string, number> = {
  running: 0, blocked: 1, stale: 1, review: 2, ready: 3, scheduled: 4, todo: 5, triage: 6, done: 7,
};

export const STALE_MIN = 45 * 60; // 心跳超过 45 分钟视为疑似卡死
export const READY_MIN = 30 * 60; // ready 超过 30 分钟视为积压
const SESSION_WINDOW = 24 * 3600; // 聊天工作区: 24h 窗口

export const SOURCE_ZH: Record<string, string> = { feishu: "飞书", weixin: "微信", cli: "CLI", curator: "curator" };
export const srcLabel = (s: string): string => SOURCE_ZH[s] ?? s;
export const profLabel = (p: string): string => (p === "default" ? "chief" : p);

export const ZH_STATE: Record<string, string> = {
  running: "🟢 工作中", idle: "⚪ 空闲", blocked: "🔴 阻塞", review: "🟡 待审核",
  ready: "🟢 就绪", stale: "🟠 疑似卡死",
};
export const zhState = (s: string): string => ZH_STATE[s] ?? s;

export const avatarHue = (s: string): number => {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
};

/** 头像: chief 用蓝渐变, worker 按名字色相(两个主题共用, 色彩本身足够醒目) */
export function avatarBg(name: string, chief = false): string {
  const hue = avatarHue(name);
  return chief
    ? "linear-gradient(135deg,#3b82f6,#1e40af)"
    : `linear-gradient(135deg,hsl(${hue},72%,55%),hsl(${(hue + 50) % 360},72%,42%))`;
}

export function rel(sec: number | null | undefined): string {
  if (sec == null) return "—";
  let s = Math.floor(sec);
  if (s < 0) s = 0;
  if (s < 10) return "刚刚";
  if (s < 60) return s + "s 前";
  if (s < 3600) return Math.floor(s / 60) + "m 前";
  if (s < 86400) return (s / 3600).toFixed(1) + "h 前";
  return (s / 86400).toFixed(1) + "d 前";
}

/** ISO 时间(含时区)相对现在的表达: 未来 → "12m 后", 过去 → rel() 的 "12m 前" */
export function whenIso(iso: string | null | undefined, nowS: number): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime() / 1000;
  if (Number.isNaN(t)) return "—";
  const d = t - nowS;
  if (d >= 0) {
    if (d < 60) return "1m 后";
    if (d < 3600) return Math.ceil(d / 60) + "m 后";
    if (d < 86400) return (d / 3600).toFixed(1) + "h 后";
    return (d / 86400).toFixed(1) + "d 后";
  }
  return rel(-d);
}

export function chipMeta(t: Task, _st: WorkerState | null, now: number): string {
  switch (t.status) {
    case "running":
      return (
        "⏱ " +
        (t.last_heartbeat_at ? "心跳 " + rel(now - t.last_heartbeat_at) : "暂无心跳") +
        (t.started_at ? " · 跑了 " + rel(now - t.started_at) : "")
      );
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

export async function fetchJSON<T = unknown>(u: string, init?: RequestInit): Promise<T> {
  const r = await fetch(u, init);
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

export const hostport = (u: string | null | undefined): string => {
  if (!u) return "?";
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
};

/* ================= 派生数据 ================= */

export function roster(): { chief: Profile; workers: Profile[] } {
  const ps: Profile[] = (LAST.profiles && LAST.profiles.profiles) || [];
  const chief = ps.find((p) => p.is_default) ?? { name: "default", is_default: true, description: "总调度" };
  const workers = ps.filter((p) => !p.is_default);
  return { chief, workers };
}

export function allTasks(): { byA: ByAssignee; unassigned: Task[]; columns: BoardColumn[] } {
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

export function workerState(name: string): WorkerState {
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

export function countBy(ts: Task[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const t of ts) c[t.status] = (c[t.status] || 0) + 1;
  return c;
}

export function sortTasks(ts: Task[]): Task[] {
  return [...ts].sort((a, b) => {
    const ka = STATUS_ORDER[a.status] ?? 9;
    const kb = STATUS_ORDER[b.status] ?? 9;
    if (ka !== kb) return ka - kb;
    if ((b.priority || 0) !== (a.priority || 0)) return (b.priority || 0) - (a.priority || 0);
    return (b.created_at || 0) - (a.created_at || 0);
  });
}

/** 非 cron 聊天会话: all=false 时仅近 24h 有活动(或正在运行)的, all=true 时全部(仍排除归档/隐藏), 活跃在前、按最后活动时间倒序。 */
export function recentSessions(all: boolean): Session[] {
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

/** 团队总体计数(顶栏统计 / 状态卡环形图中心数字 / 条形图共用) */
export function teamCounts(): {
  run: number; blocked: number; review: number; ready: number; queued: number; done24: number; stale: number;
} {
  const { byA, unassigned } = allTasks();
  let run = 0, blocked = 0, review = 0, ready = 0, queued = 0, done24 = 0, stale = 0;
  const now = (LAST.board && LAST.board.now) || Math.floor(Date.now() / 1000);
  const count = (t: Task): void => {
    if (t.status === "running") {
      run++;
      const hb = t.last_heartbeat_at || t.started_at;
      if (hb && now - hb > STALE_MIN) stale++;
    } else if (t.status === "blocked") blocked++;
    else if (t.status === "review") review++;
    else if (t.status === "ready" || t.status === "scheduled") ready++;
    else if (t.status === "todo" || t.status === "triage") queued++;
    else if (t.status === "done" && t.completed_at && now - t.completed_at < 86400) done24++;
  };
  for (const k in byA) for (const t of byA[k]) count(t);
  for (const t of unassigned) count(t);
  return { run, blocked, review, ready, queued, done24, stale };
}

/* ================= 全局状态 + 订阅 ================= */

export let LAST: LastData = {
  board: null, workers: null, stats: null, profiles: null, diag: null, sessions: null, crons: [],
  ok: false, error: null, at: 0,
};
export let HEALTH: Health | null = null;
export let lastGoodBase: string | null = null;
export let paused = false;
export let refreshMs = 10000;
export let chatShowAll = false;
export let theme: ThemeMode = initialTheme();
export let drawerTaskId: string | null = null;
export let drawerSessionId: string | null = null;
export let drawerCronId: string | null = null;
export let workerPageId: string | null = null;
export let configOpen = false;
/** worker 节点的屏幕矩形(含当前缩放/平移), 供悬浮面板锚定 */
export const nodeRects: Record<string, { cx: number; cy: number; w: number; h: number }> = {};
export const knownChips = new Set<string>();

let version = 0;
const listeners = new Set<() => void>();

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function getVersion(): number {
  return version;
}

export function emit(): void {
  version++;
  for (const l of listeners) l();
}

export function setTheme(m: ThemeMode): void {
  theme = m;
  document.documentElement.dataset.theme = m;
  applyStatusVars(m);
  persistTheme(m);
  emit();
}

export function togglePause(): void {
  paused = !paused;
  emit();
  if (!paused) restartPoll();
}

export function setChatAll(v: boolean): void {
  if (chatShowAll === v) return;
  chatShowAll = v;
  emit();
  restartPoll();
}

export function openDrawerTask(id: string): void {
  drawerTaskId = id;
  drawerSessionId = null;
  drawerCronId = null;
  emit();
}

export function openSession(id: string): void {
  drawerTaskId = null;
  drawerSessionId = id;
  drawerCronId = null;
  emit();
}

export function openDrawerCron(id: string): void {
  drawerTaskId = null;
  drawerSessionId = null;
  drawerCronId = id;
  emit();
}

export function closeDrawer(): void {
  drawerTaskId = null;
  drawerSessionId = null;
  drawerCronId = null;
  emit();
}

export function openWorkerPage(name: string): void {
  workerPageId = name;
  emit();
}

export function closeWorkerPage(): void {
  workerPageId = null;
  emit();
}

export function setConfigOpen(v: boolean): void {
  configOpen = v;
  emit();
}

/* ================= 轮询 ================= */

let pollTimer: number | null = null;
let started = false;

async function poll(): Promise<void> {
  try {
    const [board, workers, stats, profiles, diag, sessions, crons] = await Promise.all([
      fetchJSON<Board>("/proxy/api/plugins/kanban/board"),
      fetchJSON<WorkersResp>("/proxy/api/plugins/kanban/workers/active"),
      fetchJSON<unknown>("/proxy/api/plugins/kanban/stats"),
      fetchJSON<ProfilesResp>("/proxy/api/plugins/kanban/profiles"),
      fetchJSON<DiagResp>("/proxy/api/plugins/kanban/diagnostics").catch(() => ({ diagnostics: [] })),
      // Hermes sessions 接口 limit 上限为 100(超过 422), 这里已是全量
      fetchJSON<SessionsResp>("/proxy/api/sessions?limit=100").catch(() => ({ sessions: [] })),
      // 定时任务(cron job)列表; 端点异常不影响看板主体
      fetchJSON<CronJob[]>("/proxy/api/cron/jobs").catch(() => []),
    ]);
    LAST = { board, workers, stats, profiles, diag, sessions, crons, ok: true, error: null, at: Date.now() };
  } catch (e) {
    // 断线时保留最后成功数据; 顶栏状态由 pollHealth 显示(不用 toast)
    LAST.ok = false;
    LAST.error = String((e as Error).message ?? e);
  }
  emit();
}

/** 连接状态(顶栏): 不用 toast, 断线时红点+短错误, 恢复即消失 */
async function pollHealth(): Promise<void> {
  try {
    const h = await fetchJSON<Health>("/api/health");
    HEALTH = h;
    if (h.connected) lastGoodBase = h.base_url || null;
  } catch (e) {
    HEALTH = { connected: false, error: "代理不可用: " + String((e as Error).message ?? e) };
  }
  emit();
}

export function setRefreshMs(v: number): void {
  refreshMs = Math.max(3000, v);
}

export function restartPoll(): void {
  if (pollTimer != null) window.clearInterval(pollTimer);
  pollTimer = null;
  poll();
  if (!paused) pollTimer = window.setInterval(poll, refreshMs);
}

export async function startPolling(): Promise<void> {
  if (started) return;
  started = true;
  try {
    const c = await fetchJSON<Cfg>("/api/config");
    refreshMs = c.refresh_ms || 10000;
  } catch {
    /* 配置不可用时用默认值 */
  }
  window.setInterval(pollHealth, 15000);
  pollHealth();
  restartPoll();
}

export function stopPolling(): void {
  started = false;
  if (pollTimer != null) window.clearInterval(pollTimer);
  pollTimer = null;
}