# FFmpeg Studio 功能路线图

基于本机 ffmpeg 7.1 实测能力盘点。状态标记：**已完成** / **部分完成** / **未开始**。

---

## 一、进度概览

| 分档 | 已完成 | 部分完成 | 未开始 |
|---|---|---|---|
| A 档 · 小改动高回报 | 1 | 1 | 4 |
| B 档 · 新开模块 | 0 | 0 | 3 |
| C 档 · 进阶 | 0 | 0 | 7 |
| 前置基础设施 | 0 | 0 | 1 |

---

## 二、已交付模块

15 个模块覆盖音视频处理主干链路：

| 模块 | 能力 |
|---|---|
| 工作台 | 统计总览、源文件拖放、快速开始入口 |
| 格式转换 | 容器互转、编码选择、硬件加速 |
| 压缩优化 | CRF、预设、码率、分辨率、硬件加速 |
| 剪辑分割 | 时间轴精确截取 |
| 拼接合并 | 多文件顺序合并 |
| 提取分离 | 音视频流、帧、缩略图 |
| 水印字幕 | 图片 / 文字 / 硬字幕 |
| 滤镜调色 | 缩放、裁剪、旋转、调色、锐化、降噪、去隔行、淡入淡出 |
| 音频处理 | 转码、音量、淡入淡出、响度归一、去静音、拼接 |
| 动图 GIF | 调色板两步法 |
| 媒体信息 | ffprobe 全字段表格展示、双文件对比 |
| 录制采集 | 屏幕、摄像头、画中画 |
| 流媒体 | RTMP / HLS 推拉流 |
| 批量处理 | 目录级批处理 |
| 任务队列 | 并发管理、状态与历史 |

已启用的滤镜：

- 视频：`scale` `crop` `transpose` `eq` `hqdn3d` `unsharp` `fade` `yadif` `overlay`
  `drawtext` `subtitles` `fps` `split` `palettegen` `paletteuse` `trim` `select`
- 音频：`volume` `loudnorm` `silenceremove` `afade` `concat`

---

## 三、能力基础（实测结论）

用 `ffmpeg -h filter=<name>` 逐个探测，以下滤镜在本机 ffmpeg 7.1 **全部可用**：

`xfade` `xstack` `delogo` `chromakey` `vidstabdetect` `vidstabtransform` `deshake`
`afftdn` `anlmdn` `nlmeans` `showwaves` `showspectrum` `avectorscope` `tonemap`
`zscale` `crop` `pad` `setpts` `atempo` `reverse` `tile` `thumbnail` `amix` `loudnorm`

（`vidstab` 可用说明构建时启用了 `--enable-libvidstab`。）

硬件编码器三类齐全：

- NVIDIA：`h264_nvenc` `hevc_nvenc` `av1_nvenc`
- Intel：`h264_qsv` `hevc_qsv` `vp9_qsv` `mjpeg_qsv` `mpeg2_qsv`
- AMD：`h264_amf` `hevc_amf` `av1_amf`

结论：**可拓展空间来自 ffmpeg 自身能力未被使用，而非工具受限。**

---

## 四、A 档 · 小改动，高回报

### 变速 `setpts` + `atempo`　`未开始`

音视频同步变速，短视频场景刚需。

- 视频 `setpts=PTS/<倍数>`，音频 `atempo=<倍数>`
- **坑**：`atempo` 单段只支持 `0.5`–`2.0`。4 倍速需串联 `atempo=2.0,atempo=2.0`；
  低于 0.5 同理。超出范围直接报错，不能靠单参数硬填

### 画面裁剪 `crop`　`已完成`

滤镜页已提供开关 + 宽 / 高 / X 偏移 / Y 偏移四项参数。

### 比例适配与加边 `scale` + `pad`　`未开始`

横片转 9:16 等场景的适配策略，目前只能靠裁剪或缩放，缺加边：

- 裁切填满：`crop` 后 `scale` —— 丢画面边缘
- 等比加边：`scale` 后 `pad` —— 保留全画面，带黑边
- 指定区域：复用已有的 `crop`

### 转场拼接 `xfade`　`未开始`

拼接合并目前是硬接。

- **坑**：所有片段的分辨率、帧率、像素格式必须一致，否则需先统一
- **坑**：`offset` 不是片段起点，需逐段减去转场时长的累计值

### 音频降噪 `afftdn`　`已完成`

音频页「音频处理」模式新增降噪区块，两种算法可选：

- `afftdn`（FFT 谱减）：暴露 `nr` 降噪强度、`nf` 噪声底、`nt` 噪声类型（white/vinyl/shellac）、`tn` 噪声追踪
- `anlmdn`（非局部均值）：暴露 `s` 强度与 `m` 平滑因子，**速度远慢于实时**，界面已标注只适合短音频

降噪滤镜排在 `-af` 最前（先净化再增益，避免底噪被 `volume` / `loudnorm` 放大）。
滤镜片段由 `src/lib/ffmpeg.ts` 的 `buildDenoise()` 单点生成，页面下方显示的就是真正进命令的字符串。

### 硬件加速铺开到全部重编码路径　`已完成`

| 页面 | 状态 |
|---|---|
| 格式转换 | 已支持 |
| 压缩优化 | 已支持 |
| 剪辑分割 | 已支持（重编码模式；快剪 `-c copy` 时不适用） |
| 拼接合并 | 已支持（滤镜拼接；流拼接 `-c copy` 时不适用） |
| 水印字幕 | 已支持（三个 tab 都重编码） |
| 滤镜调色 | 已支持（开启任一视频滤镜时） |
| 提取分离 | 已支持（抽取视频 + 重编码） |
| 批量处理 | 已支持（批量转换 / 批量压缩） |
| 流媒体 | 已支持（推流 / 拉流转码，码率控制模式） |
| 动图 GIF / 音频处理 | 不适用（GIF 编码器 / 纯音频） |

收敛方式：

- 统一走 `src/lib/ffmpeg.ts` 的 `videoEnc()`，该函数处理编码器差异：NVENC / AMF 用 `-cq`，QSV 用 `-global_quality`
- 直播 / 采集这类必须码率可控的场景走 `videoEncBitrate()`：`-b:v` 而非 `-cq`
- UI 统一用 `src/components/HwAccelSelect.vue`，不再各页手抄编码器清单

**坑**：WebM 容器只装得下 VP8 / VP9 / AV1，硬件 H.264/HEVC 编码器写进去会失败；
目标容器是 WebM（或 GIF / 纯音频）时，下拉会禁用并说明原因。

---

## 五、B 档 · 值得新开模块

### 视频防抖 `vidstabdetect` + `vidstabtransform`　`未开始`

手持抖动修复。

- **两段式**：先 `vidstabdetect` 生成 `.trf` 变换文件，再 `vidstabtransform` 应用
- **依赖**：需要临时文件中转，任务系统要支持多步串联执行

### 水印消除 `delogo`　`已完成`

水印页新增「消除水印」tab：预览框内拖拽框选（空白处拖 = 画框，框内拖 = 移动），
四角吸附按钮，坐标可直接填像素；`show=1` 开关让 ffmpeg 先画绿框确认位置。

- 命令：`-vf "delogo=x=…:y=…:w=…:h=…[:show=1]"`，音频仍 `-c:a copy`
- **坑**：矩形超出画面 ffmpeg 直接失败（`Logo area is outside of the frame`）——
  界面按探测到的源分辨率（`inputInfo.videoWidth/videoHeight`）校验并给出警告，
  拖拽时也把坐标夹在画面内
- **局限**：一次只能消一个矩形；多处水印需对产物再处理一次（delogo 可串联，但 UI 未做多框）
- **未做**：真实帧画面上的框选 → 见「六、前置基础设施」（需要后端抽帧 + asset 协议）

### 多画面与画中画 `xstack` + `overlay`　`未开始`

网格拼接、分屏对比、画中画。

---

## 六、前置基础设施

### 视频帧预览与坐标选取　`未开始`

`delogo`（框选水印区域）、裁剪取景、水印拖拽定位都需要它，目前只能手填数字。
做一次，多个功能受益。

实现要点：后端抽帧输出 JPEG，前端以源视频分辨率映射点击坐标，
再把 CSS 坐标换算回原始像素坐标写入滤镜参数。

---

## 七、C 档 · 进阶，有明确场景再做

| 功能 | 实现 | 状态 | 说明 |
|---|---|---|---|
| HDR 转 SDR | `zscale` + `tonemap` | 未开始 | HDR 片源直转会发灰 |
| 绿幕抠像 | `chromakey` | 未开始 | 需配合背景替换 |
| 压到指定体积 | 两遍编码 | 未开始 | CRF 单遍无法保证体积上限 |
| 倒放 | `reverse` | 未开始 | 长视频内存开销大 |
| 音频可视化 | `showwaves` / `showspectrum` | 未开始 | 播客、音乐号的成品需求 |
| 图片序列与视频互转 | `-i img%04d.png` | 未开始 | 延时摄影 |
| 缩略图拼图 | `tile` | 未开始 | 预览图 / 雪碧图 |

---

## 八、明确的边界

以下不属于 ffmpeg 的能力范围，不在本路线图内：

- 自动字幕、语音识别 —— 需要 ASR 模型
- 人声分离、音乐提取 —— 需要源分离模型
- 超分辨率、画质增强 —— 需要推理模型
- 多轨时间轴非线性编辑 —— 需要预览引擎与轨道模型，不是命令行工具的职责

---

## 九、新增模块的落地路径

项目已收敛的约定，新增功能时照此执行：

1. **入口**：在 `src/nav.ts` 的 `NAV` 追加一项即可，侧栏、顶栏标题、
   工作台快速开始三处自动派生，无需分别修改
2. **命令构建**：新增 `buildXxx()` 到 `src/lib/ffmpeg.ts`；编码器统一走 `videoEnc()`
   以自动获得硬件加速能力
3. **输入选择**：直接读 `store.inputFile`，不维护本地副本
4. **拖拽**：用 `getCurrentWebview().onDragDropEvent`（Tauri 在 webview 层拦截系统拖拽，
   DOM 的 `@drop` 取不到真实路径），`onUnmounted` 时解绑
5. **滤镜参数转义**：Windows 路径经 `filterPath()`，文本经 `filterText()`；
   `drawtext` 必须带 `expansion=none`，否则 `%{...}` 会被静默展开成空白

---

## 十、已知技术债

- **动图 GIF 页（已修复）**：源时长现在实时展示（含探测中/未知占位）；不限时长或长片段
  会给出体积上限估算与告警（>30MB 或整段处理）；已暴露 `palettegen` 的 `max_colors`
  （2~256）与 `paletteuse` 的 `dither`（none/bayer/floyd_steinberg/sierra2/sierra2_4a/
  sierra3/burkes/atkinson/heckbert，默认 sierra2_4a）。
- **窗口底色（已修复）**：`src-tauri/tauri.conf.json` 的 `backgroundColor` 由 `#ffffff`
  改为 `#0f172a`，消除暗色启动时的白闪（亮色启动会有一帧极短的暗→亮，可接受；
  改配置需重编译 `tauri dev` / `cargo build` 生效）。
