# FFmpeg 使用指南

FFmpeg 是音视频处理领域最强大的命令行工具集，核心由三个可执行程序组成：

- **`ffmpeg`**：音视频的转码、滤镜、封装、流处理主程序
- **`ffprobe`**：探测媒体文件的流 / 编码 / 元数据信息（可输出 JSON 便于脚本解析）
- **`ffplay`**：轻量播放器，用于快速预览文件或实时流

---

## 一、安装

### Windows
- 官网下载静态构建包：https://ffmpeg.org/download.html
- 解压后将 `bin/` 目录加入系统 `PATH`
- 验证：`ffmpeg -version`

### macOS
```bash
brew install ffmpeg
```

### Linux (Debian/Ubuntu)
```bash
sudo apt update && sudo apt install ffmpeg
```

---

## 二、命令基本结构

```bash
ffmpeg [全局参数] -i 输入文件 [输入参数] [输出参数] 输出文件
```

常见顺序约定：
- 全局参数（`-y` 覆盖输出、`-hide_banner` 隐藏版本信息）放在最前
- `-i` 指定输入
- 输出参数（`-c:v`、`-c:a`、`-vf` 等）放在输出文件之前

示例：
```bash
ffmpeg -y -hide_banner -i input.mp4 -c:v libx264 -crf 23 output.mp4
```

---

## 三、格式与编解码

### 容器互转
```bash
# MKV → MP4
ffmpeg -i in.mkv out.mp4

# 不重新编码，仅换封装（极快）
ffmpeg -i in.mkv -c copy out.mp4
```

### 视频编码
```bash
# H.264
ffmpeg -i in.mp4 -c:v libx264 -crf 23 -preset medium out.mp4

# H.265 / HEVC（体积更小）
ffmpeg -i in.mp4 -c:v libx265 -crf 28 out.mp4

# VP9
ffmpeg -i in.mp4 -c:v libvpx-vp9 -crf 30 -b:v 0 out.webm
```

### 音频编码
```bash
# AAC
ffmpeg -i in.mp4 -c:a aac -b:a 128k out.mp4

# MP3
ffmpeg -i in.wav -c:a libmp3lame -b:a 192k out.mp3

# FLAC（无损）
ffmpeg -i in.wav -c:a flac out.flac
```

### 码率与质量控制
| 参数 | 含义 |
|------|------|
| `-crf` | 恒定质量（18~28 常用，越小越好） |
| `-b:v` | 视频目标码率，如 `2M` |
| `-preset` | 编码速度档（ultrafast→veryslow，越慢压缩率越高） |
| `-b:a` | 音频码率 |

### 硬件加速
```bash
# NVIDIA NVENC
ffmpeg -i in.mp4 -c:v h264_nvenc -preset p1 out.mp4

# Intel QSV
ffmpeg -i in.mp4 -c:v h264_qsv out.mp4
```

---

## 四、滤镜系统

通过 `-vf`（视频）/`-af`（音频）链式调用，多个滤镜用逗号分隔：

```bash
ffmpeg -i in.mp4 -vf "scale=1280:720,crop=1000:600:140:60" out.mp4
```

### 视频常见滤镜
| 滤镜 | 作用 | 示例 |
|------|------|------|
| `scale` | 缩放分辨率 | `scale=1920:1080` |
| `crop` | 裁剪 | `crop=w:h:x:y` |
| `pad` | 加黑边 | `pad=1920:1080:0:60` |
| `rotate` | 旋转 | `rotate=PI/2` |
| `transpose` | 顺时针旋转90° | `transpose=1` |
| `eq` | 亮度/对比度/饱和度 | `eq=brightness=0.1:contrast=1.2` |
| `hue` | 色相 | `hue=h=30` |
| `unsharp` | 锐化 | `unsharp=5:5:1.5` |
| `yadif` | 去隔行 | `yadif=1` |
| `drawtext` | 加文字 | 见下 |
| `subtitles` | 硬字幕 | `subtitles=sub.srt` |
| `overlay` | 叠加/水印 | 见下 |
| `fade` | 淡入淡出 | `fade=t=in:st=0:d=2` |
| `fps` | 帧率转换 | `fps=30` |

### 添加文字水印
```bash
ffmpeg -i in.mp4 -vf "drawtext=text='Demo':x=20:y=20:fontsize=28:fontcolor=white:box=1:boxcolor=black@0.5" out.mp4
```

### 图片水印（画中画）
```bash
ffmpeg -i in.mp4 -i logo.png -filter_complex "overlay=W-w-20:20" out.mp4
```

### 音频常见滤镜
| 滤镜 | 作用 | 示例 |
|------|------|------|
| `volume` | 音量调节 | `volume=1.5` |
| `loudnorm` | 响度归一 | `loudnorm=I=-16:TP=-1.5` |
| `atempo` | 变速不变调 | `atempo=1.5` |
| `highpass`/`lowpass` | 高低通滤波 | `highpass=f=200` |
| `afftdn` | 频谱降噪 | `afftdn=nr=10` |
| `pan` | 声道重映射 | `pan=stereo|c0=c0|c1=c1` |

---

## 五、剪辑与拼接

### 截取片段
```bash
# 从 00:00:30 开始，截取 10 秒（重新编码）
ffmpeg -i in.mp4 -ss 00:00:30 -t 10 out.mp4

# 关键帧快剪（不重编码，速度快但切点在关键帧）
ffmpeg -ss 00:00:30 -i in.mp4 -t 10 -c copy out.mp4
```

### 拼接（同编码直接合并）
创建 `list.txt`：
```
file 'part1.mp4'
file 'part2.mp4'
file 'part3.mp4'
```
```bash
ffmpeg -f concat -safe 0 -i list.txt -c copy merged.mp4
```

### 用滤镜拼接不同分辨率片段
```bash
ffmpeg -i a.mp4 -i b.mp4 -filter_complex "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]" -map "[v]" -map "[a]" out.mp4
```

---

## 六、提取与分离

```bash
# 提取音频（无损）
ffmpeg -i in.mp4 -vn -c:a copy out.m4a

# 提取视频（去音）
ffmpeg -i in.mp4 -an -c:v copy out.mp4

# 提取某一帧为图片
ffmpeg -i in.mp4 -ss 00:00:05 -frames:v 1 frame.png

# 批量生成缩略图（每 10 秒一帧）
ffmpeg -i in.mp4 -vf "fps=1/10" thumb_%03d.png
```

---

## 七、流媒体与实时处理

### 拉流 / 录制直播
```bash
ffmpeg -i "https://example.com/live.m3u8" -c copy record.mp4
```

### 推流到 RTMP
```bash
ffmpeg -re -i in.mp4 -c copy -f flv rtmp://server/live/stream
```

### 生成 HLS 切片
```bash
ffmpeg -i in.mp4 -c:v h264 -hls_time 10 -hls_list_size 0 -f hls out.m3u8
```

### 设备采集（录屏 / 摄像头）
```bash
# Windows 采集摄像头+麦克风 (dshow)
ffmpeg -f dshow -i video="Integrated Camera":audio="麦克风" out.mp4

# macOS 录屏 (avfoundation)
ffmpeg -f avfoundation -i "1:0" out.mp4
```

---

## 八、信息探测（ffprobe）

```bash
# 查看基本流信息
ffprobe in.mp4

# 输出 JSON 供脚本解析
ffprobe -v quiet -print_format json -show_format -show_streams in.mp4

# 只看时长
ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 in.mp4
```

---

## 九、常用参数速查

| 参数 | 含义 |
|------|------|
| `-i` | 输入文件 |
| `-y` | 覆盖输出文件不询问 |
| `-c` / `-codec` | 指定编码器（`:v` 视频/`:a` 音频） |
| `-c copy` | 直接拷贝流不重编码 |
| `-ss` | 起始时间点（支持 `HH:MM:SS` 或秒） |
| `-t` | 持续时间 |
| `-to` | 结束时间点 |
| `-r` | 帧率 |
| `-s` / `-vf scale` | 分辨率 |
| `-ar` | 音频采样率 |
| `-ac` | 音频声道数 |
| `-vf` / `-af` | 视频/音频滤镜 |
| `-filter_complex` | 复杂滤镜图（多输入/多输出） |
| `-map` | 选择流映射到输出 |
| `-metadata` | 写入元数据 |
| `-threads` | 线程数 |
| `-hide_banner` | 隐藏版本横幅 |

---

## 十、实用命令合集

```bash
# 1. 视频压缩（H.264 + AAC）
ffmpeg -i in.mov -c:v libx264 -crf 23 -c:a aac -b:a 128k out.mp4

# 2. 调整分辨率到 720p
ffmpeg -i in.mp4 -vf scale=-2:720 -c:v libx264 -crf 23 out.mp4

# 3. 视频变速（2 倍速，音视频同步）
ffmpeg -i in.mp4 -filter_complex "[0:v]setpts=0.5*PTS[v];[0:a]atempo=2.0[a]" -map "[v]" -map "[a]" out.mp4

# 4. 转为 GIF（限制尺寸与时长）
ffmpeg -i in.mp4 -vf "fps=15,scale=480:-1:flags=lanczos" -t 5 out.gif

# 5. 合并音视频
ffmpeg -i video.mp4 -i audio.m4a -c copy -map 0:v:0 -map 1:a:0 merged.mp4

# 6. 旋转手机竖屏视频
ffmpeg -i in.mp4 -vf "transpose=1" out.mp4

# 7. 提取音频为 MP3
ffmpeg -i in.mp4 -vn -c:a libmp3lame -b:a 192k out.mp3

# 8. 批量转码（Bash 示例）
for f in *.mov; do ffmpeg -i "$f" "${f%.mov}.mp4"; done
```

---

## 十一、学习资源

- 官方文档：https://ffmpeg.org/documentation.html
- 滤镜完整列表：`ffmpeg -filters`
- 编码器列表：`ffmpeg -encoders`
- 格式支持：`ffmpeg -formats`
- 社区 Wiki：https://trac.ffmpeg.org/wiki
