use std::collections::HashMap;
use std::io::{BufReader, Read};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, Manager, State};

/// Progress payload pushed to the frontend over the `ffmpeg-progress` event.
#[derive(Clone, serde::Serialize)]
pub struct FfmpegProgress {
    pub id: String,
    /// 0..100; negative means indeterminate (no duration known).
    pub progress: f64,
    /// Current output timestamp as seen in the ffmpeg log (e.g. "00:00:05").
    pub time: String,
    /// Encode speed, e.g. "2.3x".
    pub speed: String,
    /// running | done | failed | canceled
    pub state: String,
    /// Optional human readable note (errors, etc.).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

/// Per-running-process bookkeeping.
struct Running {
    child: Arc<Mutex<Option<std::process::Child>>>,
    killed: Arc<AtomicBool>,
}

/// 应用设置（持久化到配置目录的 config.json）。
#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// ffmpeg 可执行文件路径
    pub ffmpeg_path: String,
    /// 输出文件已存在时是否覆盖：true → `-y`，false → `-n`
    pub overwrite: bool,
    /// 转换页默认容器
    pub default_fmt: String,
    /// 压缩页默认 CRF
    pub default_crf: u32,
    /// 任务完成后是否闪动窗口提醒
    pub notify_on_done: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            ffmpeg_path: "ffmpeg".to_string(),
            overwrite: true,
            default_fmt: "mp4".to_string(),
            default_crf: 23,
            notify_on_done: true,
        }
    }
}

pub struct FfmpegState {
    /// 应用设置（ffmpeg 路径 / 覆盖策略 / 默认值 / 完成通知）
    settings: Mutex<Settings>,
    /// Currently running processes keyed by task id.
    running: Arc<Mutex<HashMap<String, Running>>>,
    /// 每个任务收集到的 ffmpeg 输出（stderr）。进程结束后仍保留，供「详情」查看。
    logs: Arc<Mutex<HashMap<String, Vec<String>>>>,
}

impl FfmpegState {
    pub fn new() -> Self {
        Self {
            settings: Mutex::new(Settings::default()),
            running: Arc::new(Mutex::new(HashMap::new())),
            logs: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn ffmpeg_path(&self) -> String {
        self.settings.lock().unwrap().ffmpeg_path.clone()
    }

    fn overwrite(&self) -> bool {
        self.settings.lock().unwrap().overwrite
    }

    fn notify_on_done(&self) -> bool {
        self.settings.lock().unwrap().notify_on_done
    }
}

/// 每个任务最多保留的日志行数：超出则丢弃最早的，避免长任务把内存吃满。
const MAX_LOG_LINES: usize = 5000;
/// 日志被截断时插入的标记行。
const LOG_TRUNCATED: &str = "…（更早的日志已省略）";

/// 追加一行日志（带上限，超限截断并在首行留标记）。
fn push_log(logs: &Arc<Mutex<HashMap<String, Vec<String>>>>, id: &str, line: String) {
    let mut map = logs.lock().unwrap();
    let buf = map.entry(id.to_string()).or_default();
    buf.push(line);
    if buf.len() > MAX_LOG_LINES {
        let excess = buf.len() - MAX_LOG_LINES;
        buf.drain(..excess);
        if buf.first().map(String::as_str) != Some(LOG_TRUNCATED) {
            buf.insert(0, LOG_TRUNCATED.to_string());
        }
    }
}

/// ffmpeg 的进度统计行（形如 `frame= 123 fps= 45 … time=00:00:05.00 …`），不适合当错误摘要。
fn is_stats_line(line: &str) -> bool {
    line.contains("frame=") && line.contains("time=")
}

/// 取日志中最后一条有效（非空、非进度统计）的行，作为失败原因摘要。
fn tail_log_line(logs: &Arc<Mutex<HashMap<String, Vec<String>>>>, id: &str) -> Option<String> {
    let map = logs.lock().unwrap();
    map.get(id)?
        .iter()
        .rev()
        .find(|l| !l.trim().is_empty() && !is_stats_line(l))
        .map(|l| {
            let t = l.trim();
            if t.chars().count() > 240 {
                t.chars().take(240).collect::<String>() + "…"
            } else {
                t.to_string()
            }
        })
}

/// 把几条常见失败翻译成人话，比原样抛日志尾部更有用。
fn friendly_note(logs: &Arc<Mutex<HashMap<String, Vec<String>>>>, id: &str) -> Option<String> {
    let joined = {
        let map = logs.lock().unwrap();
        map.get(id)?.join("\n")
    };
    if joined.contains("Not overwriting") || joined.contains("already exists") {
        return Some(
            "输出文件已存在且未允许覆盖：请到「设置 → 默认输出」打开「覆盖已存在文件」。"
                .to_string(),
        );
    }
    if joined.contains("Invalid argument") && joined.contains("Could not write header") {
        return Some(
            "无法写入输出文件头：输出容器不支持的编码组合（例如把 H.264 视频流写进 .mp3）。"
                .to_string(),
        );
    }
    tail_log_line(logs, id)
}

// ===== 持久化：把设置写到应用配置目录（…/AppData/Roaming/<identifier>/config.json）=====

fn config_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("config.json"))
}

fn read_settings(app: &AppHandle) -> Settings {
    config_file(app)
        .and_then(|f| std::fs::read_to_string(f).ok())
        .and_then(|s| serde_json::from_str::<Settings>(&s).ok())
        .unwrap_or_default()
}

fn write_settings(app: &AppHandle, s: &Settings) {
    if let Some(file) = config_file(app) {
        if let Some(dir) = file.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(text) = serde_json::to_string_pretty(s) {
            let _ = std::fs::write(file, text);
        }
    }
}

/// 启动时把磁盘里保存的设置回填进内存状态。
pub fn restore_settings(app: &AppHandle, state: &FfmpegState) {
    *state.settings.lock().unwrap() = read_settings(app);
}

/// Split a command line into argv, honouring double-quoted segments.
fn split_args(cmd: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut cur = String::new();
    let mut in_q = false;
    let mut has = false;
    for c in cmd.chars() {
        if c == '"' {
            in_q = !in_q;
            has = true;
            continue;
        }
        if c == ' ' && !in_q {
            if has {
                args.push(std::mem::take(&mut cur));
                has = false;
            }
        } else {
            cur.push(c);
            has = true;
        }
    }
    if has {
        args.push(cur);
    }
    args
}

/// Parse an ffmpeg timestamp (HH:MM:SS.xx or SS.xx) into seconds.
fn time_to_sec(s: &str) -> Option<f64> {
    let s = s.trim();
    if let Ok(v) = s.parse::<f64>() {
        return Some(v);
    }
    let parts: Vec<&str> = s.split(':').collect();
    let nums: Vec<f64> = parts.iter().filter_map(|p| p.parse::<f64>().ok()).collect();
    match nums.len() {
        3 => Some(nums[0] * 3600.0 + nums[1] * 60.0 + nums[2]),
        2 => Some(nums[0] * 60.0 + nums[1]),
        1 => Some(nums[0]),
        _ => None,
    }
}

/// Best-effort: ask ffprobe for the duration of the first real input file.
fn probe_duration(path: &str, ffprobe: &str) -> Option<f64> {
    let out = Command::new(ffprobe)
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=nokey=1:noprint_wrappers=1",
            path,
        ])
        .output()
        .ok()?;
    let s = String::from_utf8_lossy(&out.stdout);
    s.trim().parse::<f64>().ok()
}

/// Find the first input file in a command (token after a `-i` that is not an option).
fn first_input(cmd_args: &[String]) -> Option<String> {
    let mut iter = cmd_args.iter().peekable();
    while let Some(tok) = iter.next() {
        if tok == "-i" {
            if let Some(next) = iter.next() {
                if !next.starts_with('-') {
                    return Some(next.clone());
                }
            }
        }
    }
    None
}

fn format_time(sec: f64) -> String {
    let s = sec.max(0.0);
    let h = (s / 3600.0).floor() as u32;
    let m = ((s % 3600.0) / 60.0).floor() as u32;
    let s = (s % 60.0).floor() as u32;
    format!("{h:02}:{m:02}:{s:02}")
}

fn emit_progress(app: &AppHandle, payload: FfmpegProgress) {
    let _ = app.emit("ffmpeg-progress", payload);
}

#[tauri::command]
pub fn get_settings(state: State<FfmpegState>) -> Settings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
pub fn set_settings(
    app: AppHandle,
    state: State<FfmpegState>,
    settings: Settings,
) -> Result<(), String> {
    let mut s = settings;
    s.ffmpeg_path = if s.ffmpeg_path.trim().is_empty() {
        "ffmpeg".to_string()
    } else {
        s.ffmpeg_path.trim().to_string()
    };
    if s.default_fmt.trim().is_empty() {
        s.default_fmt = "mp4".to_string();
    }
    if s.default_crf == 0 || s.default_crf > 51 {
        s.default_crf = 23;
    }
    *state.settings.lock().unwrap() = s.clone();
    write_settings(&app, &s);
    Ok(())
}

/// Returns the first line of `ffmpeg -version`, or an error string if not found.
#[tauri::command]
pub fn ffmpeg_version(state: State<FfmpegState>) -> Result<String, String> {
    let bin = state.ffmpeg_path();
    let out = Command::new(&bin)
        .arg("-version")
        .output()
        .map_err(|e| format!("无法执行 ffmpeg（{bin}）：{e}。请在设置中配置正确的 ffmpeg 路径。"))?;
    let text = String::from_utf8_lossy(&out.stdout);
    let first = text.lines().next().unwrap_or("").to_string();
    if first.is_empty() {
        return Err(format!("ffmpeg（{bin}）无有效输出，可能未安装或路径错误。"));
    }
    Ok(first)
}

/// Pick a single media file. The dialog API is callback-based, so we bridge it
/// to async with a oneshot channel (tokio, brought in via Tauri's dependency).
#[tauri::command]
pub async fn pick_file(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    use tokio::sync::oneshot;
    let (tx, rx) = oneshot::channel::<Option<String>>();
    app.dialog()
        .file()
        .add_filter(
            "媒体文件",
            &["mp4", "mkv", "mov", "avi", "webm", "mp3", "wav", "m4a", "png", "jpg", "srt"],
        )
        .pick_file(move |file_path| {
            let _ = tx.send(file_path.map(|p| p.to_string()));
        });
    rx.await.map_err(|_| "文件选择失败或被取消".to_string())
}

/// Pick multiple media files via a native dialog.
#[tauri::command]
pub async fn pick_files(app: AppHandle) -> Result<Vec<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    use tokio::sync::oneshot;
    let (tx, rx) = oneshot::channel::<Vec<String>>();
    app.dialog()
        .file()
        .add_filter("媒体文件", &["mp4", "mkv", "mov", "avi", "webm", "mp3", "wav", "m4a"])
        .pick_files(move |files| {
            let _ = tx.send(
                files
                    .map(|list| list.iter().map(|p| p.to_string()).collect::<Vec<_>>())
                    .unwrap_or_default(),
            );
        });
    rx.await.map_err(|_| "文件选择失败或被取消".to_string())
}

/// Pick an executable (e.g. the ffmpeg binary).
/// Must NOT reuse the media-file filter, otherwise ffmpeg.exe is hidden by the dialog.
#[tauri::command]
pub async fn pick_executable(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    use tokio::sync::oneshot;
    let (tx, rx) = oneshot::channel::<Option<String>>();
    app.dialog()
        .file()
        .set_title("选择 FFmpeg 可执行文件")
        .add_filter("可执行文件", &["exe", "cmd", "bat", "bin"])
        .add_filter("所有文件", &["*"])
        .pick_file(move |file_path| {
            let _ = tx.send(file_path.map(|p| p.to_string()));
        });
    rx.await.map_err(|_| "文件选择失败或被取消".to_string())
}

/// 读取某个任务已收集的 ffmpeg 输出日志（进程结束后仍可读，用于「详情」面板）。
#[tauri::command]
pub fn get_task_log(state: State<FfmpegState>, id: String) -> String {
    state
        .logs
        .lock()
        .unwrap()
        .get(&id)
        .map(|lines| lines.join("\n"))
        .unwrap_or_default()
}

/// 任务被移除时清掉它的日志，避免内存里越攒越多。
#[tauri::command]
pub fn clear_task_log(state: State<FfmpegState>, id: String) {
    state.logs.lock().unwrap().remove(&id);
}

/// 探测媒体文件时长（秒）。剪辑页据此按**真实**总长绘制时间轴，
/// 而不是用一个写死的假长度——否则拖到哪儿都是假的。
#[tauri::command]
pub fn probe_media_duration(state: State<FfmpegState>, path: String) -> Result<f64, String> {
    probe_media_info_full(&path, &state.ffmpeg_path()).map(|i| i.duration)
}

/// 媒体文件信息：文件大小（字节）、时长（秒）、主视频流码率（bps，可选）。
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub size: u64,
    pub duration: f64,
    pub video_bitrate: Option<u64>,
    pub video_width: Option<u32>,
    pub video_height: Option<u32>,
}

/// 把 ffmpeg 可执行文件路径里的"ffmpeg"改成"ffprobe"。
/// 只替换**文件名**部分，避免把目录名里同样出现的 "ffmpeg"（如 ffmpeg_7.1_x64）也改掉。
fn derive_ffprobe_path(ffmpeg_bin: &str) -> String {
    let p = std::path::Path::new(ffmpeg_bin);
    let file_name = p.file_name().and_then(|s| s.to_str()).unwrap_or("ffmpeg");
    let probe_name = if file_name.eq_ignore_ascii_case("ffmpeg")
        || file_name.eq_ignore_ascii_case("ffmpeg.exe")
        || file_name.eq_ignore_ascii_case("ffmpeg.cmd")
        || file_name.eq_ignore_ascii_case("ffmpeg.bat")
    {
        // 直接换文件名
        if let Some(ext) = p.extension().and_then(|s| s.to_str()) {
            format!("ffprobe.{}", ext.to_ascii_lowercase())
        } else {
            "ffprobe".to_string()
        }
    } else {
        // 兜底：把文件名前缀 ffmpeg → ffprobe
        if let Some(stem) = p.file_stem().and_then(|s| s.to_str()) {
            let new_stem = stem.replacen("ffmpeg", "ffprobe", 1);
            if let Some(ext) = p.extension().and_then(|s| s.to_str()) {
                format!("{}.{}", new_stem, ext.to_ascii_lowercase())
            } else {
                new_stem
            }
        } else {
            "ffprobe".to_string()
        }
    };
    match p.parent() {
        Some(dir) if !dir.as_os_str().is_empty() => {
            dir.join(probe_name).to_string_lossy().into_owned()
        }
        _ => probe_name, // 裸 "ffmpeg" / "ffmpeg.exe"（PATH 查找）
    }
}

fn probe_media_info_full(path: &str, ffmpeg_bin: &str) -> Result<MediaInfo, String> {
    if path.trim().is_empty() {
        return Err("未指定文件".into());
    }
    // 文件大小走文件系统，最可靠；ffprobe 的 format=duration / format=bit_rate 也一并取
    let size = std::fs::metadata(path)
        .map(|m| m.len())
        .unwrap_or(0);

    // 把 ffmpeg 可执行文件路径里的"ffmpeg"改成"ffprobe"——只换文件名，不动目录
    // （不能简单 replacen，否则 "…\ffmpeg_7.1_x64\ffmpeg.exe" 会把目录里那个 ffmpeg 也改掉）
    let ffprobe = derive_ffprobe_path(ffmpeg_bin);
    let out = Command::new(&ffprobe)
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration,bit_rate",
            "-show_entries",
            "stream=index,codec_type,bit_rate,width,height",
            "-of",
            "json",
            path,
        ])
        .output()
        .map_err(|e| format!("无法执行 ffprobe：{e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!(
            "无法读取媒体信息：{path}（{}）",
            err.trim().split('\n').next().unwrap_or("")
        ));
    }

    // 不引入 serde_json 解析，逐行扫 JSON——简单且足够稳定。
    let text = String::from_utf8_lossy(&out.stdout);
    let mut duration = 0.0_f64;
    let mut video_bitrate: Option<u64> = None;
    let mut width: Option<u32> = None;
    let mut height: Option<u32> = None;

    for line in text.lines() {
        let line = line.trim();
        if let Some(v) = line.strip_prefix("\"duration\":") {
            let num = v.trim().trim_end_matches(',').trim().trim_matches('"');
            duration = num.parse::<f64>().unwrap_or(duration);
        } else if let Some(v) = line.strip_prefix("\"bit_rate\":") {
            let v = v.trim().trim_end_matches(',').trim_matches('"');
            if v == "N/A" {
                continue;
            }
            // 容器码率（format 段）；后续若遇到 stream 段的视频流码率会被覆盖
            let _ = v.parse::<u64>();
        } else if let Some(v) = line.strip_prefix("\"codec_type\":") {
            let v = v.trim().trim_matches('"');
            if v == "video" {
                // 标记：下一行起的 width/height/bit_rate 都属于这条视频流
                if video_bitrate.is_none() {
                    video_bitrate = Some(0);
                }
            }
        } else if let Some(v) = line.strip_prefix("\"width\":") {
            width = v.trim().trim_end_matches(',').parse::<u32>().ok();
        } else if let Some(v) = line.strip_prefix("\"height\":") {
            height = v.trim().trim_end_matches(',').parse::<u32>().ok();
        }
    }

    // 重新跑一遍，专门取 stream 段的视频 bit_rate（更准确）
    let out2 = Command::new(&ffprobe)
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=bit_rate,avg_bit_rate,width,height",
            "-of",
            "json",
            path,
        ])
        .output()
        .ok();
    if let Some(o) = out2 {
        let t = String::from_utf8_lossy(&o.stdout);
        for line in t.lines() {
            let line = line.trim();
            if let Some(v) = line.strip_prefix("\"bit_rate\":") {
                let v = v.trim().trim_end_matches(',').trim_matches('"');
                if v != "N/A" {
                    if let Ok(n) = v.parse::<u64>() {
                        video_bitrate = Some(n);
                    }
                }
            } else if let Some(v) = line.strip_prefix("\"avg_bit_rate\":") {
                let v = v.trim().trim_end_matches(',').trim_matches('"');
                if v != "N/A" {
                    if let Ok(n) = v.parse::<u64>() {
                        video_bitrate = Some(n);
                    }
                }
            } else if let Some(v) = line.strip_prefix("\"width\":") {
                width = width.or_else(|| v.trim().trim_end_matches(',').parse::<u32>().ok());
            } else if let Some(v) = line.strip_prefix("\"height\":") {
                height = height.or_else(|| v.trim().trim_end_matches(',').parse::<u32>().ok());
            }
        }
    }

    // 仍拿不到时长时回退到单独 probe_duration
    if duration <= 0.0 {
        duration = probe_duration(path, &ffprobe).unwrap_or(0.0);
    }

    Ok(MediaInfo {
        size,
        duration,
        video_bitrate,
        video_width: width,
        video_height: height,
    })
}

/// 前端读取源文件的 size / duration / 主视频流码率等元信息，
/// 用于压缩页的「预估输出」计算，避免显示写死的假数字。
#[tauri::command]
pub fn probe_media_info(state: State<FfmpegState>, path: String) -> Result<MediaInfo, String> {
    probe_media_info_full(&path, &state.ffmpeg_path())
}

/// Spawn an ffmpeg process for `cmd`, stream progress to the frontend, support cancel.
#[tauri::command]
pub fn run_ffmpeg(
    app: AppHandle,
    state: State<FfmpegState>,
    id: String,
    cmd: String,
    cwd: Option<String>,
) -> Result<(), String> {
    let bin = state.ffmpeg_path();
    let overwrite = state.overwrite();
    let notify = state.notify_on_done();
    let ffprobe = derive_ffprobe_path(&bin);
    let args = split_args(&cmd);
    if args.len() < 2 {
        return Err("命令无效：缺少参数".into());
    }
    // args[0] is the binary placeholder ("ffmpeg"); use configured path instead.
    let mut input_args: Vec<String> = args[1..].to_vec();

    // 关键：子进程的 stdin 是 null，ffmpeg 一旦发现输出文件已存在就会交互式询问
    // 「Overwrite? [y/N]」，而没人能回答它 → 直接以 "Not overwriting - exiting" 退出。
    // 所以必须显式给 -y / -n（构建器通常已带，这里兜底，避免任何入口再踩坑）。
    if !input_args.iter().any(|a| a == "-y" || a == "-n") {
        input_args.insert(0, if overwrite { "-y".into() } else { "-n".into() });
    }

    let duration = first_input(&input_args).as_ref().and_then(|f| probe_duration(f, &ffprobe));

    let mut command = Command::new(&bin);
    command.args(&input_args);
    command.stdin(Stdio::null());
    command.stdout(Stdio::null());
    command.stderr(Stdio::piped());
    if let Some(dir) = &cwd {
        command.current_dir(dir);
    }

    let mut child = command.spawn().map_err(|e| {
        let msg =
            format!("启动 ffmpeg 失败：{e}。请确认 ffmpeg 已安装且路径正确（当前：{bin}）。");
        // 连进程都没起来的错误也要进日志，否则「详情」里是空的
        push_log(&state.logs, &id, msg.clone());
        msg
    })?;

    let stderr = child.stderr.take().unwrap();
    let child = Arc::new(Mutex::new(Some(child)));
    let killed = Arc::new(AtomicBool::new(false));
    let reg = state.running.clone();
    reg.lock().unwrap().insert(
        id.clone(),
        Running {
            child: child.clone(),
            killed: killed.clone(),
        },
    );

    let app2 = app.clone();
    let id2 = id.clone();
    let logs2 = state.logs.clone();
    tauri::async_runtime::spawn(async move {
        // ffmpeg 的进度统计以 `\r` 结尾、普通日志以 `\n` 结尾，所以这里按字节读取、
        // 按 `\r`/`\n` 切行：两类输出都能实时拿到，并且都会被收进任务日志。
        let mut reader = BufReader::new(stderr);
        let mut buf = [0u8; 8192];
        let mut pending: Vec<u8> = Vec::new();
        let mut last_progress = 0.0_f64;

        loop {
            let n = match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => n,
                Err(_) => break,
            };
            pending.extend_from_slice(&buf[..n]);

            while let Some(pos) = pending.iter().position(|&b| b == b'\r' || b == b'\n') {
                let raw = String::from_utf8_lossy(&pending[..pos]).trim().to_string();
                pending.drain(..=pos);
                if raw.is_empty() {
                    continue;
                }
                push_log(&logs2, &id2, raw.clone());

                let mut cur_time: Option<f64> = None;
                let mut speed = String::new();
                for kv in raw.split_whitespace() {
                    if let Some(rest) = kv.strip_prefix("time=") {
                        if let Some(sec) = time_to_sec(rest) {
                            cur_time = Some(sec);
                        }
                    } else if let Some(rest) = kv.strip_prefix("speed=") {
                        speed = rest.to_string();
                    }
                }
                if let (Some(t), Some(dur)) = (cur_time, duration) {
                    let p = (t / dur * 100.0).clamp(0.0, 100.0);
                    if (p - last_progress).abs() >= 1.0 || p >= 100.0 {
                        last_progress = p;
                        emit_progress(
                            &app2,
                            FfmpegProgress {
                                id: id2.clone(),
                                progress: p,
                                time: format_time(t),
                                speed: speed.clone(),
                                state: "running".into(),
                                note: None,
                            },
                        );
                    }
                } else if let Some(t) = cur_time {
                    emit_progress(
                        &app2,
                        FfmpegProgress {
                            id: id2.clone(),
                            progress: -1.0,
                            time: format_time(t),
                            speed: speed.clone(),
                            state: "running".into(),
                            note: None,
                        },
                    );
                }
            }
        }

        // 收尾：最后一行可能没有以 `\r`/`\n` 结束
        if !pending.is_empty() {
            let raw = String::from_utf8_lossy(&pending).trim().to_string();
            if !raw.is_empty() {
                push_log(&logs2, &id2, raw);
            }
        }

        let mut c = child.lock().unwrap();
        let status = c.as_mut().and_then(|c| c.wait().ok());
        let was_killed = killed.load(Ordering::SeqCst);

        let final_state = if was_killed {
            "canceled"
        } else if let Some(s) = status {
            if s.success() { "done" } else { "failed" }
        } else {
            "failed"
        };

        // 「完成后通知」：成功结束时闪一下任务栏图标，把人叫回来
        if final_state == "done" && notify {
            if let Some(win) = app2.get_webview_window("main") {
                let _ = win.request_user_attention(Some(tauri::UserAttentionType::Informational));
            }
        }

        emit_progress(
            &app2,
            FfmpegProgress {
                id: id2.clone(),
                progress: if final_state == "done" { 100.0 } else { last_progress },
                time: String::new(),
                speed: String::new(),
                state: final_state.into(),
                note: if final_state == "failed" {
                    Some(friendly_note(&logs2, &id2).unwrap_or_else(|| {
                        "ffmpeg 返回非零退出码，请检查命令与输入文件。".into()
                    }))
                } else {
                    None
                },
            },
        );

        reg.lock().unwrap().remove(&id2);
    });

    Ok(())
}

#[tauri::command]
pub fn cancel_ffmpeg(state: State<FfmpegState>, id: String) -> Result<(), String> {
    let mut map = state.running.lock().unwrap();
    if let Some(running) = map.get(&id) {
        running.killed.store(true, Ordering::SeqCst);
        if let Some(child) = running.child.lock().unwrap().as_mut() {
            let _ = child.kill();
        }
        map.remove(&id);
        Ok(())
    } else {
        Err("未找到运行中的任务".into())
    }
}
