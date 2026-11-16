/**
 * Hermes 多 Agent 组织看板 — 后端(TypeScript / Node, 仅标准库, 零运行时依赖)。
 *
 * 运行:  npm run build && npm start
 *   或:  node dist/server.js [--port 8787] [--host 127.0.0.1] [--config ./config.json]
 * 打开:  http://127.0.0.1:8787
 *
 * - 页面里所有 /proxy/<path> 请求都会带上会话 cookie 转发到 base_url,
 *   会话过期(401/403)时自动重新登录一次再重试。
 * - 配置(config.json)可在页面右上角「接口设置」里在线修改并即时生效。
 * - 环境变量优先于 config.json(便于 Docker 部署):
 *     HERMES_BASE_URL / HERMES_USERNAME / HERMES_PASSWORD / HERMES_REFRESH_MS
 *     TEAMBOARD_PORT / TEAMBOARD_HOST / TEAMBOARD_CONFIG
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(__dirname, "web");

/* ================= 配置 ================= */

export interface Config {
  base_url: string;
  username: string;
  password: string;
  provider: string;
  refresh_ms: number;
  port: number;
}

const DEFAULTS: Config = {
  base_url: "http://127.0.0.1:9117",
  username: "admin",
  password: "",
  provider: "basic",
  refresh_ms: 10000,
  port: 8787,
};

export function loadConfig(file: string): Config {
  const cfg: Config = { ...DEFAULTS };
  if (fs.existsSync(file)) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
      for (const k of Object.keys(DEFAULTS) as (keyof Config)[]) {
        const v = raw[k];
        if (v !== undefined && v !== null) cfg[k] = v as never;
      }
    } catch (e) {
      console.error(`[config] 读取 ${file} 失败, 使用默认值:`, (e as Error).message);
    }
  }
  // 环境变量覆盖(便于 Docker 部署)
  if (process.env.HERMES_BASE_URL) cfg.base_url = process.env.HERMES_BASE_URL;
  if (process.env.HERMES_USERNAME) cfg.username = process.env.HERMES_USERNAME;
  if (process.env.HERMES_PASSWORD) cfg.password = process.env.HERMES_PASSWORD;
  if (process.env.HERMES_PROVIDER && process.env.HERMES_PROVIDER.trim())
    cfg.provider = process.env.HERMES_PROVIDER.trim();
  if (process.env.HERMES_REFRESH_MS) {
    const v = parseInt(process.env.HERMES_REFRESH_MS, 10);
    if (!Number.isNaN(v)) cfg.refresh_ms = Math.max(3000, v);
  }
  return cfg;
}

export function saveConfig(file: string, cfg: Config): void {
  const data = JSON.stringify(cfg, null, 2) + "\n";
  const tmp = file + ".tmp";
  try {
    // 首选原子写: tmp + rename(崩溃安全)
    fs.writeFileSync(tmp, data, "utf8");
    fs.renameSync(tmp, file);
    return;
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* tmp 不存在, 忽略 */
    }
    // docker bind mount 上 rename 覆盖挂载点会 EBUSY: 回退为原地覆写
    // (truncate 同一 inode, 宿主文件同步更新)
    fs.writeFileSync(file, data, "utf8");
  }
}

export function publicCfg(cfg: Config): Record<string, unknown> {
  return {
    base_url: cfg.base_url,
    username: cfg.username,
    password_set: Boolean(cfg.password),
    provider: cfg.provider,
    refresh_ms: cfg.refresh_ms,
    port: cfg.port,
  };
}

/* ================= Hermes 客户端 ================= */

export interface UpstreamResult {
  status: number; // 0 = 不可达
  headers: Headers;
  body: Buffer;
}

function errMsg(e: unknown): string {
  // 沿 cause 链收集信息: "fetch failed" 本身无意义, 真正的错误(ENOTFOUND/
  // ECONNREFUSED/超时/证书)在 cause 里
  const parts: string[] = [];
  let cur: unknown = e;
  for (let depth = 0; cur && depth < 6; depth++) {
    const m = (cur as { message?: unknown })?.message;
    if (typeof m === "string" && m && m !== "fetch failed" && !parts.includes(m)) parts.push(m);
    const code = (cur as { code?: unknown })?.code;
    if (typeof code === "string" && code && !parts.some((p) => p.includes(code))) parts.push(code);
    cur = (cur as { cause?: unknown })?.cause;
  }
  if (parts.length) return parts.join(" · ");
  const m = (e as { message?: string })?.message;
  return m || String(e);
}

/** 从响应体里摘一段可读片段: JSON 直接截, HTML 去标签。 */
function bodySnippet(text: string, max = 140): string {
  const t = text.trim();
  if (!t) return "";
  if (t.startsWith("{") || t.startsWith("[")) return t.slice(0, max);
  const plain = t.replace(/<[^>]*>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
  return (plain || t).slice(0, max);
}

/** 把原始连接错误翻译成一句简短中文诊断, 附目标 host:port。 */
function describeConnError(base: string, raw: string | null): string {
  const r = (raw || "unknown").toLowerCase();
  let host = "";
  try {
    host = new URL(base).host;
  } catch {
    host = base;
  }
  const at = (m: string) => (host ? `${m} (${host})` : m);
  if (r.includes("bad port")) return at("端口无效, 请检查地址里的端口号");
  if (r.includes("enotfound") || r.includes("getaddrinfo") || r.includes("eai_again"))
    return at("域名无法解析, 请检查 IP / 域名");
  if (r.includes("econnrefused")) return at("连接被拒绝, 该端口没有服务");
  if (r.includes("econnreset") || r.includes("socket hang up")) return at("连接被中断, 服务可能在重启");
  if (r.includes("timeout") || r.includes("aborted") || r.includes("etimedout") || r.includes("econnaborted"))
    return at("连接超时 (20 秒), 请检查地址 / 防火墙");
  if (r.includes("cert") || r.includes("ssl") || r.includes("tls")) return at("TLS 证书错误");
  const lm = (raw || "").match(/login failed: http (\d{3})/i);
  if (lm) {
    const st = lm[1];
    if (st === "401" || st === "403") return at("用户名或密码错误");
    if (st === "429") return at("登录尝试过于频繁, 请 1-2 分钟后再试");
    if (st === "404") return at("认证方式不匹配, 请在设置里修改认证方式 (provider)");
    return at(`登录失败 (HTTP ${st})`);
  }
  if (r.includes("login rejected")) return at("用户名或密码错误");
  if (r.startsWith("login failed")) return at("登录失败");
  if (/^http \d{3}$/.test(r)) return at(`地址可达但返回 ${(raw || "").toUpperCase()}, 可能不是 Hermes dashboard`);
  return at("连接失败");
}

/** 带自动登录的 Hermes dashboard 客户端(内存 cookie, 线程模型下 JS 单线程无竞态)。 */
export class HermesClient {
  readonly base: string;
  readonly username: string;
  readonly password: string;
  readonly provider: string;
  connected = false;
  error: string | null = null;
  private cookies = new Map<string, string>();
  /** 登录失败退避: 30s 内不再尝试登录, 避免把目标平台刷出 429 限流。 */
  private lastLoginFail = 0;
  private lastLoginFailErr: string | null = null;

  constructor(cfg: Config) {
    this.base = cfg.base_url.replace(/\/+$/, "");
    this.username = cfg.username;
    this.password = cfg.password;
    this.provider = cfg.provider || "basic";
  }

  reset(): void {
    this.cookies.clear();
    this.connected = false;
    this.error = null;
  }

  private cookieHeader(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  private applySetCookies(res: Response): void {
    let list: string[] = [];
    try {
      list = res.headers.getSetCookie();
    } catch {
      // 极旧 Node: 退回解析单个 Set-Cookie 头
      const single = res.headers.get("set-cookie");
      if (single) list = [single];
    }
    for (const sc of list) {
      const first = sc.split(";")[0] ?? "";
      const idx = first.indexOf("=");
      if (idx <= 0) continue;
      const name = first.slice(0, idx).trim();
      const val = first.slice(idx + 1).trim();
      if (!name) continue;
      if (/max-age=0\b/i.test(sc)) this.cookies.delete(name);
      else this.cookies.set(name, val);
    }
  }

  private async doFetch(url: string, init: RequestInit): Promise<Response> {
    return fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(20_000) });
  }

  async login(): Promise<void> {
    const payload = JSON.stringify({
      provider: this.provider,
      username: this.username,
      password: this.password,
      next: "/",
    });
    let url = this.base + "/auth/password-login";
    let init: RequestInit = {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(this.cookieHeader() ? { Cookie: this.cookieHeader() } : {}) },
      body: payload,
    };
    for (let hop = 0; hop < 6; hop++) {
      const res = await this.doFetch(url, init);
      this.applySetCookies(res);
      const st = res.status;
      if (st >= 200 && st < 300) {
        const text = await res.text();
        let data: { ok?: boolean } = {};
        try {
          data = JSON.parse(text || "{}") as { ok?: boolean };
        } catch {
          /* 非 JSON 响应也视为成功(以状态码为准) */
        }
        if (data.ok === false) throw new Error(`login rejected: ${bodySnippet(text) || "no body"}`);
        this.connected = true;
        this.error = null;
        return;
      }
      const loc = res.headers.get("location");
      if (st >= 300 && st < 400 && loc) {
        url = new URL(loc, url).toString();
        init = {
          method: "GET",
          headers: this.cookieHeader() ? { Cookie: this.cookieHeader() } : {},
        };
        continue;
      }
      const text = await res.text();
      const sn = bodySnippet(text);
      throw new Error(`login failed: http ${st}${sn ? " " + sn : ""}`);
    }
    throw new Error("login failed: too many redirects");
  }

  /** 登录(带 30s 失败退避): 退避期内复用上次错误, 不再冲击目标平台(防 429)。 */
  private async ensureLogin(): Promise<boolean> {
    if (this.connected) return true;
    if (this.lastLoginFail && Date.now() - this.lastLoginFail < 30_000) {
      // this.error 保持原始错误(首次失败时已记录), 由调用方统一 describe, 避免重复包装
      return false;
    }
    try {
      await this.login();
      this.lastLoginFail = 0;
      this.lastLoginFailErr = null;
      return true;
    } catch (e) {
      this.connected = false;
      this.error = errMsg(e);
      this.lastLoginFail = Date.now();
      this.lastLoginFailErr = describeConnError(this.base, this.error);
      return false;
    }
  }

  /** GET base+path。不可达时 status=0; 401/403 自动重新登录一次再重试。 */
  async get(pathIn: string): Promise<UpstreamResult> {
    const p = pathIn.startsWith("/") ? pathIn : "/" + pathIn;
    const url = this.base + p;
    if (!this.connected && !(await this.ensureLogin())) {
      return { status: 0, headers: new Headers(), body: Buffer.from(`unreachable: ${this.error}`) };
    }
    for (let attempt = 1; attempt <= 2; attempt++) {
      let res: Response;
      try {
        res = await this.doFetch(url, {
          method: "GET",
          headers: this.cookieHeader() ? { Cookie: this.cookieHeader() } : {},
          redirect: "follow",
        });
      } catch (e) {
        this.connected = false;
        this.error = errMsg(e);
        return { status: 0, headers: new Headers(), body: Buffer.from(`unreachable: ${this.error}`) };
      }
      this.applySetCookies(res);
      if ((res.status === 401 || res.status === 403) && attempt === 1) {
        this.connected = false;
        if (!(await this.ensureLogin())) {
          return { status: 0, headers: new Headers(), body: Buffer.from(`login failed: ${this.error}`) };
        }
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      return { status: res.status, headers: res.headers, body: buf };
    }
    return { status: 502, headers: new Headers(), body: Buffer.from("{}") };
  }

  async health(): Promise<Record<string, unknown>> {
    const r = await this.get("/api/plugins/kanban/stats");
    const ok = r.status === 200;
    let stats: unknown = null;
    if (ok && r.body.length) {
      try {
        stats = JSON.parse(r.body.toString("utf8"));
      } catch {
        /* ignore */
      }
    }
    return {
      connected: ok,
      error: ok ? null : describeConnError(this.base, this.error || `http ${r.status}`),
      base_url: this.base,
      stats,
    };
  }
}

/* ================= HTTP 服务 ================= */

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

function sendJson(res: http.ServerResponse, code: number, obj: unknown): void {
  const body = Buffer.from(JSON.stringify(obj, null, 0), "utf8");
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function notFound(res: http.ServerResponse): void {
  sendJson(res, 404, { detail: "no such endpoint" });
}

function serveStatic(res: http.ServerResponse, name: string): boolean {
  const fp = path.normalize(path.join(WEB_DIR, name));
  if (!fp.startsWith(WEB_DIR) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) return false;
  const ext = path.extname(fp).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  res.end(fs.readFileSync(fp));
  return true;
}

function readBody(req: http.IncomingMessage, limit = 1_000_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

class Server {
  cfg: Config;
  cfgPath: string;
  client: HermesClient;

  constructor(cfg: Config, cfgPath: string) {
    this.cfg = cfg;
    this.cfgPath = cfgPath;
    this.client = new HermesClient(cfg);
  }

  async handleSaveConfig(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse((await readBody(req)).toString("utf8") || "{}") as Record<string, unknown>;
    } catch {
      return sendJson(res, 400, { ok: false, error: "bad json" });
    }
    const c = this.cfg;
    if (typeof body.base_url === "string" && body.base_url.trim()) c.base_url = body.base_url.trim().replace(/\/+$/, "");
    if (typeof body.username === "string" && body.username.trim()) c.username = body.username.trim();
    if (typeof body.password === "string" && body.password) c.password = body.password;
    if (typeof body.provider === "string") {
      const pv = body.provider.trim();
      if (pv) c.provider = pv;
    }
    if (body.refresh_ms !== undefined && body.refresh_ms !== null && body.refresh_ms !== "") {
      const v = parseInt(String(body.refresh_ms), 10);
      if (!Number.isNaN(v)) c.refresh_ms = Math.max(3000, v);
    }
    try {
      saveConfig(this.cfgPath, c);
    } catch (e) {
      return sendJson(res, 500, { ok: false, error: `save config failed: ${errMsg(e)}` });
    }
    this.client = new HermesClient(c); // 全新会话
    const h = (await this.client.health()) as { connected: boolean; error: string | null };
    sendJson(res, 200, {
      ok: h.connected,
      error: h.error,
      base_url: c.base_url,
      refresh_ms: c.refresh_ms,
    });
  }

  async handleProxy(u: URL, res: http.ServerResponse): Promise<void> {
    let sub: string;
    try {
      sub = decodeURIComponent(u.pathname.slice("/proxy/".length));
    } catch {
      return sendJson(res, 400, { error: "bad path" });
    }
    if (u.search) sub += u.search;
    const r = await this.client.get(sub);
    if (r.status === 0)
      return sendJson(res, 502, { error: describeConnError(this.client.base, this.client.error) || "unreachable" });
    res.writeHead(r.status, {
      "Content-Type": r.headers.get("content-type") || "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(r.body);
  }

  async route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const u = new URL(req.url || "/", "http://localhost");
    const p = u.pathname;
    const method = req.method || "GET";

    if (p === "/api/config" && method === "GET") {
      sendJson(res, 200, publicCfg(this.cfg));
      return;
    }
    if (p === "/api/config" && method === "POST") {
      await this.handleSaveConfig(req, res);
      return;
    }
    if (p === "/api/health" && method === "GET") {
      sendJson(res, 200, await this.client.health());
      return;
    }
    if (p.startsWith("/proxy/") && method === "GET") {
      await this.handleProxy(u, res);
      return;
    }
    if (method === "GET") {
      // 前端为 Vite 构建的静态产物(dist/web), 未命中具体文件时回退 index.html
      const name = p === "/" ? "index.html" : p.slice(1);
      if (!serveStatic(res, name)) serveStatic(res, "index.html");
      return;
    }
    notFound(res);
  }
}

/* ================= 启动 ================= */

interface CliArgs {
  port?: number;
  host?: string;
  config?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") out.port = parseInt(argv[++i] ?? "", 10);
    else if (a === "--host") out.host = argv[++i];
    else if (a === "--config") out.config = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log("usage: server.js [--port N] [--host H] [--config path]");
      process.exit(0);
    }
  }
  if (out.port !== undefined && Number.isNaN(out.port)) out.port = undefined;
  return out;
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  const cfgPath = cli.config || process.env.TEAMBOARD_CONFIG || path.join(process.cwd(), "config.json");
  const cfg = loadConfig(cfgPath);
  const port = cli.port ?? (process.env.TEAMBOARD_PORT ? parseInt(process.env.TEAMBOARD_PORT, 10) : undefined) ?? cfg.port;
  const host = cli.host || process.env.TEAMBOARD_HOST || "127.0.0.1";

  const srv = new Server(cfg, cfgPath);
  const server = http.createServer((req, res) => {
    srv.route(req, res).catch((e: unknown) => {
      if (!res.headersSent) sendJson(res, 500, { error: errMsg(e) });
      else res.end();
    });
  });

  server.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code === "EADDRINUSE") {
      console.error(`端口 ${port} 已被占用 — 用 --port 换一个端口`);
      process.exit(1);
    }
    throw e;
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  console.log(`Hermes TeamBoard listening on http://${host}:${port}`);
  console.log(`  -> Hermes API: ${cfg.base_url}   (config: ${cfgPath})`);
  const h = (await srv.client.health()) as { connected: boolean; error: string | null };
  console.log(
    h.connected ? "  login: OK" : `  login: FAILED (${h.error}) — 页面右上角「接口设置」可改配置`
  );
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});