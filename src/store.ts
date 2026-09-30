import { reactive } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { dirOf } from "./lib/format";

export type TaskStatus = "queued" | "running" | "done" | "canceled" | "failed";

export interface Task {
  id: string;
  name: string;
  cmd: string;
  status: TaskStatus;
  /** 0..100；负数表示不确定进度 */
  progress: number;
  time: string;
  speed: string;
  note?: string;
  startedAt: number | null;
  cwd?: string;
}

export interface Recent {
  name: string;
  path: string;
  time: string;
  size: string;
}

export const store = reactive({
  tab: "dashboard",
  dark: false,
  inputFile: "",
  recent: [] as Recent[],
  tasks: [] as Task[],
  // 引擎状态
  engineMsg: "检测中…",
  engineOk: false,
  ffmpegPath: "ffmpeg",
  // ===== 以下为持久化设置（存在后端 config.json）=====
  /** 输出文件已存在时是否覆盖（false 时用 -n 直接跳过） */
  overwrite: true,
  /** 任务完成后是否闪动窗口提醒 */
  notifyOnDone: true,
  /** 转换页当前容器，同时就是设置里的「默认容器」 */
  fmt: "mp4",
  /** 压缩页当前 CRF，同时就是设置里的「默认 CRF」 */
  crf: 23,
});

/** 主题持久化到本地存储（WebView 的用户数据目录，重启后仍在） */
const THEME_KEY = "ffs-theme";

export async function initStore() {
  // 主题：先从本地存储恢复，再应用（避免启动瞬间闪浅色）
  try {
    store.dark = localStorage.getItem(THEME_KEY) === "dark";
  } catch {
    /* 忽略 */
  }
  applyTheme();
  await listen<FfmpegProgress>("ffmpeg-progress", (e) => onProgress(e.payload));
  await loadSettings();
  try {
    const ver = await invoke<string>("ffmpeg_version");
    store.engineMsg = ver;
    store.engineOk = true;
  } catch (e) {
    store.engineMsg = typeof e === "string" ? e : "FFmpeg 不可用";
    store.engineOk = false;
  }
}

/** 后端持久化的设置（字段名与 Rust 侧 serde camelCase 一致） */
export interface AppSettings {
  ffmpegPath: string;
  overwrite: boolean;
  defaultFmt: string;
  defaultCrf: number;
  notifyOnDone: boolean;
}

function currentSettings(): AppSettings {
  return {
    ffmpegPath: store.ffmpegPath,
    overwrite: store.overwrite,
    defaultFmt: store.fmt,
    defaultCrf: store.crf,
    notifyOnDone: store.notifyOnDone,
  };
}

/** 从磁盘读取设置并回填 store */
export async function loadSettings() {
  try {
    const s = await invoke<AppSettings>("get_settings");
    store.ffmpegPath = s.ffmpegPath || "ffmpeg";
    store.overwrite = s.overwrite !== false;
    store.notifyOnDone = s.notifyOnDone !== false;
    store.fmt = s.defaultFmt || "mp4";
    store.crf = typeof s.defaultCrf === "number" ? s.defaultCrf : 23;
  } catch {
    /* 忽略：用默认值 */
  }
}

/** 把当前设置写盘（失败不阻塞 UI） */
export async function saveSettings() {
  try {
    await invoke("set_settings", { settings: currentSettings() });
  } catch (e) {
    console.error(e);
  }
}

interface FfmpegProgress {
  id: string;
  progress: number;
  time: string;
  speed: string;
  state: "running" | "done" | "failed" | "canceled";
  note?: string;
}

export function applyTheme() {
  document.documentElement.classList.toggle("dark", store.dark);
}

export function toggleTheme() {
  store.dark = !store.dark;
  try {
    localStorage.setItem(THEME_KEY, store.dark ? "dark" : "light");
  } catch {
    /* 忽略 */
  }
  applyTheme();
}

export function setTab(tab: string) {
  store.tab = tab;
}

export async function pickInput() {
  try {
    const p = await invoke<string | null>("pick_file");
    if (p) setInputFile(p);
  } catch (e) {
    console.error(e);
  }
}

export function setInputFile(path: string) {
  store.inputFile = path;
  const now = new Date();
  const time = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(
    2,
    "0"
  )}`;
  const name = path.split(/[\\/]/).pop() || path;
  store.recent = store.recent.filter((r) => r.path !== path);
  store.recent.unshift({ name, path, time, size: "—" });
  if (store.recent.length > 8) store.recent.length = 8;
}

function newId() {
  return (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random()}`;
}

export function queueTask(name: string, cmd: string, cwd?: string) {
  store.tasks.unshift({
    id: newId(),
    name,
    cmd,
    status: "queued",
    progress: 0,
    time: "",
    speed: "",
    startedAt: null,
    cwd,
  });
  pump();
}

export function queueTasks(items: { name: string; cmd: string; cwd?: string }[]) {
  items.forEach((it) =>
    store.tasks.unshift({
      id: newId(),
      name: it.name,
      cmd: it.cmd,
      status: "queued",
      progress: 0,
      time: "",
      speed: "",
      startedAt: null,
      cwd: it.cwd,
    })
  );
  pump();
}

/** 同一时刻只跑一个任务；其余排队，跑完自动触发下一个 */
function pump() {
  if (store.tasks.some((t) => t.status === "running")) return;
  const next = store.tasks.find((t) => t.status === "queued");
  if (!next) return;
  next.status = "running";
  next.startedAt = Date.now();
  invoke("run_ffmpeg", { id: next.id, cmd: next.cmd, cwd: next.cwd || null }).catch((e) => {
    next.status = "failed";
    next.note = typeof e === "string" ? e : "启动失败";
    pump();
  });
}

function onProgress(p: FfmpegProgress) {
  const t = store.tasks.find((x) => x.id === p.id);
  if (!t) return;
  t.time = p.time;
  t.speed = p.speed;
  if (p.note) t.note = p.note;
  if (p.state === "running") {
    if (p.progress >= 0) t.progress = p.progress;
    else t.progress = -1; // 不确定进度
  } else {
    t.status = p.state;
    if (p.state === "done") t.progress = 100;
    t.startedAt = t.startedAt ?? Date.now();
  }
  if (p.state !== "running") pump();
}

export async function cancelTask(id: string) {
  try {
    await invoke("cancel_ffmpeg", { id });
  } catch (e) {
    console.error(e);
  }
}

export function retryTask(id: string) {
  const t = store.tasks.find((x) => x.id === id);
  if (t && (t.status === "failed" || t.status === "canceled")) {
    t.status = "queued";
    t.progress = 0;
    t.startedAt = null;
    t.note = undefined;
    t.time = "";
    t.speed = "";
    clearTaskLog(id); // 上一轮的输出不再保留，详情里只看本轮
    pump();
  }
}

export function removeTask(id: string) {
  store.tasks = store.tasks.filter((t) => t.id !== id);
  clearTaskLog(id);
}

export function clearDone() {
  store.tasks.filter((t) => t.status === "done").forEach((t) => clearTaskLog(t.id));
  store.tasks = store.tasks.filter((t) => t.status !== "done");
}

/** 读取任务已收集的 ffmpeg 输出日志（用于「详情」面板，运行中可反复调用） */
export async function fetchTaskLog(id: string): Promise<string> {
  try {
    return await invoke<string>("get_task_log", { id });
  } catch {
    return "";
  }
}

/** 后端日志缓冲没用了就清掉（fire-and-forget，失败无所谓） */
export function clearTaskLog(id: string) {
  invoke("clear_task_log", { id }).catch(() => {
    /* 忽略 */
  });
}

/** 当前输入文件的目录，作为后端运行 cwd（命令中的相对输出路径将落在此目录） */
export function inputCwd(): string | undefined {
  return store.inputFile ? dirOf(store.inputFile) || undefined : undefined;
}

/**
 * 把命令开头的 `ffmpeg` 占位换成设置里配置的引擎路径。
 * 后端执行时本就使用配置路径（丢弃命令里的首个 token），这里让「预览/复制/入队」的文本与之一致：
 * 既如实显示，复制到终端也能直接跑（路径含空格时自动加引号）。
 */
export function resolveFfmpeg(cmd: string): string {
  const bin = (store.ffmpegPath || "ffmpeg").trim() || "ffmpeg";
  if (!cmd.startsWith("ffmpeg")) return cmd;
  const shown = /\s/.test(bin) ? `"${bin}"` : bin;
  return shown + cmd.slice("ffmpeg".length);
}
