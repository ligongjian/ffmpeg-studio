use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
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
    /// 录制会话：同时只能有一段录制，与任务队列的 running 完全隔离。
    /// 用 Arc 包裹，便于把引用分发给后台监视线程（stop_record 仍需在此查询 child 的 stdin）。
    record: Arc<Mutex<Option<Recording>>>,
}

impl FfmpegState {
    pub fn new() -> Self {
        Self {
            settings: Mutex::new(Settings::default()),
            running: Arc::new(Mutex::new(HashMap::new())),
            logs: Arc::new(Mutex::new(HashMap::new())),
            record: Arc::new(Mutex::new(None)),
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

/// 致命错误关键词：命中任一个都说明 ffmpeg 没能正常完成录制（与「用户按 q 主动停止」区分开）。
const FATAL_KEYWORDS: &[&str] = &[
    "Error opening",
    "Invalid argument",
    "Permission denied",
    "No such file",
    "Unable to find a suitable output format",
    "Device or resource busy",
    "Cannot open audio device",
    "Unknown encoder",
    "Unrecognized option",
    "avformat_open_input",
];

/// 日志里是否出现致命错误标记。
fn log_has_fatal(log: &str) -> bool {
    FATAL_KEYWORDS.iter().any(|kw| log.contains(kw))
}

/// 取日志里第一条含致命关键词的行（最贴近真实报错原因），没有则返回最后一条有效行。
fn first_fatal_line(logs: &Arc<Mutex<HashMap<String, Vec<String>>>>, id: &str) -> Option<String> {
    let map = logs.lock().unwrap();
    let buf = map.get(id)?;
    for l in buf.iter() {
        let t = l.trim();
        if FATAL_KEYWORDS.iter().any(|kw| t.contains(kw)) {
            return Some(if t.chars().count() > 240 {
                t.chars().take(240).collect::<String>() + "…"
            } else {
                t.to_string()
            });
        }
    }
    None
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
    first_fatal_line(logs, id).or_else(|| tail_log_line(logs, id))
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

/// 单次命令带超时执行。`Command::output()` 没有超时机制，
/// 遇到损坏/巨大文件可能让 ffprobe 永远挂住；超时后杀掉子进程返回 Err。
/// 用 channel 让 wait 线程通知主线程，避免阻塞调用方。
fn run_with_timeout(cmd: &mut Command, timeout: std::time::Duration) -> Result<std::process::Output, String> {
    use std::time::Instant;

    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("启动失败：{e}"))?;

    // 子线程读 stdout，主线程读 stderr（或反之），避免管道填满后子进程死锁。
    let stdout_handle = child.stdout.take();
    let stderr_handle = child.stderr.take();

    let stdout_thread = stdout_handle.map(|mut h| std::thread::spawn(move || {
        let mut buf = String::new();
        let _ = BufReader::new(&mut h).read_to_string(&mut buf);
        buf
    }));
    let stderr_thread = stderr_handle.map(|mut h| std::thread::spawn(move || {
        let mut buf = String::new();
        let _ = BufReader::new(&mut h).read_to_string(&mut buf);
        buf
    }));

    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_status)) => break,
            Ok(None) => {
                if start.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("命令超时（{}s）", timeout.as_secs()));
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(e) => return Err(format!("等待子进程失败：{e}")),
        }
    }
    let status = child.wait().map_err(|e| format!("读取退出码失败：{e}"))?;

    let stdout = stdout_thread
        .and_then(|t| t.join().ok())
        .unwrap_or_default();
    let stderr = stderr_thread
        .and_then(|t| t.join().ok())
        .unwrap_or_default();

    Ok(std::process::Output {
        status,
        stdout: stdout.into_bytes(),
        stderr: stderr.into_bytes(),
    })
}

fn probe_media_info_full(path: &str, ffmpeg_bin: &str) -> Result<MediaInfo, String> {
    if path.trim().is_empty() {
        return Err("未指定文件".into());
    }
    // 文件大小走文件系统，最可靠
    let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);

    let ffprobe = derive_ffprobe_path(ffmpeg_bin);
    // 单次探测：format + stream 一次拿全，再不必跑两三次。
    let mut cmd = Command::new(&ffprobe);
    cmd.args([
        "-v", "error",
        "-show_entries", "format=duration",
        "-show_entries", "stream=index,codec_type,bit_rate,avg_bit_rate,width,height",
        "-of", "json",
        path,
    ]);
    let out = run_with_timeout(&mut cmd, std::time::Duration::from_secs(15))
        .map_err(|e| format!("无法读取媒体信息：{path}（{e}）"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!(
            "无法读取媒体信息：{path}（{}）",
            err.trim().split('\n').next().unwrap_or("")
        ));
    }

    // 不引入 serde_json 解析，逐行扫 JSON——简单且足够稳定。
    // format 段先于 stream 段出现；用 in_stream 标记，遇到 codec_type 切换流。
    let text = String::from_utf8_lossy(&out.stdout);
    let mut duration = 0.0_f64;
    let mut video_bitrate: Option<u64> = None;
    let mut width: Option<u32> = None;
    let mut height: Option<u32> = None;
    // 当前所在的 stream 是否为视频（遇到下一行 codec_type 才确定，先用待定标记）
    let mut pending_codec: Option<bool> = None;
    let mut current_is_video = false;

    for line in text.lines() {
        let line = line.trim();
        if let Some(v) = line.strip_prefix("\"duration\":") {
            let num = v.trim().trim_end_matches(',').trim().trim_matches('"');
            duration = num.parse::<f64>().unwrap_or(duration);
        } else if let Some(v) = line.strip_prefix("\"codec_type\":") {
            // codec_type 出现在同一 stream 块的开头，先记下，等本块字段读完后才切换
            pending_codec = Some(v.trim().trim_matches('"') == "video");
            current_is_video = false;
        } else if current_is_video || pending_codec == Some(true) {
            // 只有视频流字段才计入
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
        // 一行字段读完后才把 pending_codec 固化，保证 block 边界正确
        if line.ends_with('{') || line.ends_with('}') {
            if let Some(v) = pending_codec.take() {
                current_is_video = v;
            }
        }
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

/// 为 concat 模式写一份 `merge_list.txt` 到指定目录，文件内容形如：
///   file 'C:\...\a.mp4'
///   file 'C:\...\b.mp4'
/// 之所以写绝对路径并加单引号：concat demuxer 默认拒绝绝对路径，命令里 `-safe 0` 才允许，
/// 但路径里出现单引号仍需转义成 `'\''`（shell 风格），否则 ffmpeg 解析失败。
#[tauri::command]
pub fn write_concat_list(dir: String, files: Vec<String>) -> Result<String, String> {
    if files.is_empty() {
        return Err("文件列表为空".into());
    }
    let dir_path = PathBuf::from(&dir);
    if !dir_path.as_os_str().is_empty() {
        std::fs::create_dir_all(&dir_path)
            .map_err(|e| format!("无法创建目录 {}: {}", dir, e))?;
    }
    let list_path = dir_path.join("merge_list.txt");
    let mut body = String::new();
    for f in &files {
        let esc = f.replace('\\', "/").replace('\'', "'\\''");
        body.push_str(&format!("file '{}'\n", esc));
    }
    std::fs::write(&list_path, body)
        .map_err(|e| format!("写入 {} 失败: {}", list_path.display(), e))?;
    Ok(list_path.to_string_lossy().into_owned())
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

// ===== 录制采集 =====
//
// 录制**不**走任务队列：队列的执行模型（串行调度、进程退出即 done、退出码即成败）
// 与录制的特性完全不匹配——录制由用户决定何时结束，靠 stdin 写 `q` 优雅收尾，
// 而不是让 ffmpeg 自己跑完。因此用独立的 record 槽位持有唯一的录制进程。

/// 一次录制会话：保留 child 的 stdin 用于优雅停止（写 `q` 让 ffmpeg 写完 moov 原子）。
struct Recording {
    child: Child,
    started_at: std::time::SystemTime,
    output: String,
    /// 用户是否主动点了「停止」（向 stdin 写了 `q`）。用来区分「正常收尾」与「真失败」，
    /// 因为 ffmpeg 被 q 中断时退出码非 0，但那其实是预期的成功停止。
    graceful: bool,
}

/// 一个采集设备（来自 `ffmpeg -list_devices 1 -f dshow -i dummy`）。
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceItem {
    /// 设备类型：`video` 或 `audio`
    pub kind: String,
    /// 设备名（含 `[DShow]` 前缀，形如 `Video: 笔记本的摄像头 [DShow]`）
    pub name: String,
    /// 括号里的设备标识，直接填进 `dshow -i video=...`
    pub identifier: String,
}

/// 一个物理显示器（由 Win32 `EnumDisplayMonitors` 枚举得到）。
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayItem {
    /// 显示器左上角坐标（虚拟桌面坐标系；副屏若在主屏左/上方则可为负）。
    /// 直接作为 gdigrab 的 `-offset_x` / `-offset_y` 使用。
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    /// 归一化位置（前端当前未使用，占位为 0）。
    pub normalized_x: f64,
    /// 显示器序号（从 1 开始），仅用于 UI 展示。
    pub index: u32,
}

/// 录制前端需要的会话状态快照。
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordStatus {
    pub is_recording: bool,
    /// 录制已持续的秒数（进程未退出时的实时值）
    pub elapsed: f64,
    /// 录制进程退出时的状态：`done` | `failed` | `canceled` | 空
    pub state: String,
    pub output: String,
    pub note: Option<String>,
}

fn elapsed_secs(start: &std::time::SystemTime) -> f64 {
    start
        .elapsed()
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

/// 以 timeout 秒为限执行 ffmpeg/ffprobe 并把 stdout+stderr 合并回来。
/// 设备枚举命令的有用输出在 stderr（dshow / gdigrab 的 list 都在那里），
/// 所以即使进程非零退出（list 模式下通常会），我们也照样收集文本。
fn run_capture(bin: &str, args: &[&str], timeout: std::time::Duration) -> Option<String> {
    let mut cmd = Command::new(bin);
    cmd.args(args);
    let out = run_with_timeout(&mut cmd, timeout).ok()?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    Some(format!("{}\n{}", stdout, stderr))
}

// ===== 显示器枚举：走 Win32 API（gdigrab 不支持列出显示器）=====
#[repr(C)]
struct Rect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

#[repr(C)]
struct MonitorInfo {
    cb_size: u32,
    rc_monitor: Rect,
    rc_work: Rect,
    dw_flags: u32,
}

#[link(name = "user32")]
extern "system" {
    fn EnumDisplayMonitors(
        hdc: *mut std::ffi::c_void,
        lprc_clip: *const Rect,
        lpfn_enum: extern "system" fn(*mut std::ffi::c_void, *mut std::ffi::c_void, *const Rect, isize) -> i32,
        dw_data: isize,
    ) -> i32;
    fn GetMonitorInfoW(hmonitor: *mut std::ffi::c_void, lpmi: *mut MonitorInfo) -> i32;
}

extern "system" fn monitor_enum_proc(
    hmonitor: *mut std::ffi::c_void,
    _hdc: *mut std::ffi::c_void,
    _rect: *const Rect,
    lparam: isize,
) -> i32 {
    // lparam 是调用方传入的 &mut Vec<DisplayItem> 指针；枚举是同步的，
    // 函数返回前回调已结束，故该指针在回调期间始终有效。
    let list = unsafe { &mut *(lparam as *mut Vec<DisplayItem>) };
    let mut mi = MonitorInfo {
        cb_size: std::mem::size_of::<MonitorInfo>() as u32,
        rc_monitor: Rect { left: 0, top: 0, right: 0, bottom: 0 },
        rc_work: Rect { left: 0, top: 0, right: 0, bottom: 0 },
        dw_flags: 0,
    };
    // 拿不到信息就跳过这块屏，但继续枚举其余显示器
    if unsafe { GetMonitorInfoW(hmonitor, &mut mi) } == 0 {
        return 1;
    }
    let r = mi.rc_monitor;
    list.push(DisplayItem {
        x: r.left,
        y: r.top,
        width: (r.right - r.left) as u32,
        height: (r.bottom - r.top) as u32,
        // 前端未使用；主屏在 Windows 虚拟桌面里固定位于 (0,0)
        normalized_x: 0.0,
        index: list.len() as u32 + 1,
    });
    1
}

/// 列出 Windows 物理显示器。
///
/// 注意：gdigrab（ffmpeg 的 GDI 抓取设备）**不支持**「列出显示器」——
/// `ffmpeg -f gdigrab -list_displays -i desktop` 会直接报
/// `Unrecognized option 'list_displays'`，ffmpeg 命令行拿不到任何显示器列表，
/// 原先解析器期待的 `Found monitor at ...` 格式也从未存在。
///
/// 因此这里改为调用 Win32 API（`EnumDisplayMonitors` + `GetMonitorInfoW`），
/// 这正是 gdigrab 内部用来定位显示器的同一套 API，能拿到真实的虚拟桌面坐标、
/// 尺寸与主屏标记。坐标系为 Windows 虚拟桌面：副屏若在主屏左/上方则为负值，
/// 可直接作为 gdigrab 的 `-offset_x` / `-offset_y`（ffmpeg 文档确认支持负值）。
#[tauri::command]
pub fn list_displays(_state: State<FfmpegState>) -> Vec<DisplayItem> {
    let mut monitors: Vec<DisplayItem> = Vec::new();
    let ptr = &mut monitors as *mut Vec<DisplayItem> as isize;
    unsafe {
        EnumDisplayMonitors(
            std::ptr::null_mut(),
            std::ptr::null(),
            monitor_enum_proc,
            ptr,
        );
    }
    monitors
}

/// 列出 DShow 视频/音频设备（Windows）。失败时返回空数组，前端回退到占位提示。
///
/// ffmpeg 7.x 的真实输出形如（类型 `video`/`audio` 直接标在设备名同一行的括号里）：
///   [dshow @ ...] "Integrated Camera" (video)
///   [dshow @ ...]   Alternative name "@device_pnp_..."
///   [dshow @ ...] "麦克风阵列 (适用于数字麦克风的英特尔® 智音技术)" (audio)
///   [dshow @ ...]   Alternative name "@device_cm_..."
/// 较老版本则是「DirectShow video devices / audio devices」段标题 + 缩进的
/// `"设备名"` 行（类型由段标题决定）。两种格式这里都兼容。
#[tauri::command]
pub fn list_devices(state: State<FfmpegState>) -> Vec<DeviceItem> {
    let bin = state.ffmpeg_path();
    let out = match run_capture(
        &bin,
        &["-hide_banner", "-list_devices", "1", "-f", "dshow", "-i", "dummy"],
        std::time::Duration::from_secs(10),
    ) {
        Some(s) => s,
        None => return Vec::new(),
    };
    let mut items = Vec::new();
    let mut in_video = false;
    let mut in_audio = false;
    for line in out.lines() {
        let l = line.trim();
        if !l.starts_with("[dshow @") {
            continue;
        }
        // 段标题（老格式）：切换 video/audio 上下文
        if l.contains("DirectShow video devices") {
            in_video = true;
            in_audio = false;
            continue;
        } else if l.contains("DirectShow audio devices") {
            in_audio = true;
            in_video = false;
            continue;
        }
        // 属性行（如 `  Alternative name "..."`）跳过
        if l.contains("Alternative name") {
            continue;
        }
        // 取 [dshow @ ...] 之后的内容
        let Some(bracket_end) = l.find(']') else { continue };
        let after = l[bracket_end + 1..].trim_start();
        if after.is_empty() {
            continue;
        }
        // 提取引号里的设备名（第一个 " 到匹配的 " 之间）
        let Some(q1) = after.find('"') else { continue };
        let rest = &after[q1 + 1..];
        let Some(q2) = rest.find('"') else { continue };
        let device_name = rest[..q2].trim();
        if device_name.is_empty() {
            continue;
        }
        // 设备名之后的尾串：新格式为 " (video)" / " (audio)"
        let tail = rest[q2 + 1..].trim();
        let kind = if tail == "(video)" {
            "video"
        } else if tail == "(audio)" {
            "audio"
        } else if in_video {
            // 老格式：无内联类型，依赖段标题上下文
            "video"
        } else if in_audio {
            "audio"
        } else {
            // 既无内联类型、又不在任何段标题上下文中：无法确定类型，跳过
            continue;
        };
        items.push(DeviceItem {
            kind: kind.to_string(),
            name: format!("{} [DShow]", device_name),
            // dshow 用设备名（而非序号）引用，identifier 直接填设备名，
            // 前端 qDevice() 会加引号拼成 audio="设备名"。
            identifier: device_name.to_string(),
        });
    }
    items
}

/// 选择录制输出目录（原生文件夹对话框）。
#[tauri::command]
pub async fn pick_record_dir(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    use tokio::sync::oneshot;
    let (tx, rx) = oneshot::channel::<Option<String>>();
    app.dialog()
        .file()
        .set_title("选择录制输出目录")
        .pick_folder(move |path| {
            let _ = tx.send(path.map(|p| p.to_string()));
        });
    rx.await.map_err(|_| "目录选择失败或被取消".to_string())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordStartOpts {
    /// 已经拼好的 ffmpeg 命令行（由前端 buildRecordCommand 产出，包含占位 `ffmpeg`）
    cmd: String,
    /// 录制输出的目标目录（绝对路径）
    out_dir: String,
}

/// 启动一段录制：拉起 ffmpeg 子进程，把 stdin 保留用于优雅停止。
#[tauri::command]
pub fn start_record(app: AppHandle, state: State<FfmpegState>, opts: RecordStartOpts) -> Result<(), String> {
    let mut rec = state.record.lock().unwrap();
    if rec.is_some() {
        return Err("已有录制正在进行，请先停止再开始新的录制".into());
    }
    let bin = state.ffmpeg_path();
    let overwrite = state.overwrite();
    let args = split_args(&opts.cmd);
    if args.len() < 2 {
        return Err("命令无效：缺少参数".into());
    }
    let mut input_args: Vec<String> = args[1..].to_vec();
    // 录制输出文件名由前端保证唯一（带时间戳），但仍按设置插 -y / -n。
    if !input_args.iter().any(|a| a == "-y" || a == "-n") {
        input_args.insert(0, if overwrite { "-y".into() } else { "-n".into() });
    }

    let mut command = Command::new(&bin);
    command.args(&input_args);
    command.current_dir(&opts.out_dir);
    command.stdin(Stdio::piped());
    command.stdout(Stdio::null());
    command.stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|e| {
        format!("启动录制失败：{e}。请确认 ffmpeg 已安装且路径正确（当前：{bin}）。")
    })?;

    // 后台线程消费 stderr，否则管道填满后 ffmpeg 会阻塞；
    // 录制期间不需要把日志回推前端，仅用于诊断——保留最近 N 行用于失败说明。
    if let Some(stderr) = child.stderr.take() {
        let logs = state.logs.clone();
        std::thread::spawn(move || {
            let mut buf = BufReader::new(stderr);
            let mut line = String::new();
            loop {
                line.clear();
                match buf.read_line(&mut line) {
                    Ok(0) => break,
                    Ok(_) => push_log(&logs, "record", line.trim().to_string()),
                    Err(_) => break,
                }
            }
        });
    }

    // 从命令行末尾反查输出文件名（最后一个不以 `-` 开头的 token），用于状态展示。
    let output = input_args
        .iter()
        .rev()
        .find(|t| !t.starts_with('-'))
        .cloned()
        .unwrap_or_default();

    *rec = Some(Recording {
        child,
        started_at: std::time::SystemTime::now(),
        output,
        graceful: false,
    });
    let _ = app.emit(
        "record-progress",
        serde_json::json!({ "isRecording": true, "elapsed": 0.0 }),
    );
    drop(rec); // 先释放 MutexGuard，再调用可能内部再次加锁的 spawn_record_watch
    spawn_record_watch(app, state, String::new());
    Ok(())
}

/// 优雅停止录制：向 ffmpeg 的 stdin 写 `q`，让它写完容器尾部（moov / seek head）后自然退出。
/// 注意：ffmpeg 正常结束（写入 q 后优雅收尾）会**返回非零退出码**（"Conversion failed!"），
/// 所以这里只负责按下"停止键"，最终的 done/failed 判定放到 spawn_record_watch 里
/// ——根据退出码 + 日志里是否出现预期的收尾标记来区分"用户主动停止"与"真失败"。
#[tauri::command]
pub fn stop_record(state: State<FfmpegState>) -> Result<(), String> {
    let mut rec = state.record.lock().unwrap();
    if let Some(r) = rec.as_mut() {
        // 标记为「主动停止」，让监视器把它当成正常收尾而非失败。
        r.graceful = true;
        // 向 ffmpeg 的 stdin 写 `q`，让它写完容器尾部（moov / seek head）后自然退出。
        if let Some(mut stdin) = r.child.stdin.take() {
            let _ = stdin.write_all(b"q");
            let _ = stdin.flush();
        }
        Ok(())
    } else {
        Err("当前没有录制在进行".into())
    }
}

/// 查询当前录制会话的状态快照（前端轮询用，与 ffmpeg-progress 事件互补）。
#[tauri::command]
pub fn record_status(state: State<FfmpegState>) -> RecordStatus {
    let rec = state.record.lock().unwrap();
    match rec.as_ref() {
        Some(r) => RecordStatus {
            is_recording: true,
            elapsed: elapsed_secs(&r.started_at),
            state: String::new(),
            output: r.output.clone(),
            note: None,
        },
        None => RecordStatus {
            is_recording: false,
            elapsed: 0.0,
            state: String::new(),
            output: String::new(),
            note: None,
        },
    }
}

/// 在录制进程被创建后**后台**监听其退出，把最终状态推给前端。
/// `start_record` 里调用一次即可。
///
/// 关键约束：`Recording`（含 child）在整个录制期间**必须留在** `state.record` 里，
/// 否则 `stop_record` 拿不到 child 的 stdin 写 `q` 做优雅停止。所以这里只确认存在、
/// 并不取走所有权；退出判定放到子线程轮询 `try_wait` 里，进程真正退出后才 `take` 清空槽位。
///
/// done / failed 判定（关键）：
/// ffmpeg 被 `q` 中断时退出码非 0、且日志里常出现 "Conversion failed" 之类字眼，
/// 但那其实是**预期的正常收尾**。因此这里优先看 `Recording.graceful`——
/// 用户主动停止过就直接算 done（除非日志出现真正致命的错误标记）。
pub fn spawn_record_watch(app: AppHandle, state: State<FfmpegState>, id_snapshot: String) {
    // 录制期间 child 必须留在 state.record，stop_record 才能拿到 stdin 写 q。
    // 这里只确认存在，不取走所有权。
    if state.record.lock().unwrap().is_none() {
        return;
    }
    let record = state.record.clone();
    let logs = state.logs.clone();
    let id = if id_snapshot.is_empty() {
        "record".to_string()
    } else {
        id_snapshot
    };

    // 用独立线程轮询子进程退出（try_wait 非阻塞），不占用 async 运行时。
    std::thread::spawn(move || {
        // 轮询等待子进程退出（每 300ms 探一次）
        let mut exited = false;
        loop {
            let status = {
                let mut rec = record.lock().unwrap();
                match rec.as_mut() {
                    Some(r) => match r.child.try_wait() {
                        Ok(Some(_)) => Some(true), // 已退出
                        Ok(None) => Some(false),   // 运行中
                        Err(_) => None,            // try_wait 出错
                    },
                    None => None, // 槽位已被清空（异常）
                }
            };
            match status {
                Some(true) => {
                    exited = true;
                    break;
                }
                Some(false) => {} // 继续轮询
                None => break,    // 出错或槽位丢失，退出循环
            }
            std::thread::sleep(std::time::Duration::from_millis(300));
        }

        if !exited {
            // 进程没正常退出，按取消处理
            let _ = app.emit(
                "record-progress",
                serde_json::json!({ "isRecording": false, "state": "canceled" }),
            );
            return;
        }

        // 进程已退出：取出录制会话并清空槽位
        let recording = record.lock().unwrap().take();
        let Some(recording) = recording else {
            let _ = app.emit(
                "record-progress",
                serde_json::json!({ "isRecording": false, "state": "canceled" }),
            );
            return;
        };

        let log_text = {
            let map = logs.lock().unwrap();
            map.get(&id).map(|v| v.join("\n")).unwrap_or_default()
        };
        // 真正致命的错误标记（与「用户主动停止」区分开）。注意：不再用 "Conversion failed"，
        // 因为 ffmpeg 被 q 中断也会打印它，会导致正常停止被误判为失败。
        let fatal = log_has_fatal(&log_text);

        let (final_state, note): (&str, Option<String>) = if recording.graceful && !fatal {
            // 用户主动停止（写了 q），视为正常收尾：容器尾部已写完，文件可播放。
            ("done", None)
        } else if fatal {
            // 优先展示真正命中的报错行，而不是 libx264 的收尾统计行，
            // 否则用户只会看到 “kb/s:...” 这种成功才有的摘要，完全看不出失败原因。
            let n = first_fatal_line(&logs, &id)
                .or_else(|| friendly_note(&logs, &id))
                .unwrap_or_else(|| "录制过程中 ffmpeg 报错，输出文件可能损坏。".into());
            ("failed", Some(n))
        } else {
            // 退出码非 0 但无致命错误 → 兜底为 done（正常 q 停止通常走这里）。
            ("done", None)
        };

        let _ = app.emit(
            "record-progress",
            serde_json::json!({
                "isRecording": false,
                "state": final_state,
                "output": recording.output,
                "note": note,
            }),
        );
    });
}
