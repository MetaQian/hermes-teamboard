/**
 * 主题定义 — 暗黑/亮色由 antd 的 theme.darkAlgorithm / defaultAlgorithm 驱动,
 * 本模块只管 antd token 体系之外的部分: 画布状态色(任务状态/连线/光点)与 ECharts 配色。
 * 状态色同时写入 :root 的 --c-* CSS 变量, 供画布 CSS(color-mix) 与 ECharts 使用。
 */

export type ThemeMode = "dark" | "light";

export interface StatusPalette {
  run: string;
  block: string;
  review: string;
  ready: string;
  todo: string;
  triage: string;
  done: string;
  chief: string;
  stale: string;
  /** 连线快速亮火花 */
  spark: string;
  /** 连线次级蓝点 */
  blue2: string;
  /** 画布点阵网格 */
  dot: string;
}

/** 亮色主题下状态色整体加深, 保证白底对比度 */
export const PALETTES: Record<ThemeMode, StatusPalette> = {
  dark: {
    run: "#22d3ee", block: "#f87171", review: "#fbbf24", ready: "#a3e635",
    todo: "#94a3b8", triage: "#c084fc", done: "#546079", chief: "#60a5fa", stale: "#fb923c",
    spark: "#e0faff", blue2: "#60a5fa", dot: "#18234a",
  },
  light: {
    run: "#0891b2", block: "#dc2626", review: "#b45309", ready: "#4d7c0f",
    todo: "#64748b", triage: "#7e22ce", done: "#94a3b8", chief: "#2563eb", stale: "#c2410c",
    spark: "#0e7490", blue2: "#2563eb", dot: "#c9d4e8",
  },
};

export interface ChartPalette {
  barRun: string;
  barDone: string;
  track: string;
  sliceBorder: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  axisLabel: string;
  axisLabelDim: string;
  splitLine: string;
  axisPointer: string;
}

export const CHARTS: Record<ThemeMode, ChartPalette> = {
  dark: {
    barRun: "#22d3ee", barDone: "#546079", track: "#151d38", sliceBorder: "#0e1630",
    tooltipBg: "#0d1428", tooltipBorder: "#2a3a66", tooltipText: "#e6ebf5",
    axisLabel: "#5a6580", axisLabelDim: "#9aa5bd", splitLine: "#1c2748", axisPointer: "#1e2a4a44",
  },
  light: {
    barRun: "#0891b2", barDone: "#94a3b8", track: "#e5eaf3", sliceBorder: "#ffffff",
    tooltipBg: "#ffffff", tooltipBorder: "#d9e1ef", tooltipText: "#1b2436",
    axisLabel: "#8494ad", axisLabelDim: "#5a6a85", splitLine: "#e2e8f4", axisPointer: "#64748b22",
  },
};

/** 节点/卡片等渐变表面色与阴影(antd token 之外的画布专属色) */
export interface Surfaces {
  nA: string;
  nB: string;
  cA: string;
  cB: string;
  zoomBg: string;
  asideBg: string;
  shadow: string;
  shadowSoft: string;
  userFg: string;
}

export const SURFACES: Record<ThemeMode, Surfaces> = {
  dark: {
    nA: "#141f3d", nB: "#0f1730", cA: "#16234a", cB: "#101a38",
    zoomBg: "rgba(13,20,40,.85)", asideBg: "rgba(13,20,40,.5)",
    shadow: "#000000aa", shadowSoft: "#00000066", userFg: "#93c5fd",
  },
  light: {
    nA: "#ffffff", nB: "#f3f6fc", cA: "#eef4ff", cB: "#e6eefc",
    zoomBg: "rgba(255,255,255,.88)", asideBg: "rgba(246,248,252,.65)",
    shadow: "#1e293b33", shadowSoft: "#1e293b22", userFg: "#1d4ed8",
  },
};

const THEME_KEY = "tb-theme";

export function initialTheme(): ThemeMode {
  try {
    const q = new URLSearchParams(location.search).get("theme");
    if (q === "light" || q === "dark") return q;
    const s = localStorage.getItem(THEME_KEY);
    if (s === "light" || s === "dark") return s;
  } catch {
    /* ignore */
  }
  return "dark";
}

export function persistTheme(m: ThemeMode): void {
  try {
    localStorage.setItem(THEME_KEY, m);
  } catch {
    /* ignore */
  }
}

/** 把当前主题的状态色/表面色写入 :root(--c-* / --n-* / ...), 画布 CSS 与 ECharts 共用 */
export function applyStatusVars(m: ThemeMode): void {
  const p = PALETTES[m];
  const s = SURFACES[m];
  const rs = document.documentElement.style;
  rs.setProperty("--tb-bg", m === "dark" ? "#0a0f1e" : "#f5f5f5");
  for (const k of Object.keys(p) as (keyof StatusPalette)[]) rs.setProperty("--c-" + k, p[k]);
  rs.setProperty("--n-a", s.nA);
  rs.setProperty("--n-b", s.nB);
  rs.setProperty("--c-a", s.cA);
  rs.setProperty("--c-b", s.cB);
  rs.setProperty("--zoom-bg", s.zoomBg);
  rs.setProperty("--aside-bg", s.asideBg);
  rs.setProperty("--pop-shadow", s.shadow);
  rs.setProperty("--pop-shadow-soft", s.shadowSoft);
  rs.setProperty("--user-fg", s.userFg);
}