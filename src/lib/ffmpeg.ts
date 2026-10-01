// 各功能模块的 ffmpeg 命令构建器（从原型移植并参数化）
import { baseName, dirOf } from "./format";
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
  opus: "libopus",
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
  /** 硬件加速编码器（如 h264_nvenc / hevc_amf）；空 = 使用 enc 指定的软件编码 */
  hwaccel: string;
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
  } else if (o.enc === "copy" && !o.hwaccel) {
    parts.push("-c copy");
  } else {
    if (o.hwaccel) {
      // NVENC / AMF 用 -cq，QSV 用 -global_quality
      const q = o.hwaccel.includes("qsv") ? `-global_quality ${o.quality}` : `-cq ${o.quality}`;
      parts.push(`-c:v ${o.hwaccel} ${q}`);
    } else {
      parts.push(`-c:v ${o.enc} -crf ${o.quality}`);
    }
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
  /** 硬件加速编码器（如 h264_nvenc / hevc_qsv）；空 = 软件编码 libx265 */
  hwaccel: string;
}

/** 视频编码器选择：硬件加速优先，否则回退软件编码；质量参数按编码器类型适配 */
function videoEnc(o: { hwaccel: string; crf: number; preset: string }, swEnc: string): string {
  if (!o.hwaccel) return `-c:v ${swEnc} -crf ${o.crf} -preset ${o.preset}`;
  // NVENC / AMF 用 -cq 控制质量（类 CRF），QSV 用 -global_quality；预设交编码器默认即可
  const q = o.hwaccel.includes("qsv") ? `-global_quality ${o.crf}` : `-cq ${o.crf}`;
  return `-c:v ${o.hwaccel} ${q}`;
}

export function buildCompress(o: CompressOpts): string {
  const parts = [`-i ${q(o.input)}`, videoEnc(o, "libx265")];
  if (o.res) parts.push(`-vf scale=${o.res}`);
  if (o.bitrate) parts.push(`-b:v ${o.bitrate}`);
  // 输出文件名沿用源 basename，保持 .mp4 后缀；源本身已是 mp4 时加 .compressed 避免自覆盖
  const base = baseName(o.input).replace(/\.[^./\\]+$/, "") || "output";
  const ext = /\.mp4$/i.test(o.input) ? "compressed" : "";
  parts.push("-c:a aac -b:a 128k", outArg(`${base}${ext ? "." + ext : ""}.mp4`));
  return ffmpegCmd(parts.join(" "));
}

export interface CutSplit {
  type: "equal" | "segment";
  /** 每段秒数；equal 模式由前端按总长/段数折算后传入 */
  segDur: number;
  /** equal 模式的段数（仅展示用） */
  count?: number;
}

export interface CutOpts {
  input: string;
  start: string;
  end: string;
  mode: "re" | "copy";
  /** 拆分模式：传入则按段拆分，忽略 start/end 单段裁剪 */
  split?: CutSplit;
}

export function buildCut(o: CutOpts): string {
  const base = baseName(o.input).replace(/\.[^./\\]+$/, "") || "output";
  // 拆分模式：用 segment muxer 一次性切成多段
  if (o.split && o.split.segDur > 0) {
    const enc = o.mode === "copy" ? "-c copy" : "-c:v libx264 -crf 23 -c:a aac";
    const out = outArg(`${base}.part.%03d.mp4`);
    return ffmpegCmd(
      `-i ${q(o.input)} -f segment -segment_time ${o.split.segDur} -reset_timestamps 1 ${enc} ${out}`
    );
  }
  // 单段裁剪
  const parts = [`-ss ${o.start} -to ${o.end} -i ${q(o.input)}`];
  // 输出文件名沿用源 basename 保持 .mp4；源本身是 mp4 时加 .clip 防自覆盖
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
  /** 音频：copy / aac / mp3 / flac / opus */
  audioCodec: string;
  /** 音频输出码率（如 "192k"），空则交给编码器默认 */
  audioBitrate: string;
  /** 视频：copy / libx264 */
  videoCodec: string;
  /** 视频 CRF，仅 videoCodec !== "copy" 时生效 */
  videoCrf: string;
  /** 视频容器：mp4 / mkv / mov / avi / webm */
  videoFmt: string;
  /** 单帧时间点，如 "00:00:10" 或 "10" 或 "0.5" */
  frameAt: string;
  /** 单帧格式：png / jpg */
  frameFmt: string;
  /** 缩略图间隔秒；0 = 关闭（单张封面） */
  thumbInterval: number;
  /** 缩略图宽度，如 320；高度自动按比例 */
  thumbWidth: number;
  /** 缩略图命名模板，如 thumb_%03d.png */
  thumbName: string;
}

export function buildExtract(o: ExtractOpts): string {
  const base = baseName(o.input).replace(/\.[^./\\]+$/, "") || "output";
  const out = `${base}.extracted`;
  let body = "";
  switch (o.tab) {
    case "audio": {
      // 无损拷贝 → 容器跟随原编码（aac→m4a, mp3→mp3, flac→flac, opus→opus, 其它→wav）
      // 重编码 → 容器按所选编码
      const extMap: Record<string, string> = {
        aac: "m4a",
        mp3: "mp3",
        flac: "flac",
        opus: "opus",
        copy: "wav",
      };
      const ext = extMap[o.audioCodec] ?? "m4a";
      const outName = `${out}.${ext}`;
      const parts = [`-i ${q(o.input)}`, "-vn"];
      if (o.audioCodec === "copy") {
        parts.push("-c:a copy");
      } else {
        parts.push(`-c:a ${o.audioCodec}`);
        if (o.audioBitrate) parts.push(`-b:a ${o.audioBitrate}`);
      }
      parts.push(outArg(outName));
      body = parts.join(" ");
      break;
    }
    case "video": {
      const parts = [`-i ${q(o.input)}`, "-an"];
      if (o.videoCodec === "copy") {
        parts.push("-c:v copy");
      } else {
        parts.push(`-c:v libx264 -crf ${o.videoCrf || 23}`);
      }
      parts.push(outArg(`${out}.${o.videoFmt || "mp4"}`));
      body = parts.join(" ");
      break;
    }
    case "frame": {
      const parts = [`-i ${q(o.input)}`, `-ss ${o.frameAt || "0"}`, "-frames:v 1"];
      // jpg 需要指定质量；png 是默认无损
      if (o.frameFmt === "jpg") {
        parts.push("-q:v 2");
      }
      parts.push(outArg(`${out}.${o.frameFmt === "jpg" ? "jpg" : "png"}`));
      body = parts.join(" ");
      break;
    }
    case "thumb": {
      const parts = [`-i ${q(o.input)}`];
      const vf: string[] = [];
      if (o.thumbInterval > 0) vf.push(`fps=1/${o.thumbInterval}`);
      if (o.thumbWidth > 0) vf.push(`scale=${o.thumbWidth}:-1`);
      if (vf.length) parts.push(`-vf ${vf.join(",")}`);
      // 单张封面时不带 %03d，否则 ffmpeg 会输出 thumb_000.png 这种带序号的文件
      const tpl = o.thumbInterval === 0 ? o.thumbName.replace(/%0\d+d/, "000") : o.thumbName;
      parts.push(outArg(`${base}_${tpl}`));
      body = parts.join(" ");
      break;
    }
  }
  return ffmpegCmd(body);
}

export interface WatermarkOpts {
  tab: "image" | "text" | "sub";
  input: string;
  /** 水印图片路径（tab=image 时用） */
  image?: string;
  pos?: string; // 左上/右上/左下/右下/居中
  opacity?: number; // 0..100
  /** 水印缩放：相对源视频宽度的百分比，如 20 = 占宽度的 20% */
  scale?: number;
  text?: string;
  fontsize?: number;
  color?: string;
  /** 文字水印阴影/描边 */
  shadow?: boolean;
  /** 文字水印字体文件路径；空则用系统默认（Windows: 微软雅黑） */
  fontfile?: string;
  /** 字幕文件路径 */
  sub?: string;
  /** 字幕字体大小（按源视频高度百分比，0 = 默认） */
  subFontsize?: number;
  /** 字幕输出容器 */
  fmt?: string;
}

/**
 * Windows 默认中文字体（微软雅黑）。
 *
 * 本机这个 ffmpeg 构建（msvc，带 `--enable-fontconfig`）加载不到 fontconfig 配置文件，
 * 字体回退是失效的（日志里 `Fontconfig error: Cannot load default config file`
 * → `Cannot find a valid font for the family Sans`），所以 fontfile 必须给对，
 * 给错不会有任何兜底。
 */
const WIN_FONT = "C:\\Windows\\Fonts\\msyh.ttc";

const WM_POS: Record<string, string> = {
  左上: "10:10",
  右上: "W-w-10:10",
  左下: "10:H-h-10",
  右下: "W-w-10:H-h-10",
  居中: "(W-w)/2:(H-h)/2",
};

/**
 * 把本地路径放进 ffmpeg **滤镜参数**时要过的转义。
 *
 * 实测（ffmpeg 7.1 / msvc）：一个选项值要连着过两层解转义——
 *   ① filtergraph 分词：终止符是 `[ ] , ;`，`\X` → `X`，并且**会剥掉成对单引号**
 *      （引号内的字符原样保留，不再解转义）；
 *   ② 滤镜选项解析：键值/选项分隔符都是 `:`，同样 `\X` → `X`。
 * 所以想让它最终看到字面 `:`（Windows 盘符），命令里必须写两个反斜杠；而反斜杠
 * 自己会被吃两层，路径分隔符就一律换成 `/`。
 *
 * 这里用「单引号包裹 + 单层 `\:`」：引号挡掉第①层，第②层再把 `\` 消掉，
 * freetype / libass 拿到的就是干净的 `C:/Windows/Fonts/msyh.ttc`。
 * 该写法在 CMD、PowerShell、Git Bash 里直接粘贴也能跑；路径里真的含 `'` 时
 * 退回无引号的双反斜杠写法（`\\:`），代价是 Git Bash 下粘贴会多掉一层。
 */
function filterPath(p: string): string {
  const fwd = p.replace(/\\/g, "/");
  if (!fwd.includes("'")) return `'${fwd.replace(/:/g, "\\:")}'`;
  return fwd.replace(/:/g, "\\\\:");
}

/**
 * drawtext 的 text 值：外面包单引号挡掉第①层，内部再按第②层转义。
 *
 * `'` 不能写成 `\'`——单引号会被提前闭合，把整个滤镜链拆散（实测报
 * `No option name near ...`）；改成中西文都能用的右单引号 `’`。
 * `%` 不用动，配合下面的 `expansion=none` 它就是个普通字符。
 */
function filterText(s: string): string {
  const esc = s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\u2019");
  return `'${esc}'`;
}

export function buildWatermark(o: WatermarkOpts): string {
  const base = baseName(o.input).replace(/\.[^./\\]+$/, "") || "output";
  const fmt = o.fmt || "mp4";
  const out = outArg(`${base}.watermarked.${fmt}`);

  if (o.tab === "image") {
    if (!o.image) {
      // 没选图片时给个能跑的占位（避免用户复制命令时报错）
      return ffmpegCmd(`（请先选择水印图片）`);
    }
    const p = WM_POS[o.pos || "右下"] || WM_POS["右下"];
    const a = ((o.opacity ?? 100) / 100).toFixed(2);
    const scalePct = o.scale && o.scale > 0 ? o.scale : 20;
    // 水印按源宽度比例缩放；aa 是 alpha 系数
    const filter = `[1:v]scale=iw*${scalePct}/100:ih*${scalePct}/100,colorchannelmixer=aa=${a}[w];[0:v][w]overlay=${p}:shortest=1[v]`;
    return ffmpegCmd(
      `-i ${q(o.input)} -i ${q(o.image)} -filter_complex "${filter}" -map "[v]" -map 0:a? -c:a copy ${out}`
    );
  }
  if (o.tab === "text") {
    const fs = o.fontsize || 28;
    const color = o.color || "white";
    const p = WM_POS[o.pos || "左上"] || WM_POS["左上"];
    const [x, y] = p.split(":");

    const parts: string[] = [
      `text=${filterText(o.text || "Demo")}`,
      // 关掉 drawtext 的 `%{...}` 展开：界面上填的就是字面文字，不关的话
      // "50% off" 这类内容会被当成展开式，直接渲染成一片空白（实测）。
      "expansion=none",
      `x=${x}`,
      `y=${y}`,
      `fontsize=${fs}`,
      `fontcolor=${color}`,
      // 用户没选字体时用系统默认（WIN_FONT 是原始 Windows 路径，交给 filterPath 转义）
      `fontfile=${filterPath(o.fontfile || WIN_FONT)}`,
    ];
    if (o.shadow) {
      parts.push("shadowx=2", "shadowy=2", "borderw=0");
    }
    const filter = `drawtext=${parts.join(":")}`;
    return ffmpegCmd(
      `-i ${q(o.input)} -vf "${filter}" -map 0:v -map 0:a? -c:a copy ${out}`
    );
  }
  // 硬字幕：直接烧进画面；需要 libass 编译（ffmpeg 官方二进制都有）
  if (!o.sub) {
    return ffmpegCmd(`（请先选择字幕文件）`);
  }
  // 注意：subtitles 的路径同样要走 filterPath（正斜杠 + 转义盘符冒号）。
  // 旧写法 `C\:/...` 会被第①层解转义成 `C:/...`，冒号随即被当选项分隔符，
  // 报 `Unable to parse option value "..." as image size`。
  const sizeFilter = o.subFontsize && o.subFontsize > 0 ? `:force_style=Fontsize=${o.subFontsize}` : "";
  return ffmpegCmd(
    `-i ${q(o.input)} -vf "subtitles=${filterPath(o.sub)}${sizeFilter}" -map 0:v -map 0:a? -c:a copy ${out}`
  );
}

/**
 * 滤镜调色页的状态：每个滤镜一个开关 + 一组可调参数。
 * 参数全部用 number/string 显式持有，UI 调多少就提交多少，不再硬编码默认值。
 */
export interface FiltersOpts {
  input: string;
  fmt: string;
  /** 视频编码器；有视频滤镜时必然重编码 */
  vEnc: string;
  /** 视频 CRF */
  crf: number;
  /** 音频动作：copy = 原样拷贝；loudnorm = 响度归一；mute = 去声 */
  audioMode: "copy" | "loudnorm" | "mute";
  /** 归一化目标响度（LUFS），audioMode=loudnorm 时用 */
  loudnormI: number;

  scaleOn: boolean;
  scaleW: number;
  scaleH: number;
  cropOn: boolean;
  cropW: number;
  cropH: number;
  cropX: number;
  cropY: number;
  rotateOn: boolean;
  rotateDir: number; // 0/1/2/3 = transpose，1=顺时针90°，2=180°，3=逆时针90°
  eqOn: boolean;
  eqBrightness: number;
  eqContrast: number;
  eqSaturation: number;
  eqGamma: number;
  denoiseOn: boolean;
  sharpenOn: boolean;
  sharpenLuma: number;
  sharpenThresh: number;
  fadeOn: boolean;
  fadeIn: boolean;
  fadeOut: boolean;
  fadeDur: number;
  fadeOutStart: number;
  deintOn: boolean;
  volumeOn: boolean;
  volumeGain: number;

  /** 自定义视频滤镜链（高级），逗号分隔，追加到 -vf 末尾 */
  customVf: string;
  /** 自定义音频滤镜链（高级），追加到 -af 末尾 */
  customAf: string;
}

/**
 * 拼接单个 eq（调色）滤镜。brightness 范围 -1..1（0 为正常），
 * contrast/saturation/gamma 以 1 为正常值。
 */
function buildEq(o: FiltersOpts): string {
  return `eq=brightness=${o.eqBrightness}:contrast=${o.eqContrast}:saturation=${o.eqSaturation}:gamma=${o.eqGamma}`;
}

/** 缩放滤镜；H=0 表示按原比例自动算高度 */
function buildScale(o: FiltersOpts): string {
  const h = o.scaleH <= 0 ? "-2" : String(o.scaleH);
  return `scale=${o.scaleW}:${h}`;
}

/** 旋转：transpose 的 dir 1=顺时针90°、2=180°、3=逆时针90° */
function buildRotate(o: FiltersOpts): string {
  return `transpose=${o.rotateDir}`;
}

/** 裁剪 */
function buildCrop(o: FiltersOpts): string {
  return `crop=${o.cropW}:${o.cropH}:${o.cropX}:${o.cropY}`;
}

/**
 * 锐化：unsharp=luma_msize_x:luma_msize_y:luma_amount[:luma_threshold]
 * 这里 ms 用 5x5，amount 是锐化强度，threshold 高于此差异才锐化（默认 0=全部）。
 */
function buildSharpen(o: FiltersOpts): string {
  const t = o.sharpenThresh > 0 ? `:0:${o.sharpenThresh}` : "";
  return `unsharp=5:5:${o.sharpenLuma}${t}`;
}

/** 淡入淡出。st（开始时间）以秒计；淡出的 st 由用户给定，通常=视频时长-淡出时长 */
function buildFade(o: FiltersOpts, duration: number): string[] {
  const chain: string[] = [];
  if (o.fadeIn) chain.push(`fade=t=in:st=0:d=${o.fadeDur}`);
  if (o.fadeOut) {
    const st = duration > 0 ? Math.max(0, duration - o.fadeDur).toFixed(3) : "0";
    chain.push(`fade=t=out:st=${st}:d=${o.fadeDur}`);
  }
  return chain;
}

/**
 * 视频降噪 hqdn3d（luma_spatial:chroma_spatial:luma_tmp:chroma_tmp，默认值即合理）。
 *
 * 函数名带 Video 是为了和音频页的 `buildAudioDenoise()` 区分：两者曾经都叫
 * `buildDenoise`，在同一模块里后者会把前者覆盖掉，滤镜页的降噪开关直接失效。
 */
function buildVideoDenoise(): string {
  return "hqdn3d";
}

export function buildFilters(o: FiltersOpts): string {
  const vf: string[] = [];
  if (o.scaleOn) vf.push(buildScale(o));
  if (o.cropOn) vf.push(buildCrop(o));
  if (o.rotateOn) vf.push(buildRotate(o));
  if (o.eqOn) vf.push(buildEq(o));
  if (o.denoiseOn) vf.push(buildVideoDenoise());
  if (o.sharpenOn) vf.push(buildSharpen(o));
  if (o.fadeOn) vf.push(...buildFade(o, o.fadeOutStart));
  if (o.deintOn) vf.push("yadif");
  const cfV = o.customVf.trim();
  if (cfV) vf.push(cfV);

  // 音频滤镜链
  const af: string[] = [];
  if (o.volumeOn) af.push(`volume=${o.volumeGain}`);
  if (o.audioMode === "loudnorm") af.push(`loudnorm=I=${o.loudnormI}`);
  const cfA = o.customAf.trim();
  if (cfA) af.push(cfA);

  // 输出文件名沿用源 basename，保持所选容器扩展名；
  // 源容器与目标同名时追加 `.filtered` 避免自覆盖。
  const base = baseName(o.input).replace(/\.[^./\\]+$/, "") || "output";
  const srcExt = (o.input.match(/\.[^./\\]+$/) || [""])[0].toLowerCase().replace(".", "");
  const outName = srcExt === o.fmt ? `${base}.filtered.${o.fmt}` : `${base}.${o.fmt}`;

  const parts: string[] = [`-i ${q(o.input)}`];
  // 有视频滤镜才重编码；否则 copy 更省事且不丢质量
  if (vf.length) {
    parts.push(`-vf "${vf.join(",")}"`);
    parts.push(`-c:v ${o.vEnc} -crf ${o.crf}`);
  } else {
    parts.push("-c:v copy");
  }
  if (o.audioMode === "mute") {
    parts.push("-an");
  } else if (af.length) {
    parts.push(`-af "${af.join(",")}"`);
    parts.push("-c:a aac");
  } else {
    parts.push("-c:a copy");
  }
  parts.push(outArg(outName));
  return ffmpegCmd(parts.join(" "));
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

export type StreamMode = "push" | "pull";
export type StreamProto = "RTMP" | "HLS" | "RTSP" | "HTTP-FLV";

export interface StreamOpts {
  mode: StreamMode;
  /** 推流时决定输出封装；拉流时决定读取方式与输出 */
  proto: StreamProto;
  url: string;
  /** 视频码率，如 "4000k" */
  vbr: string;
  /** 音频码率，如 "128k" */
  abr: string;
  /** x264 编码速度（直播用很快的档位降低延迟） */
  preset: string;
  /** 输出分辨率，如 "1280:720"；空=跟随源（不缩放） */
  scale: string;
  /** 输出帧率，如 "30"；空=跟随源 */
  fps: string;
  /** 关键帧间隔（秒），用于 HLS/RTMP 平滑切片与快速起播；0=不强制 */
  gopSec: number;
  /** 是否包含音频流；false → -an */
  audio: boolean;
  /** 拉流录制是否转码（false=直接拷贝 -c copy，true=重编码为 H.264/AAC） */
  transcode: boolean;
  /** 推流源文件路径（pull 模式用不到） */
  input: string;
  /**
   * 拉流输出文件名，含扩展名（如 `pull_20260930_210000.ts`），仅 pull 使用。
   *
   * 容器由扩展名决定（ts→mpegts / mkv→matroska / mp4→mp4），所以不需要单独的容器字段。
   * 由调用方生成：默认带时间戳，避免每次拉流都写同一个文件（`-y` 会静默覆盖上一份，
   * 关掉覆盖则第二次直接失败）。
   */
  outName: string;
}

/** 推流输出封装：RTMP/HTTP-FLV 都是 flv 封装；HLS→hls；RTSP→rtsp */
function pushFormat(proto: StreamProto): string {
  if (proto === "HLS") return "hls";
  if (proto === "RTSP") return "rtsp";
  return "flv";
}

/** 把码率字符串翻倍作为 bufsize（平稳码率用），解析失败返回空 */
function bufsizeFor(br: string): string {
  const m = br.trim().match(/^(\d+(?:\.\d+)?)\s*([kKmMgG]?)$/);
  if (!m) return "";
  const n = (parseFloat(m[1]) * 2).toString();
  return `${n}${m[2].toLowerCase()}`;
}

export function buildStream(o: StreamOpts): string {
  return o.mode === "push" ? buildPush(o) : buildPull(o);
}

/** 推流：把本地文件实时推送到 RTMP/HLS/RTSP/HTTP-FLV 服务器 */
function buildPush(o: StreamOpts): string {
  const parts: string[] = [`-re -i ${q(o.input)}`];
  const vf: string[] = [];
  if (o.scale) vf.push(`scale=${o.scale}`);

  // 视频：H.264 + yuv420p（RTMP/HLS 服务器与播放器普遍只认 4:2:0；
  // 不给 -pix_fmt 时 x264 会按源选 yuv444p，多数服务器直接拒收/播放器打不开）
  parts.push(`-c:v libx264 -preset ${o.preset} -b:v ${o.vbr} -pix_fmt yuv420p`);
  if (o.fps) parts.push(`-r ${o.fps}`);
  if (vf.length) parts.push(`-vf "${vf.join(",")}"`);

  // 关键帧间隔：让 HLS 切片均匀、播放器快速起播（无关键帧时按场景切换，切片会忽大忽小）
  if (o.gopSec > 0) {
    const fps = o.fps ? Number(o.fps) : 30;
    if (Number.isFinite(fps) && fps > 0) {
      parts.push(`-g ${Math.max(1, Math.round(fps * o.gopSec))}`);
    }
  }

  // 平稳码率：bufsize ≈ 2× 码率，避免直播卡顿；解析失败则不附加
  const buf = bufsizeFor(o.vbr);
  if (buf) parts.push(`-maxrate ${o.vbr} -bufsize ${buf}`);

  // 音频：源无音轨时 -c:a aac 会报错，提供开关用 -an 跳过
  if (o.audio) {
    parts.push(`-c:a aac -b:a ${o.abr}`);
  } else {
    parts.push(`-an`);
  }

  // 封装相关选项必须在输出 URL 之前
  if (o.proto === "HLS") {
    // HLS 输出：固定切片时长、保留全部切片
    parts.push(`-hls_time 4 -hls_list_size 0`);
  } else if (o.proto === "RTSP") {
    parts.push(`-rtsp_transport tcp`);
  }
  // 输出地址加引号：RTSP/HLS 地址可能带查询参数，HLS 也常见写到含空格的本地路径
  parts.push(`-f ${pushFormat(o.proto)} ${q(o.url)}`);
  return ffmpegCmd(parts.join(" "));
}

/** 拉流录制：从 RTMP/HLS/RTSP/HTTP-FLV 拉流保存为本地文件 */
function buildPull(o: StreamOpts): string {
  const parts: string[] = [];
  // RTSP 默认走 UDP，过 NAT/防火墙常连不上；强制 TCP 更稳
  if (o.proto === "RTSP") parts.push(`-rtsp_transport tcp`);
  parts.push(`-i ${q(o.url)}`);
  if (o.transcode) {
    parts.push(
      `-c:v libx264 -preset ${o.preset} -b:v ${o.vbr} -pix_fmt yuv420p -c:a aac -b:a ${o.abr}`
    );
  } else {
    // 直接拷贝：最省资源，输出容器需兼容源编码（RTMP/RTSP/HLS 多为 H.264/AAC）
    parts.push(`-c copy`);
  }
  // 输出名由调用方给出（含扩展名，容器随扩展名走），默认带时间戳。
  //
  // 默认容器是 TS：拉流是无限长的直播流，通常只能靠用户「取消」结束，而队列的取消是
  // 硬杀进程（cancel_ffmpeg → child.kill()）。实测被强杀后：
  //   mp4 → 48 字节 + moov atom not found，完全不可播放；
  //   mkv → 0 字节 + EBML header parsing failed，不可播放；
  //   ts  → 保留已录片段（262144 字节 ≈ 4.79 秒）且可正常播放（188 字节独立包，抗截断）。
  // 用户若改选 mp4/mkv，界面会明确标注"取消后文件会损坏"。
  parts.push(outArg(o.outName || "record.ts"));
  return ffmpegCmd(parts.join(" "));
}

export type BatchOp = "convert" | "compress" | "extract" | "thumb";

export interface BatchItem {
  /** 输入文件路径 */
  file: string;
  /** 计算出的输出文件路径（绝对或相对，取决于 outDir） */
  out: string;
  /** 完整 ffmpeg 命令（含 `ffmpeg` 前缀，可直接入队） */
  cmd: string;
}

export interface BatchOpts {
  files: string[];
  op: BatchOp;
  // ===== convert 专用 =====
  /** 目标容器：mp4 / mkv / webm / mov / avi */
  fmt: string;
  /** 视频编码：libx264 / libx265 / copy */
  vcodec: string;
  /** 音频编码：aac / mp3 / copy */
  acodec: string;
  // ===== compress 专用 =====
  /** x265 CRF（18 高画质 … 35 高压缩） */
  crf: number;
  /** x265 编码预设 */
  preset: string;
  // ===== extract 专用 =====
  /** 音频扩展名：m4a / mp3 / wav / flac / opus */
  aext: string;
  /** copy=无损拷贝，-c:a copy；reencode=按 aext 重编码 */
  aCodec: string;
  // ===== thumb 专用 =====
  /** 截帧时间点，如 "00:00:01" / "10" / "0.5" */
  ts: string;
  /** 缩略图格式：png / jpg */
  thumbFmt: string;
  /** 缩略图宽度（像素），0 = 保持原始宽度 */
  thumbW: number;
  // ===== 输出 =====
  /** 输出目录（绝对路径）；留空则落在每个源文件同目录 */
  outDir: string;
}

/** 音频扩展名 → 重编码时使用的编码器 */
const BATCH_ACODEC: Record<string, string> = {
  m4a: "aac",
  mp3: "libmp3lame",
  wav: "pcm_s16le",
  flac: "flac",
  opus: "libvorbis",
};

/**
 * 计算单个输出路径。
 * - outDir 给定 → 落到该目录（应由文件对话框返回已存在的目录，避免 ffmpeg 因目录不存在而失败）；
 * - 否则 → 落在源文件同目录（dirOf）。
 * 输出恰好等于源文件本身时追加 `.batch` 避免自覆盖（例如 mp4→mp4 同目录）。
 */
function batchOut(file: string, ext: string, outDir: string): string {
  const base = baseName(file).replace(/\.[^./\\]+$/, "") || "output";
  const dir = outDir.trim() ? outDir.trim().replace(/[\\/]$/, "") : dirOf(file);
  const out = `${dir}/${base}.${ext}`;
  return out.toLowerCase() === file.toLowerCase() ? `${dir}/${base}.batch.${ext}` : out;
}

export function buildBatch(o: BatchOpts): BatchItem[] {
  return o.files.map((f) => {
    let ext = "";
    let body = "";
    switch (o.op) {
      case "convert": {
        ext = o.fmt;
        // 视频/音频都选「拷贝」时走 -c copy；否则按用户选择分别编码
        if (o.vcodec === "copy" && o.acodec === "copy") {
          body = `-i ${q(f)} -c copy`;
        } else {
          const vc = o.vcodec === "copy" ? "copy" : o.vcodec;
          const ac = o.acodec === "copy" ? "copy" : o.acodec;
          body = `-i ${q(f)} -c:v ${vc} -c:a ${ac}`;
        }
        break;
      }
      case "compress": {
        ext = o.fmt;
        body = `-i ${q(f)} -c:v libx265 -crf ${o.crf} -preset ${o.preset} -c:a aac -b:a 128k`;
        break;
      }
      case "extract": {
        ext = o.aext;
        const codec = o.aCodec === "copy" ? "copy" : BATCH_ACODEC[o.aext] || "aac";
        body = `-i ${q(f)} -vn -c:a ${codec}`;
        break;
      }
      case "thumb": {
        ext = o.thumbFmt;
        const vf = o.thumbW > 0 ? `-vf scale=${o.thumbW}:-1 ` : "";
        const qv = o.thumbFmt === "jpg" ? "-q:v 2 " : "";
        // -ss 放在 -i 之前做快速定位；-vframes 1 只取单帧（封面图），不会一秒一张
        body = `-ss ${o.ts || "00:00:01"} -i ${q(f)} ${vf}${qv}-vframes 1`;
        break;
      }
    }
    const out = batchOut(f, ext, o.outDir);
    return { file: f, out, cmd: ffmpegCmd(`${body} ${outArg(out)}`) };
  });
}

/** 硬件加速编码器清单（压缩/转换页共用）。空串表示走软件编码。 */
export const HWACCEL_ENCODERS: { value: string; label: string }[] = [
  { value: "", label: "软件编码（CPU）" },
  { value: "h264_nvenc", label: "NVIDIA H.264 (NVENC)" },
  { value: "hevc_nvenc", label: "NVIDIA H.265 (NVENC)" },
  { value: "h264_qsv", label: "Intel H.264 (QSV)" },
  { value: "hevc_qsv", label: "Intel H.265 (QSV)" },
  { value: "h264_amf", label: "AMD H.264 (AMF)" },
  { value: "hevc_amf", label: "AMD H.265 (AMF)" },
];

export interface GifOpts {
  input: string;
  /** 起始时间 -ss，如 "00:00:01" / "5" */
  start: string;
  /** 时长 -t（秒），空=到结尾 */
  duration: string;
  /** 帧率，默认 15 */
  fps: number;
  /** 输出宽度（像素），0 = 保持原始宽度 */
  width: number;
  /** 循环：0=无限循环，-1=不循环，N=循环 N 次（GIF muxer 的 -loop 语义） */
  loop: number;
}

/** GIF 动图：palettegen + paletteuse 两步法（比直接 -c:v gif 色彩干净得多） */
export function buildGif(o: GifOpts): string {
  const parts: string[] = [];
  if (o.start) parts.push(`-ss ${o.start}`);
  if (o.duration) parts.push(`-t ${o.duration}`);
  parts.push(`-i ${q(o.input)}`);
  const vf: string[] = [`fps=${o.fps > 0 ? o.fps : 15}`];
  if (o.width > 0) vf.push(`scale=${o.width}:-1:flags=lanczos`);
  // split → palettegen 生成调色板 → paletteuse 套用
  vf.push("split[s0][s1]", "[s0]palettegen[p]", "[s1][p]paletteuse");
  parts.push(`-vf "${vf.join(",")}"`, "-an"); // GIF 无音轨
  // -loop 必须无条件写出：gif muxer 的默认值是 0（无限循环），
  // 若「不循环 (-1)」时不写该参数，反而会拿到无限循环，与用户意图完全相反。
  parts.push(`-loop ${o.loop}`);
  const base = baseName(o.input).replace(/\.[^./\\]+$/, "") || "output";
  parts.push(outArg(`${base}.gif`));
  return ffmpegCmd(parts.join(" "));
}
/**
 * 降噪参数。单独抽出是为了让页面能复用同一个 `buildAudioDenoise()` 预览滤镜片段，
 * 不另写一份拼接逻辑（避免 UI 提示与实际命令漂移）。
 */
export interface DenoiseOpts {
  /** 降噪算法：off = 不降噪；fft = afftdn（通用稳态噪声）；nlmeans = anlmdn（宽带噪声，很慢） */
  denoise: string;
  /** afftdn 降噪强度 nr：0.01 ~ 97，默认 12。越大越强，过大会削掉人声细节 */
  denoiseNr: number;
  /** afftdn 噪声底 nf：-80 ~ -20 dB，默认 -50。判定为噪声的电平阈值，值越大降噪越激进 */
  denoiseNf: number;
  /** afftdn 噪声类型：white / vinyl / shellac */
  denoiseNt: string;
  /** afftdn 噪声追踪 tn：噪声随时间变化（风扇、风声）时开启 */
  denoiseTn: boolean;
  /** anlmdn 降噪强度 s：默认 0.001（实用区间约 1e-4 ~ 1e-2） */
  denoiseS: number;
  /** anlmdn 平滑因子 m：1 ~ 1000，默认 11 */
  denoiseM: number;
}

export interface AudioOpts extends DenoiseOpts {
  /** process = 对单个文件做音频处理；concat = 多个音频顺序拼接 */
  mode: "process" | "concat";
  /** process 模式的输入 */
  input: string;
  /** concat 模式的文件列表（顺序即拼接顺序） */
  files: string[];
  /** 输出格式：mp3 / m4a / wav / flac / opus */
  outFmt: string;
  /** 音质档位：high / standard / small（按容器映射到 VBR 质量 / 码率 / 压缩级别） */
  quality: "high" | "standard" | "small";
  /** 采样率 Hz，0 = 保持原始 */
  sampleRate: number;
  /** 响度归一化（loudnorm） */
  normalize: boolean;
  /** 目标响度 LUFS（normalize 时生效，默认 -16） */
  loudnormI: number;
  /** 淡入时长（秒），0 = 不淡入 */
  fadeIn: number;
  /** 淡出时长（秒），0 = 不淡出 */
  fadeOut: number;
  /** 音量增益（dB），0 = 不变（可为负） */
  volumeGain: number;
  /** 去除首尾静音 */
  silenceRemove: boolean;
  /** 声道：0=保持，1=单声道，2=立体声 */
  channels: number;
  /** 总时长（秒）；仅用于计算淡出起点。0 = 未知（淡出退化为从 0 开始，选好文件探测后自动修正） */
  duration: number;
  /** WAV 位深：16 / 24 / 32（32=32bit 浮点）；仅 outFmt=wav 时生效，其它容器忽略 */
  wavDepth: number;
  /** 自定义音频滤镜链（高级），追加到 -af 末尾 */
  customAf: string;
}

/**
 * 按容器把「音质档位」翻成 ffmpeg 参数：
 * - mp3：VBR `-q:a`（0 最好 → 9 最小）
 * - aac/m4a、opus：固定码率 `-b:a`
 * - flac：`-compression_level`（0 最快 → 12 最小）
 * - wav：PCM 无损，档位无意义，不加参数
 */
function audioQualityArgs(fmt: string, q: string): string[] {
  switch (fmt) {
    case "mp3": {
      const vbr = q === "high" ? 0 : q === "small" ? 4 : 2;
      return [`-q:a ${vbr}`];
    }
    case "m4a":
    case "aac": {
      const br = q === "high" ? 192 : q === "small" ? 96 : 128;
      return [`-b:a ${br}k`];
    }
    case "opus": {
      const br = q === "high" ? 160 : q === "small" ? 64 : 96;
      return [`-b:a ${br}k`];
    }
    case "flac": {
      const cl = q === "high" ? 12 : q === "small" ? 0 : 5;
      return [`-compression_level ${cl}`];
    }
    default:
      return []; // wav = pcm_s16le，采样位深固定
  }
}

/** 按容器选择音频编码器；WAV 额外按位深在 PCM 变体间切换 */
function audioEnc(fmt: string, wavDepth: number): string {
  if (fmt !== "wav") return AUDIO_ONLY_FMT[fmt] || "aac";
  if (wavDepth >= 32) return "pcm_f32le";
  if (wavDepth >= 24) return "pcm_s24le";
  return "pcm_s16le";
}

/** 数值收窄到区间内并去掉多余小数（避免命令里出现 12.000000001） */
function clampNum(x: number, min: number, max: number, fallback: number): string {
  const v = Number(x);
  const n = Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  return String(Math.round(n * 1e6) / 1e6);
}

/** afftdn 的噪声类型只接受这三种，其它值一律回落白噪 */
const NOISE_TYPES: Record<string, string> = { white: "w", vinyl: "v", shellac: "s" };

/**
 * 降噪滤镜片段；denoise=off 时返回空串（不进链）。
 *
 * 两个算法的取舍：
 * - `afftdn`：基于 FFT 的谱减法，速度快，对稳态噪声（电流底噪、空调、风扇）效果好；
 *   靠 nr/nf 控制强度，过强会出现"水下声/金属感"。
 * - `anlmdn`：非局部均值，对宽带噪声更自然，但计算量极大（实测远慢于实时），
 *   只适合短音频；p/r 用默认 patch/research 时长即可，只暴露强度与平滑。
 */
export function buildAudioDenoise(o: DenoiseOpts): string {
  if (o.denoise === "fft") {
    const nr = clampNum(o.denoiseNr, 0.01, 97, 12);
    const nf = clampNum(o.denoiseNf, -80, -20, -50);
    const nt = NOISE_TYPES[o.denoiseNt] || "w";
    return `afftdn=nr=${nr}:nf=${nf}:nt=${nt}${o.denoiseTn ? ":tn=1" : ""}`;
  }
  if (o.denoise === "nlmeans") {
    const s = clampNum(o.denoiseS, 1e-5, 10, 0.001);
    const m = clampNum(o.denoiseM, 1, 1000, 11);
    return `anlmdn=s=${s}:p=0.002:r=0.006:m=${m}`;
  }
  return "";
}

/** 通用 af 片段：降噪/淡入/淡出/音量/响度/去静音/自定义，按推荐顺序排列 */
function buildAudioFilters(o: AudioOpts): string[] {
  const af: string[] = [];
  // 降噪排在最前：先净化信号再增益，否则底噪会被音量/响度归一化一起放大
  const dn = buildAudioDenoise(o);
  if (dn) af.push(dn);
  if (o.fadeIn > 0) af.push(`afade=t=in:st=0:d=${o.fadeIn}`);
  if (o.fadeOut > 0) {
    // 淡出必须在结尾前开始：st = 总时长 - 淡出时长。不给 st 时 ffmpeg 默认从 0 秒
    // 开始淡出，等于把开头几秒直接静音（实测哑失败）。总时长未知（尚未探测）时
    // 退化为 st=0，选好文件并探测出时长后会自动修正为正确起点。
    const st = o.duration > 0 ? Math.max(0, o.duration - o.fadeOut).toFixed(3) : 0;
    af.push(`afade=t=out:st=${st}:d=${o.fadeOut}`);
  }
  if (o.volumeGain !== 0) af.push(`volume=${o.volumeGain}dB`);
  if (o.normalize) af.push(`loudnorm=I=${o.loudnormI}`);
  if (o.silenceRemove) {
    // 前后各过一次 silenceremove 并反转，去掉首尾静音段
    af.push(
      "silenceremove=start_periods=1:start_duration=0:start_threshold=-50dB:detection=peak,aformat=dblp,areverse,silenceremove=start_periods=1:start_duration=0:start_threshold=-50dB:detection=peak,aformat=dblp,areverse"
    );
  }
  const cf = (o.customAf || "").trim();
  if (cf) af.push(cf);
  return af;
}

export function buildAudio(o: AudioOpts): string {
  const fmt = o.outFmt || "mp3";
  const enc = audioEnc(fmt, o.wavDepth);
  const qualityArgs = audioQualityArgs(fmt, o.quality || "standard");
  const sampleArgs = o.sampleRate > 0 ? [`-ar ${o.sampleRate}`] : [];

  if (o.mode === "concat") {
    if (!o.files.length) return ffmpegCmd(`（请先选择要拼接的音频文件）`);
    const inputs = o.files.map((f) => `-i ${q(f)}`).join(" ");
    const seg = o.files.map((_, i) => `[${i}:a]`).join("");
    const b = baseName(o.files[0]).replace(/\.[^./\\]+$/, "") || "merged";
    const out = outArg(`${b}.merged.${fmt}`);
    // 先 concat 出单路 [cat]，再把处理滤镜（淡入/音量/响度…）链接在尾部输出 [out]，
    // 让拼接结果整体过一遍处理，而不是被静默丢弃。
    const af = buildAudioFilters(o);
    const fc = af.length
      ? `${seg}concat=n=${o.files.length}:v=0:a=1[cat],[cat]${af.join(",")}[out]`
      : `${seg}concat=n=${o.files.length}:v=0:a=1[out]`;
    const parts = [
      inputs,
      `-filter_complex "${fc}"`,
      `-map "[out]"`,
      ...sampleArgs,
      `-c:a ${enc}`,
      ...qualityArgs,
    ];
    if (o.channels > 0) parts.push(`-ac ${o.channels}`);
    parts.push(out);
    return ffmpegCmd(parts.join(" "));
  }

  const base = baseName(o.input).replace(/\.[^./\\]+$/, "") || "output";
  const parts = [`-i ${q(o.input)}`, "-vn"];
  const af = buildAudioFilters(o);
  if (af.length) parts.push(`-af "${af.join(",")}"`);
  parts.push(...sampleArgs);
  if (o.channels > 0) parts.push(`-ac ${o.channels}`);
  parts.push(`-c:a ${enc}`, ...qualityArgs, outArg(`${base}.audio.${fmt}`));
  return ffmpegCmd(parts.join(" "));
}
