mod ffmpeg;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(ffmpeg::FfmpegState::new())
        .setup(|app| {
            use tauri::Manager;
            // 启动时回填上次保存的设置（ffmpeg 路径、覆盖策略、默认值、完成通知）
            ffmpeg::restore_settings(app.handle(), &app.state::<ffmpeg::FfmpegState>());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ffmpeg::ffmpeg_version,
            ffmpeg::get_settings,
            ffmpeg::set_settings,
            ffmpeg::pick_file,
            ffmpeg::pick_files,
            ffmpeg::pick_executable,
            ffmpeg::probe_media_duration,
            ffmpeg::probe_media_info,
            ffmpeg::run_ffmpeg,
            ffmpeg::cancel_ffmpeg,
            ffmpeg::get_task_log,
            ffmpeg::clear_task_log,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ffmpeg-studio");
}
