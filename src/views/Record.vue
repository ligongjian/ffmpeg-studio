<script setup lang="ts">
import { reactive, computed, ref, onMounted, onUnmounted, watch } from "vue";
import {
  store,
  showToast,
  listDisplays,
  listDevices,
  pickRecordDir,
  startRecording,
  stopRecording,
} from "../store";
import {
  buildRecordCommand,
  type RecordMode,
  type RecordOpts,
  primaryDisplay,
  splitDevices,
} from "../lib/recording";
import CommandCard from "../components/CommandCard.vue";
import SegGroup from "../components/SegGroup.vue";

// ===== 状态 =====
type AudioSource = "system" | "mic" | "none";

const s = reactive<{
  mode: RecordMode;
  displayIdx: number;
  cameraDevice: string;
  audioSource: AudioSource;
  audioDevice: string;
  resolution: string;
  fps: number;
  vEnc: "libx264" | "libx265rgb";
  vBitrateMbps: number;
  fmt: "mkv" | "mp4" | "mov";
  camScalePct: number;
  outDir: string;
  countdown: number;
}>({
  mode: "screen",
  displayIdx: 0,
  cameraDevice: "",
  audioSource: "mic",
  audioDevice: "",
  resolution: "1920x1080",
  fps: 30,
  vEnc: "libx264",
  vBitrateMbps: 8,
  fmt: "mkv",
  camScalePct: 25,
  outDir: "",
  countdown: 3,
});

interface Display {
  x: number;
  y: number;
  width: number;
  height: number;
  normalizedX: number;
  index: number;
}
interface Device {
  kind: "video" | "audio";
  name: string;
  identifier: string;
}

const displays = reactive<Display[]>([]);
const cameras = reactive<Device[]>([]);
const mics = reactive<Device[]>([]);
const enumerating = reactive({ displays: false, devices: false });
const enumErr = reactive({ displays: "", devices: "" });

// ===== 设备枚举（挂载时拉一次）=====
async function refreshDisplays() {
  enumerating.displays = true;
  enumErr.displays = "";
  try {
    const list = await listDisplays();
    displays.splice(0, displays.length, ...list);
    if (!list.length) enumErr.displays = "未检测到显示器（需要 Windows 10+ 与 gdigrab 支持）";
  } catch (e) {
    enumErr.displays = typeof e === "string" ? e : "枚举显示器失败";
  } finally {
    enumerating.displays = false;
  }
}

async function refreshDevices() {
  enumerating.devices = true;
  enumErr.devices = "";
  try {
    const list = await listDevices();
    const { video, audio } = splitDevices(list);
    cameras.splice(0, cameras.length, ...video);
    mics.splice(0, mics.length, ...audio);
    if (!video.length && !audio.length) {
      enumErr.devices = "未检测到 DShow 设备（ffmpeg 需编译 --enable-dshow）";
    }
  } catch (e) {
    enumErr.devices = typeof e === "string" ? e : "枚举设备失败";
  } finally {
    enumerating.devices = false;
  }
}

onMounted(() => {
  refreshDisplays();
  refreshDevices();
});

// 默认选中主屏
watch(
  () => displays.length,
  () => {
    if (displays.length && !displays[s.displayIdx]) s.displayIdx = 0;
    const p = primaryDisplay(displays);
    if (p) {
      const i = displays.indexOf(p);
      if (i >= 0) s.displayIdx = i;
    }
  },
  { immediate: true },
);

// 默认选中第一个摄像头/麦克风
watch(
  () => cameras.length,
  () => {
    if (cameras.length && !cameras.find((c) => c.identifier === s.cameraDevice)) {
      s.cameraDevice = cameras[0].identifier;
    }
  },
  { immediate: true },
);
watch(
  () => mics.length,
  () => {
    if (mics.length && !mics.find((m) => m.identifier === s.audioDevice)) {
      s.audioDevice = mics[0].identifier;
    }
  },
  { immediate: true },
);

// ===== 输出目录 =====
const outDirDisplay = computed(() => s.outDir || "未选择目录（录制前必须选择）");
async function pickDir() {
  const p = await pickRecordDir();
  if (p) s.outDir = p;
}

// ===== 命令预览 =====
/** 生成 `YYYYMMDD_HHMMSS` 本地时间戳字符串。真实录制时用，预览时也用（每次进页面/手动刷新） */
function makeTs(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(
    d.getHours()
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** 预览用时间戳：秒级轮询刷新一次，让命令预览里的文件名看起来"活"的（避免一眼看死的时间） */
const previewTs = ref(makeTs());
let previewTsTimer: number | undefined;
watch(
  () => store.tab,
  (tab) => {
    if (tab === "record") previewTs.value = makeTs();
  },
  { immediate: true },
);
onMounted(() => {
  previewTsTimer = window.setInterval(() => {
    if (!store.recording) previewTs.value = makeTs();
  }, 1000);
});
onUnmounted(() => {
  if (previewTsTimer) {
    window.clearInterval(previewTsTimer);
    previewTsTimer = undefined;
  }
});

const cmd = computed(() => {
  const opts: RecordOpts = {
    mode: s.mode,
    displayX: displays[s.displayIdx]?.x ?? 0,
    displayY: displays[s.displayIdx]?.y ?? 0,
    cameraDevice: s.cameraDevice,
    audioSource: s.audioSource,
    audioDevice: s.audioDevice,
    resolution: s.resolution,
    fps: s.fps,
    vEnc: s.vEnc,
    vBitrateMbps: s.vBitrateMbps,
    fmt: s.fmt,
    camScalePct: s.camScalePct,
    outName: `record_${previewTs.value}.${s.fmt}`,
  };
  return buildRecordCommand(opts);
});

const outputName = computed(() => `record_${previewTs.value}.${s.fmt}`);

// ===== 倒计时 =====
let countdownTimer: number | undefined;
const countingDown = computed(() => store.recording === false && s.countdown > 0);

function clearCountdown() {
  if (countdownTimer) window.clearTimeout(countdownTimer);
  countdownTimer = undefined;
}

// ===== 启动录制 =====
function start() {
  if (store.recording) return;
  if (!s.outDir) {
    showToast("请先选择录制输出目录", "error");
    return;
  }
  // 摄像头模式必须有摄像头
  if (s.mode === "cam" && !s.cameraDevice) {
    showToast("未检测到摄像头设备", "error");
    return;
  }
  if (s.mode === "both" && !s.cameraDevice) {
    showToast("画中画需要摄像头设备，但当前未检测到", "error");
    return;
  }
  // 麦克风模式必须有麦克风
  if (s.audioSource === "mic" && !s.audioDevice) {
    showToast("未检测到麦克风设备", "error");
    return;
  }
  // 系统音频模式：Windows 下 gdigrab 无法直接录系统音频
  if (s.audioSource === "system") {
    showToast(
      "屏幕录制 + 系统音频需要虚拟音频线（如 VB-Cable / Stereo Mix）。当前请选择「麦克风」或「无声」",
      "error",
    );
    return;
  }
  // 倒计时开始
  s.countdown = s.countdown > 0 ? Math.min(s.countdown, 3) : 0;
  runCountdown();
}

function runCountdown() {
  clearCountdown();
  if (s.countdown <= 0) {
    doStart();
    return;
  }
  countdownTimer = window.setTimeout(() => {
    s.countdown--;
    if (s.countdown <= 0) {
      doStart();
    } else {
      runCountdown();
    }
  }, 1000);
}

async function doStart() {
  // 倒计时结束后立即开录——此时生成的时间戳才是真实的开始时刻
  const realTs = makeTs();
  const opts: RecordOpts = {
    mode: s.mode,
    displayX: displays[s.displayIdx]?.x ?? 0,
    displayY: displays[s.displayIdx]?.y ?? 0,
    cameraDevice: s.cameraDevice,
    audioSource: s.audioSource,
    audioDevice: s.audioDevice,
    resolution: s.resolution,
    fps: s.fps,
    vEnc: s.vEnc,
    vBitrateMbps: s.vBitrateMbps,
    fmt: s.fmt,
    camScalePct: s.camScalePct,
    outName: `record_${realTs}.${s.fmt}`,
  };
  await startRecording(buildRecordCommand(opts), s.outDir);
}

onUnmounted(() => {
  clearCountdown();
});

// ===== 录制中状态展示 =====
const elapsedDisplay = computed(() => {
  const s = Math.floor(store.recordElapsed);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
});

// 录制中的本地秒级计时器：后端事件不会秒推，前端自己走表，
// 用后端最新推送的 elapsed 校准一次。
let localTimer: number | undefined;
watch(
  () => store.recording,
  (recording) => {
    clearLocalTimer();
    if (recording) {
      localTimer = window.setInterval(() => {
        store.recordElapsed = store.recordElapsed + 1;
      }, 1000);
    }
  },
  { immediate: true },
);
function clearLocalTimer() {
  if (localTimer) {
    window.clearInterval(localTimer);
    localTimer = undefined;
  }
}
onUnmounted(clearLocalTimer);

async function stop() {
  await stopRecording();
}

const modeLabel = computed(() => {
  if (s.mode === "screen") return "屏幕";
  if (s.mode === "cam") return "摄像头";
  return "画中画";
});

const selectedDisplay = computed(() => displays[s.displayIdx]);
const selectedCamera = computed(() => cameras.find((c) => c.identifier === s.cameraDevice));
const selectedMic = computed(() => mics.find((m) => m.identifier === s.audioDevice));

// ===== 录制结束后的提示 =====
const finishedInfo = computed(() => {
  if (store.recording) return null;
  if (!store.recordState) return null;
  if (store.recordState === "done") return { type: "ok" as const, msg: `录制完成：${store.recordOutput}` };
  if (store.recordState === "failed") return { type: "err" as const, msg: `录制失败：${store.recordNote || "ffmpeg 异常退出"}` };
  if (store.recordState === "canceled") return { type: "warn" as const, msg: "录制已取消" };
  return null;
});

const canStart = computed(
  () => !store.recording && !!s.outDir && (s.mode !== "cam" && s.mode !== "both" || !!s.cameraDevice)
);
</script>

<template>
  <div class="space-y-6">
    <!-- 录制中状态条：置顶醒目，避免用户在录着录着被别的设置分散注意力 -->
    <div
      v-if="store.recording"
      class="card rounded-2xl p-5 border-red-500/40 bg-red-500/5 flex items-center gap-4"
    >
      <span class="relative flex h-3 w-3">
        <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
        <span class="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
      </span>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-semibold flex items-center gap-2">
          <span class="text-red-400">正在录制</span>
          <span class="text-muted text-xs">· {{ modeLabel }}</span>
        </div>
        <div class="text-xs text-muted mt-0.5 truncate">
          已录制 <span class="font-mono text-brand">{{ elapsedDisplay }}</span>
          <span v-if="store.recordOutput"> · 输出 {{ store.recordOutput }}</span>
        </div>
      </div>
      <button
        class="px-5 py-2.5 rounded-lg bg-red-500 text-white font-bold hover:bg-red-600 transition-colors cursor-pointer flex items-center gap-2"
        @click="stop()"
      >
        <span class="w-2.5 h-2.5 rounded-sm bg-white"></span>停止录制
      </button>
    </div>

    <!-- 倒计时遮罩 -->
    <div
      v-else-if="countingDown"
      class="card rounded-2xl p-5 border-brand/40 bg-brand/5 flex items-center gap-4"
    >
      <div class="flex-1">
        <div class="text-sm font-semibold text-brand">准备开始</div>
        <div class="text-xs text-muted mt-0.5">
          倒计时 <span class="font-mono text-lg">{{ s.countdown }}</span> 秒后开始录制（{{ modeLabel }}）
        </div>
      </div>
      <button
        class="px-4 py-2 rounded-lg border border-panel2 text-sm hover:border-brand cursor-pointer"
        @click="clearCountdown()"
      >取消</button>
    </div>

    <!-- 录制结束提示 -->
    <div
      v-else-if="finishedInfo"
      class="card rounded-2xl p-4 flex items-center gap-3"
      :class="{
        'border-emerald-500/40 bg-emerald-500/5': finishedInfo.type === 'ok',
        'border-red-500/40 bg-red-500/5': finishedInfo.type === 'err',
        'border-amber-500/40 bg-amber-500/5': finishedInfo.type === 'warn',
      }"
    >
      <span
        class="w-2 h-2 rounded-full"
        :class="{
          'bg-emerald-500': finishedInfo.type === 'ok',
          'bg-red-500': finishedInfo.type === 'err',
          'bg-amber-500': finishedInfo.type === 'warn',
        }"
      ></span>
      <span class="text-sm">{{ finishedInfo.msg }}</span>
    </div>

    <!-- 命令预览：录制期间禁用入队按钮（录制不进队列） -->
    <CommandCard
      v-if="!store.recording"
      title="录制采集 · 命令预览"
      :command="cmd"
      task-name="录制采集"
    >
      <template #actions>
        <div class="flex items-center gap-2 mt-3">
          <button
            class="flex-1 py-2.5 rounded-lg bg-brand text-white font-bold hover:bg-brandd transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            :disabled="!canStart"
            @click="start()"
          >
            <span class="w-2.5 h-2.5 rounded-full bg-ink inline-block mr-2 align-middle"></span>
            开始录制
          </button>
          <button
            class="px-4 py-2.5 rounded-lg border border-panel2 text-sm hover:border-brand cursor-pointer"
            @click="s.countdown = s.countdown >= 10 ? 0 : s.countdown + 3"
            :title="`当前倒计时 ${s.countdown} 秒，点击在 0/3/6/9/10 之间切换`"
          >
            倒计时 {{ s.countdown }}s
          </button>
        </div>
      </template>
    </CommandCard>

    <!-- 配置卡 -->
    <div class="card rounded-2xl p-5 space-y-5">
      <!-- 录制模式 -->
      <div>
        <label class="text-sm font-semibold mb-2 block">录制模式</label>
        <SegGroup
          :model-value="s.mode"
          :options="[
            { value: 'screen', label: '屏幕录制' },
            { value: 'cam', label: '摄像头' },
            { value: 'both', label: '画中画' },
          ]"
          @update:model-value="s.mode = $event as RecordMode"
        />
      </div>

      <!-- 屏幕源（屏幕/画中画模式下显示） -->
      <div v-if="s.mode !== 'cam'" class="grid md:grid-cols-2 gap-4">
        <div>
          <label class="text-xs text-muted">显示器</label>
          <select
            v-if="displays.length"
            v-model.number="s.displayIdx"
            class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none"
          >
            <option v-for="(d, i) in displays" :key="i" :value="i">
              显示器 {{ d.index }} ({{ d.width }}×{{ d.height }}) @ ({{ d.x }}, {{ d.y }})
            </option>
          </select>
          <div v-else-if="enumerating.displays" class="text-xs text-muted mt-1">枚举中…</div>
          <div v-else class="text-xs text-amber-500 mt-1">{{ enumErr.displays || "未检测到显示器" }}</div>
        </div>
        <div>
          <label class="text-xs text-muted">分辨率（-video_size）</label>
          <select v-model="s.resolution" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none">
            <option value="">跟随源</option>
            <option value="3840x2160">3840×2160 (4K)</option>
            <option value="2560x1440">2560×1440 (2K)</option>
            <option value="1920x1080">1920×1080 (1080p)</option>
            <option value="1280x720">1280×720 (720p)</option>
          </select>
        </div>
      </div>

      <!-- 摄像头源（摄像头/画中画模式下显示） -->
      <div v-if="s.mode !== 'screen'" class="grid md:grid-cols-2 gap-4">
        <div>
          <label class="text-xs text-muted">摄像头</label>
          <select
            v-if="cameras.length"
            v-model="s.cameraDevice"
            class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none"
          >
            <option v-for="c in cameras" :key="c.identifier" :value="c.identifier">{{ c.name }}</option>
          </select>
          <div v-else-if="enumerating.devices" class="text-xs text-muted mt-1">枚举中…</div>
          <div v-else class="text-xs text-amber-500 mt-1">{{ enumErr.devices || "未检测到摄像头" }}</div>
        </div>
        <!-- 画中画时摄像头画面大小 -->
        <div v-if="s.mode === 'both'">
          <label class="text-xs text-muted">摄像头画面大小（占主画面 {{ s.camScalePct }}%）</label>
          <input
            v-model.number="s.camScalePct"
            type="range"
            min="10"
            max="60"
            step="5"
            class="w-full mt-2"
          />
        </div>
      </div>

      <!-- 音频源 -->
      <div class="grid md:grid-cols-2 gap-4">
        <div>
          <label class="text-xs text-muted">音频源</label>
          <select v-model="s.audioSource" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none">
            <option value="mic">麦克风</option>
            <option value="system">系统音频（屏幕录制）</option>
            <option value="none">无声</option>
          </select>
          <p v-if="s.audioSource === 'system'" class="text-[11px] text-amber-500 mt-1">
            系统音频需要虚拟音频线（VB-Cable / Stereo Mix），普通麦克风无法捕获
          </p>
        </div>
        <div v-if="s.audioSource === 'mic'">
          <label class="text-xs text-muted">麦克风</label>
          <select
            v-if="mics.length"
            v-model="s.audioDevice"
            class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none"
          >
            <option v-for="m in mics" :key="m.identifier" :value="m.identifier">{{ m.name }}</option>
          </select>
          <div v-else class="text-xs text-amber-500 mt-1">未检测到麦克风</div>
        </div>
      </div>

      <!-- 编码设置 -->
      <div class="grid md:grid-cols-3 gap-4">
        <div>
          <label class="text-xs text-muted">帧率</label>
          <select v-model.number="s.fps" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none">
            <option :value="24">24 fps</option>
            <option :value="30">30 fps</option>
            <option :value="60">60 fps</option>
          </select>
        </div>
        <div>
          <label class="text-xs text-muted">视频编码器</label>
          <select v-model="s.vEnc" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none">
            <option value="libx264">H.264 (兼容性优先)</option>
            <option value="libx265rgb">H.265 (更省空间，解码更慢)</option>
          </select>
        </div>
        <div>
          <label class="text-xs text-muted">码率 (Mbps)</label>
          <input v-model.number="s.vBitrateMbps" type="number" min="1" max="80" step="1" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none" />
        </div>
        <div>
          <label class="text-xs text-muted">输出容器</label>
          <select v-model="s.fmt" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none">
            <option value="mkv">MKV (推荐，异常可恢复)</option>
            <option value="mp4">MP4 (兼容性好，异常可能损坏)</option>
            <option value="mov">MOV</option>
          </select>
        </div>
        <div class="md:col-span-2">
          <label class="text-xs text-muted">输出目录</label>
          <div class="mt-1 flex items-center gap-2">
            <input
              :value="outDirDisplay"
              readonly
              class="flex-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm font-mono outline-none"
            />
            <button class="px-3 py-2 rounded-lg border border-panel2 text-sm hover:border-brand cursor-pointer shrink-0" @click="pickDir()">
              选择…
            </button>
          </div>
        </div>
      </div>

      <!-- 输出文件名预览 -->
      <div class="text-xs text-muted">
        输出文件名：<span class="text-brand font-mono">{{ outputName }}</span>
        <span class="ml-2">（实际录制开始时刻生成）</span>
      </div>

      <!-- 重新枚举设备按钮 -->
      <div class="flex items-center gap-2 pt-2 border-t border-panel2">
        <button
          class="px-3 py-1.5 rounded-lg border border-panel2 text-xs hover:border-brand cursor-pointer"
          :disabled="enumerating.displays"
          @click="refreshDisplays()"
        >
          {{ enumerating.displays ? "刷新中…" : "刷新显示器" }}
        </button>
        <button
          class="px-3 py-1.5 rounded-lg border border-panel2 text-xs hover:border-brand cursor-pointer"
          :disabled="enumerating.devices"
          @click="refreshDevices()"
        >
          {{ enumerating.devices ? "刷新中…" : "刷新设备" }}
        </button>
        <span class="text-[11px] text-muted ml-auto">
          录制不进任务队列：全局同时只能有一段录制，停止时走优雅收尾以保全容器完整性
        </span>
      </div>
    </div>
  </div>
</template>
