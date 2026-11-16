# Hermes 多 Agent 组织看板 (TeamBoard)

把 Hermes(多 Agent 编排系统)的 Kanban 看板渲染成**组织架构树形看板**的本地看板应用。
**前后端统一 TypeScript**，后端仅用 Node 标准库（零运行时依赖），支持**本地直接运行**与 **Docker 部署**。

## 功能

- 🌳 **组织架构树**：chief(默认 profile) 在顶部，各 worker profile 在下一层，SVG 连线表达"管理/被管理"关系
- 💫 **动态管理效果**：
  - worker 干活中 → 连线青色发光 + 光点正向流动（chief→worker 派单），反向淡光点（worker→chief 回报）
  - 待审核 → 琥珀色光点反向流动（worker→chief 请求审核）
  - 就绪待派单 → 绿色慢速光点正向流动
  - 阻塞 → 红色虚线"行军"动画 + 连线中点 ⚠ 徽章
  - 疑似卡死（心跳 >45min）→ 橙色虚线 + ⌛ 徽章
- 🧑‍💼 **Agent 工作状态**：每个节点显示 工作中/阻塞/待审核/就绪/空闲 + 心跳时间 + 在做/阻塞/待审的卡数（节点带头像色块，名字哈希配色）
- 🔍 **画布缩放/平移**（d3.zoom）：滚轮缩放（0.5×–2.5×，指向光标）、空白处拖拽平移、右上角 `⌂ N%` 按钮一键复位（带 300ms 过渡动画）；节点悬停高亮其连线、淡化其余
- 📊 **团队状态卡**（ECharts，左下角，可折叠）：状态分布环形图（进行中/阻塞/待审核/就绪/排队/完成24h，中心为进行中总数）+ 各 worker 堆叠条形图（在做 + 完成24h），每轮刷新平滑动画更新
- 📋 **任务挂卡**：各 Agent 名下**未完结**的任务挂在节点下方（按状态+优先级排序）；已完成的任务不在树上显示
- 🧩 **Worker 悬浮面板**：点击任意 worker 节点 → 在节点旁弹出小悬浮面板（点空白处 / 再次点节点 / Esc 收起）：状态、描述、dispatcher/心跳信息、当前工作（全部进行中/阻塞/待审/就绪卡）、**已完成任务列表**（含结果摘要，点任意一行仍可看任务详情）
  - 支持深链直达：`http://<host>:8787/?worker=<profile>`（如 `/?worker=dev`）
- 📥 **未分配区**：未分配/待分诊的任务单独放在右侧栏，ready 超 30 分钟标"积压"
- 🗨 **聊天工作区**：右侧栏第二区块，默认展示近 24h 有活动（或正在运行）的**非 Kanban 会话**（飞书/微信/CLI 等直接进行的对话，排除 cron 巡检）。标题栏 `24h / 全部` 切换可查看全部历史会话（Hermes 最多返回最近 100 个）。状态点：绿=运行中（`is_active`，脉冲动画）、琥珀=1h 内、灰=空闲。点任意一行 → 右侧抽屉展示会话详情（状态/Profile/来源/模型/消息数/工具调用数/API 调用数 + 最近 8 条消息流）。chief 与有活跃会话的 worker 节点上会出现 `🗨 N 个聊天会话活跃` 标记。
  - 支持深链直达：`http://<host>:8787/?session=<会话id>`、`http://<host>:8787/?chatall=1`（直接以"全部"模式打开）
  - 说明：Kanban 是任务总线；chief 直接在聊天里完成的工作不产生卡片，因此在此处单列，避免"看板上看不到 agent 在干活"的盲区
- 🔍 **任务详情抽屉**：点任意卡 → 时间线、阻塞原因、最近失败、结果摘要、卡片正文、事件流、评论、诊断
- ⚙️ **接口可配置**：右上角「接口设置」在线改 Hermes 地址/账号/刷新间隔，保存即生效
- 🌗 **暗黑 / 亮色主题**：右上角一键切换，基于 antd `ConfigProvider + theme.darkAlgorithm`（非自造皮肤）；
  选择存入 `localStorage["tb-theme"]`，首帧前内联脚本先定主题、零闪烁；深链 `?theme=light|dark` 可直指定
- 🔄 **只读代理**：页面数据全部经本地后端 `/proxy/*` 拉取（自动登录 Hermes、401/403 自动重登重试），**对 Hermes 零写入**，浏览器不接触密码

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | **React 18 + antd 5**（`src/web/*.tsx` → **Vite** 构建 → `dist/web/` 带 hash 的静态产物）；组织架构树为自绘 SVG 节点 + **d3.zoom** 缩放平移 + 光点/虚线动画；状态图用 **echarts@5**；antd 提供 Button/Tag/Segmented/Tooltip/Drawer/Modal/Form 等控件与 `darkAlgorithm` 暗黑主题 |
| 后端 | TypeScript（`src/server.ts` → `tsc` → `dist/server.js`），Node 标准库 `node:http` + 全局 `fetch`，零运行时依赖 |
| 运行 | Node ≥ 18.14（开发机当前 22/23 均可）；**react/antd/d3/echarts 全部在构建期打包进静态文件**，运行期零 npm 依赖 |
| 部署 | 直接运行 或 Docker（多阶段构建，`node:22-alpine`，非 root 用户，内置 healthcheck） |

## 目录结构

```
hermes-teamboard/
├── package.json            # scripts: build / start / typecheck
├── vite.config.ts          # 前端构建入口（root=src/web → dist/web）
├── tsconfig.base.json      # 公共编译选项
├── tsconfig.server.json    # 后端 → dist/server.js
├── tsconfig.web.json       # 前端类型检查（noEmit，实际打包走 Vite）
├── src/
│   ├── server.ts           # 后端：代理 + 配置 + 静态服务（SPA 回退 index.html）
│   └── web/
│       ├── index.html      # Vite 模板：#root + 首帧主题内联脚本
│       ├── main.tsx        # React 挂载入口
│       ├── App.tsx         # 外壳：ConfigProvider(主题) / 顶栏 / 布局
│       ├── state.ts        # 数据层：轮询、派生数据、全局 store
│       ├── theme.ts        # 暗黑/亮色 调色板 + antd 主题映射
│       ├── useStore.ts     # useSyncExternalStore 订阅
│       ├── CanvasBoard.tsx # 组织树画布（d3.zoom + 光点动画）
│       ├── StatsCard.tsx   # ECharts 状态卡（双主题调色板）
│       ├── SidePanel.tsx   # 右侧栏：未分配区 + 聊天工作区
│       ├── WorkerPop.tsx   # worker 悬浮面板
│       ├── DetailDrawer.tsx# 任务/会话 详情抽屉（antd Drawer）
│       ├── SettingsModal.tsx# 接口设置弹窗（antd Modal + Form）
│       └── board.css       # 画布/节点/连线/面板样式（读 antd CSS 变量）
├── config.json             # 运行配置（Hermes 地址/账号/刷新间隔/端口）
├── Dockerfile              # 多阶段构建
├── docker-compose.yaml     # 一键部署
└── .dockerignore / .gitignore
```

## 快速开始（本地直接运行）

```bash
cd hermes-teamboard
npm install          # 安装前端依赖(react/antd/d3/echarts, 仅构建期使用)与 typescript/vite
npm run build        # tsc 编译后端 + tsc 前端类型检查 + Vite 打包前端 → dist/
npm start            # 默认 http://127.0.0.1:8787
```

打开浏览器访问 **http://127.0.0.1:8787**。

参数（可选）：

```bash
node dist/server.js --port 8787 --host 127.0.0.1 --config ./config.json
```

## Docker 部署（推荐）

### 方式一：docker compose（一键）

```bash
cd hermes-teamboard
docker compose up -d --build
# 打开 http://127.0.0.1:8787
```

- 镜像内**不含任何密码**；`config.json` 通过 volume 挂到 `/app/config.json`
  （密码留在宿主机；页面里「保存并连接」会写回该文件，配置可持久化）。
- 停止/更新：`docker compose down` / `docker compose up -d --build`
- 日志：`docker compose logs -f`

### 方式二：纯 docker

```bash
docker build -t hermes-teamboard .
docker run -d --name teamboard -p 8787:8787 \
  -v "$(pwd)/config.json:/app/config.json" \
  hermes-teamboard
```

### 配置优先级

**命令行参数 > 环境变量 > config.json > 内置默认值**

| 配置项 | 环境变量 | config.json 字段 | 默认值 |
|---|---|---|---|
| Hermes 地址 | `HERMES_BASE_URL` | `base_url` | `http://127.0.0.1:9117` |
| 用户名 | `HERMES_USERNAME` | `username` | `admin` |
| 密码 | `HERMES_PASSWORD` | `password` | — |
| 认证方式 | `HERMES_PROVIDER` | `provider` | `basic`（目标平台报 `Unknown provider` 时改为 `local` 等） |
| 刷新间隔(ms) | `HERMES_REFRESH_MS` | `refresh_ms` | `10000`（最小 3000） |
| 监听端口 | `TEAMBOARD_PORT` | `port` | `8787` |
| 监听地址 | `TEAMBOARD_HOST` | — | `127.0.0.1`（Docker 内默认 `0.0.0.0`） |
| 配置文件路径 | `TEAMBOARD_CONFIG` / `--config` | — | `./config.json` |

> 注：`node:22-alpine` 基础镜像在无法直连 docker.io 的网络环境下，可先经镜像源拉取再打标签，例如
> `docker pull docker.m.daocloud.io/library/node:22-alpine && docker tag docker.m.daocloud.io/library/node:22-alpine node:22-alpine`，
> 之后 `docker compose up -d --build` 会直接使用本地镜像。

## 当前环境配置（2026-11）

- Hermes：`http://192.18.18.200:9117`（admin / 见 config.json）
- chief = `default` profile；worker = `dept` / `project` / `dev` / `personal`
- 阈值：心跳 45min 判卡死、ready 30min 判积压、完成卡 24h 计数

## 接口

| 路径 | 说明 |
|---|---|
| `GET /` | 看板页面（`dist/web/index.html`） |
| `GET /assets/<file>` | Vite 打包产物（带 hash 的 js/css） |
| `GET /api/config` | 当前配置（密码脱敏为 `password_set`） |
| `POST /api/config` | 保存配置并即时重连（密码留空=不修改） |
| `GET /api/health` | 连接状态 + Kanban 统计摘要 |
| `GET /proxy/<path>` | 透传 Hermes API（自动带会话 cookie，401/403 自动重登重试） |

> 其余任意 GET 路径回退 `index.html`（SPA 语义，便于日后加前端路由）。

## 备注

- **零侵入**：本看板对 Hermes 只读（GET），不建卡、不改状态、不发评论；
  所有写操作都请走 Hermes 原有界面/CLI/agent。
- 自动分诊（auto-decomposer）会认领 triage 卡并派单，因此看板**不**提供任何建卡入口。
- 数据新鲜度 = `refresh_ms`（默认 10s）+ 后端单次上游超时 20s；Hermes 不可达时页面保留最后成功数据，
  顶栏红点 + 一句简短中文错误（如「用户名或密码错误 (192.18.18.200:9117)」），恢复后自动变回绿点——**不用 toast 横幅**。
- 登录失败后 30 秒内不再重试登录（复用上次错误），避免轮询把目标平台打出 429 限流。
- 错误文案分档：端口无效 / 域名无法解析 / 连接被拒绝 / 连接超时 / TLS 证书 / 用户名或密码错误 /
  登录过于频繁(429) / 认证方式不匹配(404，提示改 provider)，均附目标 host:port。
- 配置保存先写临时文件再 rename；bind mount 下 rename 报 EBUSY 时自动回退为同 inode 原地写入。
- **上游 Hermes 端点**（均经 `/proxy/*` 透传，GET 只读）：Kanban 看板 `api/plugins/kanban/board`、worker 心跳 `workers/active`、统计 `stats`、profile 花名册 `profiles`、诊断 `diagnostics`、任务详情 `tasks/<id>`；聊天工作区用 `api/sessions?limit=100`（列表）与 `api/sessions/<id>` / `api/sessions/<id>/messages`（抽屉详情）。
- **离线友好**：react / antd / d3 / echarts 由 Vite 在构建期打包进 `dist/web/` 的本地静态文件，
  页面只从自身加载资源，不走 CDN；断外网也能完整显示看板与图表，运行期零 npm 依赖。
- **主题**：深色/浅色由 antd `ConfigProvider` 的 `darkAlgorithm`/`defaultAlgorithm` 驱动（组件库原生能力，
  非自造 CSS 皮肤）；画布自绘部分（节点/连线/状态色）跟随同一 `data-theme` 属性切换，
  两种主题各配一套与界面协调的调色板；ECharts 图表随主题重建配色。