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
  /** 结束时间戳：完成/失败/取消时由后端状态推送写入；排队中/进行中为 null */
  finishedAt: number | null;
  cwd?: string;
}

export interface Recent {
  name: string;
  path: string;
  time: string;
  size: string;
}

/** 源文件元信息（由后端 probe_media_info 提供，用于压缩页预估输出） */
export interface MediaInfo {
  size: number;
  duration: number;
  videoBitrate: number | null;
  videoWidth: number | null;
  videoHeight: number | null;
}

export const store = reactive({
  tab: "dashboard",
  dark: false,
  inputFile: "",
  /** 当前输入文件的元信息（size / duration / video_bitrate …），由 probeInput() 填充 */
  inputInfo: null as MediaInfo | null,
  /** 探测当前输入文件进行中 */
  inputProbing: false,
  /** 探测失败原因（成功或换文件时清空） */
  inputProbeErr: "",
  recent: [] as Recent[],
  tasks: [] as Task[],
  /** 队列是否整体暂停：暂停后不再拉起新任务，已在进行中的继续跑完 */
  paused: false,
  /** 同时运行的任务数（1 = 串行，最大见 MAX_CONCURRENCY） */
  concurrency: 2,
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
  /** 轻量提示（加入队列等操作的反馈），由 App.vue 渲染 */
  toast: { msg: "", type: "info" as "info" | "success" | "error", key: 0 },

  // ===== 录制采集会话（独立于任务队列）=====
  /** 是否正在录制。录制期间不允许再开始新录制，也不进任务队列。 */
  recording: false,
  /** 录制已持续的秒数（由后端推送的 record-progress 事件驱动更新） */
  recordElapsed: 0,
  /** 录制开始时的输出文件名（不含路径，仅文件名） */
  recordOutput: "",
  /** 录制结束后的状态：done / failed / canceled，进行中为空 */
  recordState: "",
  /** 录制失败/异常时的说明 */
  recordNote: "",
});

let toastTimer: number | undefined;
export function showToast(
  msg: string,
  type: "info" | "success" | "error" = "success"
) {
  store.toast.msg = msg;
  store.toast.type = type;
  store.toast.key++;
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    store.toast.msg = "";
  }, 2600);
}

/** 主题持久化到本地存储（WebView 的用户数据目录，重启后仍在） */
const THEME_KEY = "ffs-theme";
/** 队列并行数持久化到本地存储（不需要后端配合，纯前端设置） */
const CONCURRENCY_KEY = "ffs-concurrency";
export const MIN_CONCURRENCY = 1;
export const MAX_CONCURRENCY = 4;

export async function initStore() {
  // 主题：先从本地存储恢复，再应用（避免启动瞬间闪浅色）
  try {
    store.dark = localStorage.getItem(THEME_KEY) === "dark";
  } catch {
    /* 忽略 */
  }
  // 队列并行数：从本地存储恢复（夹在合法区间内）
  try {
    const c = Number(localStorage.getItem(CONCURRENCY_KEY));
    if (Number.isFinite(c) && c >= MIN_CONCURRENCY && c <= MAX_CONCURRENCY) {
      store.concurrency = Math.floor(c);
    }
  } catch {
    /* 忽略 */
  }
  applyTheme();
  await listen<FfmpegProgress>("ffmpeg-progress", (e) => onProgress(e.payload));
  // 录制会话进度事件：与 ffmpeg-progress 互补，专门推送录制开始/结束/时长
  await listen<RecordProgressPayload>("record-progress", (e) => onRecordProgress(e.payload));
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

/** 后端推送的录制会话事件载荷（isRecording=false 时表示会话结束） */
interface RecordProgressPayload {
  isRecording: boolean;
  elapsed?: number;
  state?: "done" | "failed" | "canceled" | "";
  output?: string;
  note?: string;
}

function onRecordProgress(p: RecordProgressPayload) {
  if (p.isRecording) {
    store.recording = true;
    if (typeof p.elapsed === "number") store.recordElapsed = p.elapsed;
    return;
  }
  // 会话结束
  store.recording = false;
  store.recordState = p.state || "";
  store.recordNote = p.note || "";
  if (p.output) store.recordOutput = p.output;
  // 录制失败时闪窗口提醒（与任务完成通知一致的产品语义）
  if (p.state === "failed" && store.notifyOnDone) {
    showToast(p.note || "录制异常结束", "error");
  } else if (p.state === "done") {
    showToast(`录制完成：${p.output || "文件"}`, "success");
  }
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

// ===== 录制采集（独立会话，不进任务队列）=====

/**
 * 启动录制：把前端拼好的 ffmpeg 命令交给后端拉起子进程。
 * 与 queueTask 不同——这里没有"排队"概念，立即执行，且全局只能有一段。
 */
export async function startRecording(cmd: string, outDir: string): Promise<void> {
  if (store.recording) {
    showToast("已有录制在进行，请先停止再开始新的录制", "error");
    return;
  }
  try {
    await invoke("start_record", { opts: { cmd, outDir } });
    store.recording = true;
    store.recordElapsed = 0;
    store.recordState = "";
    store.recordNote = "";
    // 输出名后端会从命令行末尾反查，这里用占位，结束时由事件覆盖
    store.recordOutput = "";
    showToast("录制已开始");
  } catch (e) {
    showToast(typeof e === "string" ? e : "启动录制失败", "error");
  }
}

/** 停止录制：优雅收尾（后端向 ffmpeg 的 stdin 写 q，让它写完容器尾部） */
export async function stopRecording(): Promise<void> {
  try {
    await invoke("stop_record");
  } catch (e) {
    showToast(typeof e === "string" ? e : "停止录制失败", "error");
  }
}

/** 列出物理显示器（gdigrab 设备枚举） */
export async function listDisplays(): Promise<
  { x: number; y: number; width: number; height: number; normalizedX: number; index: number }[]
> {
  try {
    return await invoke<{
      x: number;
      y: number;
      width: number;
      height: number;
      normalizedX: number;
      index: number;
    }[]>("list_displays");
  } catch (e) {
    console.error("list_displays failed:", e);
    return [];
  }
}

/** 列出 DShow 视频/音频设备 */
export async function listDevices(): Promise<
  { kind: "video" | "audio"; name: string; identifier: string }[]
> {
  try {
    return await invoke("list_devices");
  } catch (e) {
    console.error("list_devices failed:", e);
    return [];
  }
}

/** 选择录制输出目录（原生文件夹对话框） */
export async function pickRecordDir(): Promise<string | null> {
  try {
    return await invoke<string | null>("pick_record_dir");
  } catch (e) {
    console.error(e);
    return null;
  }
}

export async function pickInput() {
  try {
    const p = await invoke<string | null>("pick_file");
    if (p) setInputFile(p);
  } catch (e) {
    console.error(e);
  }
}

/** 选择文件夹并递归收集其中的媒体文件（用于批处理） */
export async function pickFolderFiles(): Promise<string[]> {
  try {
    const list = await invoke<string[]>("pick_folder_files");
    return list || [];
  } catch (e) {
    console.error(e);
    return [];
  }
}

export function setInputFile(path: string) {
  store.inputFile = path;
  store.inputInfo = null;
  store.inputProbeErr = "";
  store.inputProbing = true;
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
  // 新文件选上后立即探测元信息（失败也不阻塞；UI 显示「读取中…」之类的占位）
  probeInput().catch(() => {
    /* 忽略：探测失败时 UI 自然回退到占位文案 */
  });
}

/** 探测当前输入文件的元信息（size / duration / videoBitrate …）并写入 store.inputInfo */
export async function probeInput(): Promise<MediaInfo | null> {
  if (!store.inputFile) {
    store.inputInfo = null;
    store.inputProbing = false;
    store.inputProbeErr = "";
    return null;
  }
  store.inputProbing = true;
  store.inputProbeErr = "";
  try {
    const info = await invoke<MediaInfo>("probe_media_info", { path: store.inputFile });
    store.inputInfo = info;
    return info;
  } catch (e) {
    store.inputInfo = null;
    store.inputProbeErr = typeof e === "string" ? e : "无法读取媒体信息";
    return null;
  } finally {
    store.inputProbing = false;
  }
}

function newId() {
  return (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random()}`;
}

export function queueTask(name: string, cmd: string, cwd?: string) {
  store.tasks.push({
    id: newId(),
    name,
    cmd,
    status: "queued",
    progress: 0,
    time: "",
    speed: "",
    startedAt: null,
    finishedAt: null,
    cwd,
  });
  showToast(`已加入队列：${name}`);
  pump();
}

export function queueTasks(items: { name: string; cmd: string; cwd?: string }[]) {
  items.forEach((it) =>
    store.tasks.push({
      id: newId(),
      name: it.name,
      cmd: it.cmd,
      status: "queued",
      progress: 0,
      time: "",
      speed: "",
      startedAt: null,
      finishedAt: null,
      cwd: it.cwd,
    })
  );
  showToast(`已加入队列：${items.length} 个任务`);
  pump();
}

/**
 * 按并发数（store.concurrency）并行拉起排队中的任务。
 * 队列是先进先出：数组靠前的先入队、先被拉起（queueTask 用 push 入队）。
 * 暂停时直接返回，不再拉起新任务（进行中的继续跑完）。
 */
function pump() {
  if (store.paused) return;
  const running = store.tasks.filter((t) => t.status === "running").length;
  let slots = store.concurrency - running;
  if (slots <= 0) return;
  for (const t of store.tasks) {
    if (slots <= 0) break;
    if (t.status !== "queued") continue;
    t.status = "running";
    t.startedAt = Date.now();
    slots--;
    invoke("run_ffmpeg", { id: t.id, cmd: t.cmd, cwd: t.cwd || null }).catch((e) => {
      t.status = "failed";
      t.note = typeof e === "string" ? e : "启动失败";
      pump();
    });
  }
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
    t.finishedAt = Date.now();
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
    t.finishedAt = null;
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

// ===== 队列级控制 =====

/** 暂停整个队列：已在进行中的任务继续跑完，但不再拉起新任务 */
export function pauseQueue() {
  store.paused = true;
}

/** 继续队列：解除暂停并立即尝试拉起等待中的任务 */
export function resumeQueue() {
  if (!store.paused) return;
  store.paused = false;
  pump();
}

/** 调整并发数（夹在 [MIN, MAX] 区间内），写盘后立即尝试拉起更多等待中的任务 */
export function setConcurrency(n: number) {
  const v = Math.max(
    MIN_CONCURRENCY,
    Math.min(MAX_CONCURRENCY, Math.floor(Number(n)) || MIN_CONCURRENCY)
  );
  store.concurrency = v;
  try {
    localStorage.setItem(CONCURRENCY_KEY, String(v));
  } catch {
    /* 忽略 */
  }
  if (!store.paused) pump();
}

/** 把所有失败/已取消的任务批量重置为排队并重跑 */
export function retryAllFailed() {
  store.tasks.forEach((t) => {
    if (t.status === "failed" || t.status === "canceled") {
      t.status = "queued";
      t.progress = 0;
      t.startedAt = null;
      t.finishedAt = null;
      t.note = undefined;
      t.time = "";
      t.speed = "";
      clearTaskLog(t.id); // 上一轮输出不再保留，详情里只看本轮
    }
  });
  pump();
}

/** 只移除失败/已取消的任务，保留排队中、进行中、已完成 */
export function clearFailed() {
  store.tasks
    .filter((t) => t.status === "failed" || t.status === "canceled")
    .forEach((t) => clearTaskLog(t.id));
  store.tasks = store.tasks.filter(
    (t) => t.status !== "failed" && t.status !== "canceled"
  );
}

/** 一次性移除队列里所有任务（进行中的先取消） */
export async function clearAll() {
  const running = store.tasks.filter((t) => t.status === "running");
  await Promise.all(running.map((t) => cancelTask(t.id).catch(() => {})));
  store.tasks.forEach((t) => clearTaskLog(t.id));
  store.tasks = [];
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
