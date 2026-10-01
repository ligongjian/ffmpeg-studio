/**
 * 全站导航的单一数据源。
 *
 * 侧栏（Sidebar）、顶栏标题（Topbar）、工作台「快速开始」（Dashboard）三处都从这里派生。
 * 新增功能模块**只需在此追加一项**，不要再各自维护清单——历史上因为分头维护，
 * 出现过「侧栏加了 audio/gif/info 但顶栏 TITLES 没加」和「快速开始漏掉这三个新模块」
 * 两次不同步。
 */
export interface NavItem {
  tab: string;
  /** 侧栏标签，同时作为顶栏标题（两处字面必须一致） */
  label: string;
  /** 侧栏图标的 SVG 内部片段（不含外层 <svg>） */
  icon: string;
  /** 顶栏副标题 */
  desc: string;
}

export const NAV: NavItem[] = [
  { tab: "dashboard", label: "工作台", desc: "总览与快速开始", icon: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>' },
  { tab: "convert", label: "格式转换", desc: "容器互转与编解码", icon: '<path d="M4 7h11l-3-3M20 17H9l3 3" stroke-linecap="round" stroke-linejoin="round"/>' },
  { tab: "compress", label: "压缩优化", desc: "CRF / 预设 / 码率控制", icon: '<path d="M3 8h6l-2-2M21 16h-6l2 2" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 8v8M15 8v8"/>' },
  { tab: "cut", label: "剪辑分割", desc: "时间轴精确截取", icon: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.5 15.5M14.5 14.5L20 20M8.5 8.5L12 12" stroke-linecap="round"/>' },
  { tab: "merge", label: "拼接合并", desc: "多文件顺序合并", icon: '<path d="M8 4v16M16 4v16M8 12h8" stroke-linecap="round"/>' },
  { tab: "extract", label: "提取分离", desc: "音视频 / 帧 / 缩略图", icon: '<path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" stroke-linecap="round" stroke-linejoin="round"/>' },
  { tab: "watermark", label: "水印字幕", desc: "图片 / 文字 / 硬字幕", icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 15l5-5 4 4 3-3 6 6" stroke-linecap="round" stroke-linejoin="round"/>' },
  { tab: "filters", label: "滤镜调色", desc: "叠加式滤镜链", icon: '<path d="M3 4h18l-7 8v6l-4 2v-8L3 4z" stroke-linecap="round" stroke-linejoin="round"/>' },
  { tab: "audio", label: "音频处理", desc: "转码 / 调音 / 拼接", icon: '<path d="M9 18V6l10-2v12M9 13l10-2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>' },
  { tab: "gif", label: "动图 GIF", desc: "调色板两步法", icon: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 9h2a2 2 0 110 4H9V9zm5 0v6m3-6v6" stroke-linecap="round" stroke-linejoin="round"/>' },
  { tab: "info", label: "媒体信息", desc: "探针与元数据", icon: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01" stroke-linecap="round"/>' },
  { tab: "record", label: "录制采集", desc: "屏幕 / 摄像头 / 画中画", icon: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3" fill="currentColor"/>' },
  { tab: "stream", label: "流媒体", desc: "RTMP / HLS 推拉流", icon: '<path d="M3 7l4 4-4 4M11 16h7M11 12h7M11 8h7" stroke-linecap="round" stroke-linejoin="round"/>' },
  { tab: "batch", label: "批量处理", desc: "目录级批处理", icon: '<rect x="3" y="4" width="18" height="4" rx="1"/><rect x="3" y="10" width="18" height="4" rx="1"/><rect x="3" y="16" width="18" height="4" rx="1"/>' },
  { tab: "tasks", label: "任务队列", desc: "运行中的任务与历史", icon: '<path d="M4 6h16M4 12h16M4 18h10" stroke-linecap="round"/>' },
];

/** 不在侧栏显示、但需要顶栏标题的页面（设置页由侧栏底部齿轮进入） */
const EXTRA_TITLES: Record<string, [string, string]> = {
  settings: ["设置", "引擎与默认项"],
};

/** 顶栏标题映射：[标题, 副标题] */
export const TITLES: Record<string, [string, string]> = {
  ...Object.fromEntries(NAV.map((n) => [n.tab, [n.label, n.desc]])),
  ...EXTRA_TITLES,
};

/**
 * 工作台「快速开始」的功能入口。
 * 直接由 NAV 派生（排除工作台自身与任务队列这类非处理页），
 * 保证新增模块后不会出现「侧栏有、快速开始没有」的不同步。
 */
export const QUICK: { tab: string; label: string; icon: string }[] = NAV.filter(
  (n) => n.tab !== "dashboard" && n.tab !== "tasks"
).map((n) => ({ tab: n.tab, label: n.label, icon: n.icon }));
