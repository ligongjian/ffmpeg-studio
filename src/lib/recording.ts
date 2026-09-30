// 录制采集的命令构建器。
// 录制不走任务队列（见 store.ts 的 record 会话），这里只负责把前端选好的参数
// 拼成一条合法的 ffmpeg 命令行——后端 start_record 收到后丢弃首个占位 token
// 并用配置的 ffmpeg 路径执行。
//
// 关键设计点：
// 1. 输出容器默认 MKV：MKV 是流式容器，边写边可恢复；MP4 的 moov 原子必须
//    在文件末尾写完，异常退出会让整个文件无法播放。只有用户显式选 MP4 时才
//    用 MP4，并且必须在停止时走优雅收尾（stdin 写 q）才有救。
// 2. 编码器按容器自适应：MKV/MOV 用 libx264（mp4v 不支持 B 帧的容器兼容更好），
//    纯 MP4 也用 libx264；音频统一用 libmp3lame 或直接 AAC（MKV 更宽容）。
// 3. 分辨率/帧率/偏移量都按实际采集源动态填，不再写死。

export type RecordMode = "screen" | "cam" | "both";

export interface RecordOpts {
  mode: RecordMode;
  /** 显示器：gdigrab 的 -offset_x / -offset_y（屏幕坐标，不是索引） */
  displayX: number;
  displayY: number;
  /** 所选显示器的真实像素尺寸，用作 gdigrab -video_size 锁定单屏捕获区域 */
  captureW: number;
  captureH: number;
  /** 摄像头设备名（dshow 的 video=...） */
  cameraDevice: string;
  /** 音频源：系统音频（屏幕录制）/ 麦克风（摄像头）/ 无声 */
  audioSource: "system" | "mic" | "none";
  /** 音频设备名（dshow 的 audio=...） */
  audioDevice: string;
  /** 输出分辨率，如 "1920x1080"；空字符串 = 跟随源 */
  resolution: string;
  fps: number;
  /** 视频编码器：libx264（兼容性优先）/ libx265rgb（更省空间）*/
  vEnc: "libx264" | "libx265rgb";
  /** 视频码率（Mbps） */
  vBitrateMbps: number;
  /** 输出容器 */
  fmt: "mkv" | "mp4" | "mov";
  /** 画中画时摄像头画面的缩放百分比（相对主画面） */
  camScalePct: number;
  /** 输出文件名（不含路径，仅文件名，扩展名已含） */
  outName: string;
}

/**
 * 把 dshow 设备名安全地放进命令里。设备名里常含括号、空格、中文，
 * dshow 的设备标识在 `-i "video=...;audio=..."` 这种复合字符串里，
 * 整体用双引号包裹即可（ffmpeg 自己的 token 解析会处理）。
 */
function qDevice(s: string): string {
  return `"${s.replace(/"/g, '\\"')}"`;
}

/**
 * 把「目标分辨率」选项转成 scale 滤镜串。
 * - 未选（跟随源）或不合法 → null（不缩放，输出等于捕获区域尺寸）
 * - 与捕获区域尺寸相同 → null（没必要缩放）
 * - 否则 → "scale=W:H"，把全屏捕获缩放成目标输出分辨率
 * 注意：输出尺寸强制偶数（H.264/yuv420 要求），避免奇数尺寸报错。
 */
function resolutionScale(
  resolution: string,
  captureW: number,
  captureH: number
): string | null {
  if (!resolution) return null;
  const m = /^(\d+)x(\d+)$/.exec(resolution.trim());
  if (!m) return null;
  const w = parseInt(m[1], 10);
  const h = parseInt(m[2], 10);
  if (!w || !h) return null;
  if (captureW && captureH && w === captureW && h === captureH) return null;
  const ew = w % 2 === 0 ? w : w - 1;
  const eh = h % 2 === 0 ? h : h - 1;
  return `scale=${ew}:${eh}`;
}

/** 屏幕录制（gdigrab，Windows）。输出名由调用方提供，已带时间戳。 */
function buildScreen(o: RecordOpts): string[] {
  const parts: string[] = [];
  // gdigrab：-offset_x/-offset_y 指定屏幕坐标（物理像素），-draw_mouse 1 捕获光标
  // （注意：gdigrab 没有 -cursor 选项，控制光标的是 -draw_mouse 0/1）
  parts.push("-f gdigrab");
  parts.push("-offset_x", String(o.displayX));
  parts.push("-offset_y", String(o.displayY));
  parts.push("-draw_mouse 1");
  // 始终用所选显示器的真实尺寸作为捕获区域（-video_size），确保只录那一块屏，
  // 而不是 gdigrab 默认的「整个虚拟桌面（多屏拼接）」。
  if (o.captureW && o.captureH) {
    parts.push("-video_size", `${o.captureW}x${o.captureH}`);
  }
  parts.push("-framerate", String(o.fps));
  parts.push("-i desktop");

  // 输出分辨率：与捕获区域不一致时，用 scale 滤镜把全屏缩放成目标分辨率
  // （旧逻辑直接把 -video_size 设成目标值，会变成「裁切左上角」而非「缩放全屏」）。
  const scale = resolutionScale(o.resolution, o.captureW, o.captureH);
  if (scale) parts.push("-vf", scale);

  // 音频：系统音频在 Windows 下没有原生 demuxer，gdigrab 只能录画面。
  // 因此系统音频必须走 dshow 的 "Stereo Mix" 之类，或者干脆提示用户。
  // 这里：mic → dshow 麦克风；system → 留空（提示用户安装虚拟音频线）；none → -an
  if (o.audioSource === "mic" && o.audioDevice) {
    parts.push("-f dshow");
    parts.push("-i", qDevice(`audio=${o.audioDevice}`));
  }

  return parts;
}

/** 摄像头录制（dshow）。 */
function buildCam(o: RecordOpts): string[] {
  const parts: string[] = [];
  // 视频输入
  parts.push("-f dshow");
  parts.push("-framerate", String(o.fps));
  if (o.resolution) parts.push("-s", o.resolution);
  parts.push("-i", qDevice(`video=${o.cameraDevice}`));
  // 音频输入（独立 -i，dshow 复合语法在这里不稳，分开更可靠）
  if (o.audioSource !== "none" && o.audioDevice) {
    parts.push("-f dshow");
    parts.push("-i", qDevice(`audio=${o.audioDevice}`));
  }
  return parts;
}

/** 画中画：屏幕 + 摄像头叠加。 */
function buildBoth(o: RecordOpts): string[] {
  const parts: string[] = [];
  // 输入 1：屏幕
  parts.push("-f gdigrab");
  parts.push("-offset_x", String(o.displayX));
  parts.push("-offset_y", String(o.displayY));
  parts.push("-draw_mouse 1");
  // 锁定单屏捕获区域（同 buildScreen）
  if (o.captureW && o.captureH) {
    parts.push("-video_size", `${o.captureW}x${o.captureH}`);
  }
  parts.push("-framerate", String(o.fps));
  parts.push("-i desktop");
  // 输入 2：摄像头
  parts.push("-f dshow");
  parts.push("-framerate", String(o.fps));
  parts.push("-i", qDevice(`video=${o.cameraDevice}`));
  // 输入 3：音频（麦克风或无声）
  if (o.audioSource === "mic" && o.audioDevice) {
    parts.push("-f dshow");
    parts.push("-i", qDevice(`audio=${o.audioDevice}`));
  }

  // filter_complex：主画面（[0:v]）按需 scale 到目标输出分辨率，摄像头缩放到
  // 主画面的 camScalePct 后放到右下角。bgScale 为 null 时主画面不缩放。
  const camScale = Math.max(10, Math.min(80, Math.floor(o.camScalePct)));
  const bgScale = resolutionScale(o.resolution, o.captureW, o.captureH);
  const filters: string[] = [];
  if (bgScale) {
    filters.push(`[0:v]${bgScale}[bg]`);
    filters.push(`[1:v]scale=iw*${camScale}/100:-2[cam]`);
    filters.push(`[bg][cam]overlay=W-w-20:H-h-20[out]`);
  } else {
    filters.push(`[1:v]scale=iw*${camScale}/100:-2[cam]`);
    filters.push(`[0:v][cam]overlay=W-w-20:H-h-20[out]`);
  }
  parts.push("-filter_complex", filters.join(";"));

  // 映射：视频用 out，音频用输入 2（麦克风）。
  // 输入顺序：0=桌面(gdigrab) / 1=摄像头(dshow video) / 2=麦克风(dshow audio)。
  parts.push("-map", "[out]");
  if (o.audioSource === "mic" && o.audioDevice) {
    parts.push("-map", "2:a");
  } else {
    parts.push("-an");
  }
  return parts;
}

function buildEncode(o: RecordOpts): string[] {
  const parts: string[] = [];
  // 输出名用 shell 风格转义（与 lib/ffmpeg.ts 的 outArg 一致）
  parts.push(`-c:v ${o.vEnc}`);
  parts.push(`-b:v ${Math.max(1, o.vBitrateMbps) * 1_000_000}`);
  // preset：录制时 speed 档平衡 CPU 与码率，veryslow 会丢帧
  parts.push("-preset", "fast");
  parts.push("-g", String(o.fps * 2)); // 关键帧间隔 = 2 秒
  // gdigrab 输入是 RGBA（4:4:4）。不指定 -pix_fmt 时，x264 会默认把画面编码成
  // yuv444p（High 4:4:4 Profile）——多数播放器/硬件解码器拒绝播放，报「不受支持的格式」。
  // 强制标准 yuv420p（4:2:0），兼容性最稳。
  if (o.vEnc === "libx264") {
    parts.push("-pix_fmt", "yuv420p");
  }
  // 音频：mic 走 aac，无声则 -an
  if (o.audioSource !== "none" && o.audioDevice) {
    parts.push("-c:a", o.fmt === "mkv" ? "libmp3lame" : "aac");
    parts.push("-b:a", "128k");
  } else {
    parts.push("-an");
  }
  // 容器扩展名
  parts.push(o.outName);
  return parts;
}

/**
 * 拼出完整的 ffmpeg 录制命令行（含占位 token "ffmpeg"）。
 * 调用方拿到后传给 start_record 后端命令；后端会丢弃首 token 改用配置路径。
 */
export function buildRecordCommand(o: RecordOpts): string {
  let input: string[];
  switch (o.mode) {
    case "screen":
      input = buildScreen(o);
      break;
    case "cam":
      input = buildCam(o);
      break;
    case "both":
      input = buildBoth(o);
      break;
  }
  // 画面录制需要 -t 上限吗？不需要——录制靠 stop_record 优雅停止控制时长。
  const tail = buildEncode(o);
  return ["ffmpeg", ...input, ...tail].join(" ");
}

// ===== 设备解析 =====

/** gdigrab 的显示器列表项（后端 list_displays 产出）。 */
export interface DisplayItem {
  x: number;
  y: number;
  width: number;
  height: number;
  normalizedX: number;
  index: number;
}

/** dshow 设备列表项（后端 list_devices 产出）。 */
export interface DeviceItem {
  kind: "video" | "audio";
  name: string;
  identifier: string;
}

/** 从显示器项里取主屏：x=0 且 y=0 的那个；没有则取第一块。 */
export function primaryDisplay(list: DisplayItem[]): DisplayItem | null {
  if (!list.length) return null;
  return list.find((d) => d.x === 0 && d.y === 0) || list[0];
}

/** 把设备列表按类型拆开，方便前端两个下拉框分别填。 */
export function splitDevices(list: DeviceItem[]): { video: DeviceItem[]; audio: DeviceItem[] } {
  const video: DeviceItem[] = [];
  const audio: DeviceItem[] = [];
  for (const d of list) {
    if (d.kind === "video") video.push(d);
    else if (d.kind === "audio") audio.push(d);
  }
  return { video, audio };
}

/** 生成录制输出文件名：record_YYYYMMDD_HHMMSS.mkv（时间戳由调用方传入）。 */
export function recordOutName(ts: string, fmt: RecordOpts["fmt"]): string {
  return `record_${ts}.${fmt}`;
}
