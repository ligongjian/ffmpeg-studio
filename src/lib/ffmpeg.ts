// 各功能模块的 ffmpeg 命令构建器（从原型移植并参数化）
import { baseName } from "./format";
import { store } from "../store";

/**
 * 输出文件已存在时的行为。
 *
 * 必须显式给出：后端把 ffmpeg 的 stdin 设为 null，它没法交互式询问
 * 「Overwrite? [y/N]」，不给标志就会直接以 "Not overwriting - exiting" 失败
 * （错误信息是 `Error opening output file xxx`）。
 *
 * -y 覆盖 / -n 跳过，由「设置 → 默认输出 → 覆盖已存在文件」决定。
 */
function yn(): string {
  return store.overwrite ? "-y" : "-n";
}

/** 拼一条完整命令：`ffmpeg <覆盖策略> <参数…>` */
function ffmpegCmd(body: string): string {
  return `ffmpeg ${yn()} ${body}`;
}

/** 输入文件路径统一加引号：含空格/&/括号时，复制到终端也能直接跑 */
function q(p: string): string {
  return `"${p}"`;
}

/**
 * 输出文件名的命令字符串：含空格/引号时加双引号，否则原样。
 *
 * 后端 `split_args` 只把 `"` 当开关，不识别 `\"`；因此出现 `"` 时用
 * shell 风格的 `'` 拼接（后端与 ffmpeg CLI 都认），普通空格则用双引号即可。
 * 复制到 PowerShell/CMD 也照常运行。
 */
function outArg(name: string): string {
  if (!/[ "'\\]/.test(name)) return name;
  if (name.includes('"')) {
    const esc = name.replace(/'/g, "'\\''").replace(/"/g, "'\\\"'");
    return `'${esc}'`;
  }
  return `"${name}"`;
}

/** 可选输出容器（格式转换页与设置里的「默认容器」共用同一份清单） */
export const FMT_OPTIONS: { value: string; label: string }[] = [
  { value: "mp4", label: "MP4 (H.264)" },
  { value: "mkv", label: "MKV" },
  { value: "webm", label: "WebM (VP9)" },
  { value: "mov", label: "MOV" },
  { value: "avi", label: "AVI" },
  { value: "gif", label: "GIF" },
  { value: "mp3", label: "MP3 (仅音频)" },
];

/** 纯音频容器 → 容器唯一可用的音频编码 */
export const AUDIO_ONLY_FMT: Record<string, string> = {
  mp3: "libmp3lame",
  m4a: "aac",
  aac: "aac",
  wav: "pcm_s16le",
  flac: "flac",
};

/** 只有视频、没有音轨的容器 */
export const VIDEO_ONLY_FMT = ["gif"];

export function isAudioOnly(fmt: string): boolean {
  return fmt in AUDIO_ONLY_FMT;
}

export function isVideoOnly(fmt: string): boolean {
  return VIDEO_ONLY_FMT.includes(fmt);
}

/** `-movflags +faststart` 只对 mp4 / mov 有意义，其它容器加了会报「Option not found」 */
export function supportsFaststart(fmt: string): boolean {
  return fmt === "mp4" || fmt === "mov";
}

export interface ConvertOpts {
  input: string;
  fmt: string;
  enc: string;
  res: string;
  aud: string;
  quality: string;
  faststart: boolean;
  deint: boolean;
  norm: boolean;
}

export function buildConvert(o: ConvertOpts): string {
  const vf: string[] = [];
  if (o.res) vf.push(`scale=${o.res}`);
  if (o.deint) vf.push("yadif");

  const parts: string[] = [`-i ${q(o.input)}`];

  if (isAudioOnly(o.fmt)) {
    // 纯音频容器装不下视频流：必须 -vn，且不能带 -c:v / -crf / -movflags，
    // 否则 ffmpeg 会以「Could not write header … Invalid argument」失败
    // （并在日志里提醒 crf 没有任何流使用）。
    parts.push("-vn", `-c:a ${AUDIO_ONLY_FMT[o.fmt]}`);
  } else if (isVideoOnly(o.fmt)) {
    // gif 没有音轨，也不能用 libx264 系编码
    parts.push("-c:v gif", "-an");
    if (o.res) parts.push(`-vf scale=${o.res}`);
  } else if (o.enc === "copy") {
    parts.push("-c copy");
  } else {
    parts.push(`-c:v ${o.enc} -crf ${o.quality}`);
    if (vf.length) parts.push(`-vf ${vf.join(",")}`);
    parts.push(`-c:a ${o.aud}`);
  }

  if (o.faststart && supportsFaststart(o.fmt)) parts.push("-movflags +faststart");
  if (o.norm && !isVideoOnly(o.fmt)) parts.push("-af loudnorm");

  // 输出文件名沿用源文件的 basename（不同扩展名），覆盖更直观；
  // 源与目标同名（无扩展名）时追加 `.converted` 避免自覆盖。
  const base = baseName(o.input).replace(/\.[^./\\]+$/, "") || "output";
  const outName = base === o.fmt.toLowerCase() ? `${base}.converted.${o.fmt}` : `${base}.${o.fmt}`;
  parts.push(outArg(outName));
  return ffmpegCmd(parts.join(" "));
}

export interface CompressOpts {
  input: string;
  crf: number;
  preset: string;
  res: string;
  bitrate: string;
}

export function buildCompress(o: CompressOpts): string {
  const parts = [`-i ${q(o.input)}`, `-c:v libx265 -crf ${o.crf} -preset ${o.preset}`];
  if (o.res) parts.push(`-vf scale=${o.res}`);
  if (o.bitrate) parts.push(`-b:v ${o.bitrate}`);
  // 输出文件名沿用源 basename，保持 .mp4 后缀；源本身已是 mp4 时加 .compressed 避免自覆盖
  const base = baseName(o.input).replace(/\.[^./\\]+$/, "") || "output";
  const ext = /\.mp4$/i.test(o.input) ? "compressed" : "";
  parts.push("-c:a aac -b:a 128k", outArg(`${base}${ext ? "." + ext : ""}.mp4`));
  return ffmpegCmd(parts.join(" "));
}

export interface CutOpts {
  input: string;
  start: string;
  end: string;
  mode: "re" | "copy";
}

export function buildCut(o: CutOpts): string {
  const parts = [`-ss ${o.start} -to ${o.end} -i ${q(o.input)}`];
  // 输出文件名沿用源 basename 保持 .mp4；源本身是 mp4 时加 .clip 防自覆盖
  const base = baseName(o.input).replace(/\.[^./\\]+$/, "") || "output";
  const outName = /\.mp4$/i.test(o.input) ? `${base}.clip.mp4` : `${base}.mp4`;
  parts.push(
    o.mode === "copy"
      ? `-c copy ${outArg(outName)}`
      : `-c:v libx264 -crf 23 -c:a aac ${outArg(outName)}`
  );
  return ffmpegCmd(parts.join(" "));
}

export interface MergeOpts {
  mode: "concat" | "filter";
  /** 文件绝对路径列表（顺序即合并顺序） */
  files: string[];
  /** 输出容器；filter 模式会影响扩展名，concat 模式仅用于命名 */
  fmt: string;
}

/** concat demuxer 读取的 list.txt 文件名（后端 write_concat_list 写到该名字） */
export const CONCAT_LIST_NAME = "merge_list.txt";

/** 把路径里的反斜杠换成正斜杠，避开 concat demuxer 把 `\` 当转义符的坑 */
function toConcatPath(p: string): string {
  return p.replace(/\\/g, "/");
}

/** 把路径放进 concat list.txt 的 file 指令：先转 /，再转义单引号（shell 风格） */
function toConcatLine(p: string): string {
  return `file '${toConcatPath(p).replace(/'/g, "'\\''")}'`;
}

export function buildMerge(o: MergeOpts): string {
  const list = o.files.length ? o.files : [];
  const fmt = o.fmt || "mp4";
  // 输出文件名沿用首个源文件的 basename，加 `.merged` 后缀避免与任何源同名。
  // 无源文件（占位预览）时退化为 `merged.${fmt}`。
  const base = list.length
    ? baseName(list[0]).replace(/\.[^./\\]+$/, "") || "merged"
    : "merged";
  const out = outArg(`${base}.merged.${fmt}`);
  if (o.mode === "concat") {
    // 走 list.txt；-safe 0 才允许绝对路径
    return ffmpegCmd(`-f concat -safe 0 -i ${CONCAT_LIST_NAME} -c copy ${out}`);
  }
  if (!list.length) {
    // 没文件时给个能跑的占位（两个示例源），便于用户复制命令参考
    const inputs = `-i input1.mp4 -i input2.mp4`;
    return ffmpegCmd(
      `${inputs} -filter_complex "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]" -map "[v]" -map "[a]" -c:v libx264 -crf 23 -c:a aac ${out}`
    );
  }
  const inputs = list.map((f) => `-i ${q(f)}`).join(" ");
  const streams = list.map((_, i) => `[${i}:v][${i}:a]`).join("");
  return ffmpegCmd(
    `${inputs} -filter_complex "${streams}concat=n=${list.length}:v=1:a=1[v][a]" -map "[v]" -map "[a]" -c:v libx264 -crf 23 -c:a aac ${out}`
  );
}

/** 生成 concat list.txt 的完整内容，供页面预览 */
export function buildConcatList(files: string[]): string {
  return files.map(toConcatLine).join("\n");
}

export interface ExtractOpts {
  tab: "audio" | "video" | "frame" | "thumb";
  input: string;
}

export function buildExtract(o: ExtractOpts): string {
  let body = "";
  switch (o.tab) {
    case "audio":
      body = `-i ${q(o.input)} -vn -c:a copy output.m4a`;
      break;
    case "video":
      body = `-i ${q(o.input)} -an -c:v copy output.mp4`;
      break;
    case "frame":
      body = `-i ${q(o.input)} -ss 00:00:05 -frames:v 1 frame.png`;
      break;
    case "thumb":
      body = `-i ${q(o.input)} -vf fps=1/10 thumb_%03d.png`;
      break;
  }
  return ffmpegCmd(body);
}

export interface WatermarkOpts {
  tab: "image" | "text" | "sub";
  input: string;
  pos?: string; // 左上/右上/左下/右下/居中
  opacity?: number; // 0..100
  text?: string;
  fontsize?: number;
  color?: string;
}

const WM_POS: Record<string, string> = {
  左上: "10:10",
  右上: "W-w-10:10",
  左下: "10:H-h-10",
  右下: "W-w-10:H-h-10",
  居中: "(W-w)/2:(H-h)/2",
};

export function buildWatermark(o: WatermarkOpts): string {
  if (o.tab === "image") {
    const p = WM_POS[o.pos || "右下"] || WM_POS["右下"];
    const a = ((o.opacity ?? 100) / 100).toFixed(2);
    return ffmpegCmd(
      `-i ${q(o.input)} -i logo.png -filter_complex "[1]colorchannelmixer=aa=${a}[w];[0][w]overlay=${p}" out.mp4`
    );
  }
  if (o.tab === "text") {
    const t = (o.text || "Demo").replace(/'/g, "'\\''");
    const fs = o.fontsize || 28;
    const color = o.color || "white";
    return ffmpegCmd(
      `-i ${q(o.input)} -vf "drawtext=text='${t}':x=20:y=20:fontsize=${fs}:fontcolor=${color}" out.mp4`
    );
  }
  return ffmpegCmd(`-i ${q(o.input)} -vf "subtitles=sub.srt" out.mp4`);
}

export interface FiltersOpts {
  active: Record<string, boolean>;
  custom: string;
}

const FILTER_LIB: [string, string, string][] = [
  ["scale", "缩放", "scale=1280:720"],
  ["crop", "裁剪", "crop=1000:600:140:60"],
  ["rotate", "旋转90°", "transpose=1"],
  ["eq", "调色", "eq=brightness=0.05:contrast=1.1"],
  ["denoise", "降噪", "hqdn3d"],
  ["sharpen", "锐化", "unsharp=5:5:1.2"],
  ["fade", "淡入淡出", "fade=t=in:st=0:d=1"],
  ["deint", "去隔行", "yadif"],
  ["volume", "音量", "volume=1.3"],
  ["loudnorm", "响度归一", "loudnorm=I=-16"],
];

export function buildFilters(o: FiltersOpts, input = "input.mp4"): string {
  const chain = FILTER_LIB.filter(([k]) => o.active[k]).map(([, , f]) => f);
  const cf = o.custom.trim();
  if (cf) chain.push(cf);
  // 没选滤镜时就是原样转封装。（原来这里拼了个 `# 未选择滤镜` 注释，
  // 后端按整个字符串拆参数执行时会被当成真实参数传给 ffmpeg。）
  if (!chain.length) return ffmpegCmd(`-i ${q(input)} -c copy output.mp4`);
  return ffmpegCmd(`-i ${q(input)} -vf "${chain.join(",")}" output.mp4`);
}

export function filterList() {
  return FILTER_LIB;
}

export interface RecordOpts {
  src: "screen" | "cam" | "both";
  fps: string;
  fmt: string;
  aud: string;
}

export function buildRecord(o: RecordOpts): string {
  const a = o.aud;
  if (o.src === "screen")
    return ffmpegCmd(
      `-f gdigrab -framerate ${o.fps} -i desktop -f dshow -i audio="${a}" out.${o.fmt}`
    );
  if (o.src === "cam")
    return ffmpegCmd(`-f dshow -i video="Integrated Camera":audio="${a}" out.${o.fmt}`);
  return ffmpegCmd(
    `-f dshow -i video="Integrated Camera" -f gdigrab -i desktop -filter_complex overlay out.${o.fmt}`
  );
}

export interface StreamOpts {
  mode: "push" | "pull";
  proto: string;
  url: string;
  vbr: string;
  abr: string;
  input: string;
}

export function buildStream(o: StreamOpts): string {
  if (o.mode === "push")
    return ffmpegCmd(
      `-re -i ${q(o.input)} -c:v libx264 -b:v ${o.vbr} -c:a aac -b:a ${o.abr} -f flv ${o.url}`
    );
  const ext = o.proto === "HLS" ? "m3u8" : "mp4";
  return ffmpegCmd(`-i "${o.url}" -c copy record.${ext}`);
}

export interface BatchItem {
  file: string;
}

export interface BatchOpts {
  files: string[];
  op: "convert" | "compress" | "extract" | "thumb";
  fmt: string;
}

export function buildBatch(o: BatchOpts): string[] {
  return o.files.map((f) => {
    const b = baseName(f);
    if (o.op === "convert")
      return ffmpegCmd(`-i ${q(f)} -c:v libx264 -c:a aac "out/${b}.${o.fmt}"`);
    if (o.op === "compress")
      return ffmpegCmd(`-i ${q(f)} -c:v libx265 -crf 28 "out/${b}.${o.fmt}"`);
    if (o.op === "extract") return ffmpegCmd(`-i ${q(f)} -vn -c:a copy "out/${b}.m4a"`);
    return ffmpegCmd(`-i ${q(f)} -vf fps=1/10 "out/${b}.png"`);
  });
}
