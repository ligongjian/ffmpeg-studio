<script setup lang="ts">
import { reactive, computed, watch, ref, onMounted, onUnmounted } from "vue";
import { store, pickInput, probeInput, inputCwd, setInputFile } from "../store";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { buildFilters, type FiltersOpts } from "../lib/ffmpeg";
import { baseName } from "../lib/format";
import CommandCard from "../components/CommandCard.vue";

const s = reactive<{
  fmt: string;
  vEnc: string;
  crf: number;
  audioMode: FiltersOpts["audioMode"];
  loudnormI: number;
  scaleOn: boolean; scaleW: number; scaleH: number;
  cropOn: boolean; cropW: number; cropH: number; cropX: number; cropY: number;
  rotateOn: boolean; rotateDir: number;
  eqOn: boolean; eqBrightness: number; eqContrast: number; eqSaturation: number; eqGamma: number;
  denoiseOn: boolean;
  sharpenOn: boolean; sharpenLuma: number; sharpenThresh: number;
  fadeOn: boolean; fadeIn: boolean; fadeOut: boolean; fadeDur: number; fadeOutStart: number;
  deintOn: boolean;
  volumeOn: boolean; volumeGain: number;
  customVf: string;
  customAf: string;
}>( {
  fmt: "mp4",
  vEnc: "libx264",
  crf: 23,
  audioMode: "copy",
  loudnormI: -16,
  scaleOn: false, scaleW: 1280, scaleH: 720,
  cropOn: false, cropW: 1000, cropH: 600, cropX: 140, cropY: 60,
  rotateOn: false, rotateDir: 1,
  eqOn: false, eqBrightness: 0, eqContrast: 1, eqSaturation: 1, eqGamma: 1,
  denoiseOn: false,
  sharpenOn: false, sharpenLuma: 1.0, sharpenThresh: 0,
  fadeOn: false, fadeIn: true, fadeOut: true, fadeDur: 1, fadeOutStart: 0,
  deintOn: false,
  volumeOn: false, volumeGain: 1,
  customVf: "",
  customAf: "",
});

// 输出容器复用「设置里的默认容器」（store.fmt），进入页面或改设置时同步
watch(
  () => store.fmt,
  (v) => { if (v) s.fmt = v; },
  { immediate: true },
);

// 源文件直接复用全局 store.inputFile（工作台 / 其它页选择的文件），无任何本地副本，保证始终同步
const inputName = computed(() => store.inputFile || "input.mp4");

// 拖放区：Tauri 在 webview 层拦截系统文件拖拽，只能经由 onDragDropEvent 拿真实路径
const zone = ref<HTMLElement | null>(null);
const dragOver = ref(false);
let unlisten: (() => void) | null = null;

function inZone(el: HTMLElement | null, pos: { x: number; y: number }): boolean {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const x = pos.x / dpr;
  const y = pos.y / dpr;
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

onMounted(async () => {
  unlisten = await getCurrentWebview().onDragDropEvent((event) => {
    const p = event.payload;
    if (p.type === "enter" || p.type === "over") {
      dragOver.value = inZone(zone.value, p.position);
    } else if (p.type === "drop") {
      dragOver.value = false;
      if (inZone(zone.value, p.position) && p.paths.length) setInputFile(p.paths[0]);
    } else {
      dragOver.value = false;
    }
  });
});

onUnmounted(() => {
  unlisten?.();
  unlisten = null;
});

// 秒 → m:ss，用于显示已选文件时长
function formatDur(d: number): string {
  if (!d) return "";
  const m = Math.floor(d / 60);
  const x = Math.round(d % 60);
  return `${m}:${String(x).padStart(2, "0")}`;
}

// 输出文件名预览
const outputName = computed(() => {
  const base = baseName(inputName.value).replace(/\.[^./\\]+$/, "") || "output";
  const srcExt = (inputName.value.match(/\.[^./\\]+$/) || [""])[0].toLowerCase().replace(".", "");
  return srcExt === s.fmt ? `${base}.filtered.${s.fmt}` : `${base}.${s.fmt}`;
});

const cmd = computed(() =>
  buildFilters({
    input: inputName.value,
    fmt: s.fmt,
    vEnc: s.vEnc,
    crf: s.crf,
    audioMode: s.audioMode,
    loudnormI: s.loudnormI,
    scaleOn: s.scaleOn, scaleW: s.scaleW, scaleH: s.scaleH,
    cropOn: s.cropOn, cropW: s.cropW, cropH: s.cropH, cropX: s.cropX, cropY: s.cropY,
    rotateOn: s.rotateOn, rotateDir: s.rotateDir,
    eqOn: s.eqOn, eqBrightness: s.eqBrightness, eqContrast: s.eqContrast, eqSaturation: s.eqSaturation, eqGamma: s.eqGamma,
    denoiseOn: s.denoiseOn,
    sharpenOn: s.sharpenOn, sharpenLuma: s.sharpenLuma, sharpenThresh: s.sharpenThresh,
    fadeOn: s.fadeOn, fadeIn: s.fadeIn, fadeOut: s.fadeOut, fadeDur: s.fadeDur, fadeOutStart: s.fadeOutStart,
    deintOn: s.deintOn,
    volumeOn: s.volumeOn, volumeGain: s.volumeGain,
    customVf: s.customVf,
    customAf: s.customAf,
  }),
);

function pick() {
  pickInput();
}
</script>

<template>
  <div class="space-y-6">
    <CommandCard title="滤镜调色 · 命令预览" :command="cmd" task-name="滤镜调色" :cwd="inputCwd()" />

    <div class="card rounded-2xl p-5 space-y-5">
      <!-- 源文件（直接复用全局 store.inputFile，与工作台 / 其它页共享同一份源） -->
      <div>
        <label class="text-sm font-semibold mb-2 block">输入选择（源视频）</label>
        <div
          ref="zone"
          class="rounded-xl border-2 border-dashed px-4 py-6 text-sm flex flex-col items-center justify-center gap-2 cursor-pointer transition-all"
          :class="dragOver ? 'border-brand bg-brand/10 shadow-glow' : 'border-panel2 bg-ink/40 hover:border-brand hover:bg-brand/5 hover:shadow-glow'"
          @click="pick()"
        >
          <template v-if="store.inputFile">
            <div class="font-medium truncate max-w-full">{{ store.inputFile.split(/[\\/]/).pop() }}</div>
            <div v-if="store.inputInfo" class="text-[11px] text-muted">
              <template v-if="store.inputInfo.videoWidth"> {{ store.inputInfo.videoWidth }}×{{ store.inputInfo.videoHeight }} · </template>
              <template v-if="store.inputInfo.duration">时长 {{ formatDur(store.inputInfo.duration) }}</template>
              <template v-if="store.inputInfo.size"> · {{ (store.inputInfo.size / 1048576).toFixed(1) }} MB</template>
            </div>
            <span class="text-brand text-xs">重新选择 / 拖拽替换</span>
          </template>
          <template v-else>
            <div class="font-medium">点击或拖拽选择视频文件</div>
            <div class="text-[11px] text-muted">复用工作台已选择的文件，或直接拖入</div>
          </template>
        </div>
      </div>

      <div class="text-xs text-muted">输出文件：<span class="text-brand font-mono">{{ outputName }}</span></div>

      <!-- 视频滤镜 -->
      <div class="space-y-4">
        <h3 class="font-semibold text-sm flex items-center gap-2">
          视频滤镜
          <span class="text-[11px] font-normal text-muted">（可叠加）</span>
        </h3>

        <!-- 缩放 -->
        <div class="rounded-xl border border-panel2 p-3 space-y-2">
          <label class="flex items-center gap-2 cursor-pointer text-sm">
            <input type="checkbox" v-model="s.scaleOn" class="accent-brand" />
            缩放（缩放分辨率）
          </label>
          <div v-if="s.scaleOn" class="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label class="text-muted">宽度（px）</label>
              <input type="number" min="16" v-model.number="s.scaleW" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-2 py-1.5 focus:border-brand outline-none" />
            </div>
            <div>
              <label class="text-muted">高度（px，0=按比例）</label>
              <input type="number" min="0" v-model.number="s.scaleH" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-2 py-1.5 focus:border-brand outline-none" />
            </div>
          </div>
        </div>

        <!-- 裁剪 -->
        <div class="rounded-xl border border-panel2 p-3 space-y-2">
          <label class="flex items-center gap-2 cursor-pointer text-sm">
            <input type="checkbox" v-model="s.cropOn" class="accent-brand" />
            裁剪
          </label>
          <div v-if="s.cropOn" class="grid grid-cols-4 gap-2 text-xs">
            <div><label class="text-muted">宽</label><input type="number" min="1" v-model.number="s.cropW" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-2 py-1.5 focus:border-brand outline-none" /></div>
            <div><label class="text-muted">高</label><input type="number" min="1" v-model.number="s.cropH" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-2 py-1.5 focus:border-brand outline-none" /></div>
            <div><label class="text-muted">X 偏移</label><input type="number" min="0" v-model.number="s.cropX" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-2 py-1.5 focus:border-brand outline-none" /></div>
            <div><label class="text-muted">Y 偏移</label><input type="number" min="0" v-model.number="s.cropY" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-2 py-1.5 focus:border-brand outline-none" /></div>
          </div>
        </div>

        <!-- 旋转 -->
        <div class="rounded-xl border border-panel2 p-3 space-y-2">
          <label class="flex items-center gap-2 cursor-pointer text-sm">
            <input type="checkbox" v-model="s.rotateOn" class="accent-brand" />
            旋转
          </label>
          <div v-if="s.rotateOn" class="flex flex-wrap gap-1.5 text-xs">
            <button class="seg-btn px-3 py-1 rounded-md border border-panel2" :class="{ active: s.rotateDir === 1 }" @click="s.rotateDir = 1">顺时针 90°</button>
            <button class="seg-btn px-3 py-1 rounded-md border border-panel2" :class="{ active: s.rotateDir === 2 }" @click="s.rotateDir = 2">180°</button>
            <button class="seg-btn px-3 py-1 rounded-md border border-panel2" :class="{ active: s.rotateDir === 3 }" @click="s.rotateDir = 3">逆时针 90°</button>
          </div>
        </div>

        <!-- 调色 -->
        <div class="rounded-xl border border-panel2 p-3 space-y-2">
          <label class="flex items-center gap-2 cursor-pointer text-sm">
            <input type="checkbox" v-model="s.eqOn" class="accent-brand" />
            调色（亮度/对比度/饱和度/色阶）
          </label>
          <div v-if="s.eqOn" class="space-y-2 text-xs">
            <div>
              <label class="text-muted">亮度 <span class="text-brand">{{ s.eqBrightness.toFixed(2) }}</span></label>
              <input type="range" min="-0.5" max="0.5" step="0.01" v-model.number="s.eqBrightness" class="slider w-full" />
            </div>
            <div>
              <label class="text-muted">对比度 <span class="text-brand">{{ s.eqContrast.toFixed(2) }}</span></label>
              <input type="range" min="0.5" max="2" step="0.01" v-model.number="s.eqContrast" class="slider w-full" />
            </div>
            <div>
              <label class="text-muted">饱和度 <span class="text-brand">{{ s.eqSaturation.toFixed(2) }}</span></label>
              <input type="range" min="0" max="3" step="0.01" v-model.number="s.eqSaturation" class="slider w-full" />
            </div>
            <div>
              <label class="text-muted">色阶 (gamma) <span class="text-brand">{{ s.eqGamma.toFixed(2) }}</span></label>
              <input type="range" min="0.5" max="2" step="0.01" v-model.number="s.eqGamma" class="slider w-full" />
            </div>
          </div>
        </div>

        <!-- 降噪 -->
        <div class="rounded-xl border border-panel2 p-3">
          <label class="flex items-center gap-2 cursor-pointer text-sm">
            <input type="checkbox" v-model="s.denoiseOn" class="accent-brand" />
            降噪（HQ 3D 降噪）
          </label>
        </div>

        <!-- 锐化 -->
        <div class="rounded-xl border border-panel2 p-3 space-y-2">
          <label class="flex items-center gap-2 cursor-pointer text-sm">
            <input type="checkbox" v-model="s.sharpenOn" class="accent-brand" />
            锐化
          </label>
          <div v-if="s.sharpenOn" class="space-y-2 text-xs">
            <div>
              <label class="text-muted">强度 <span class="text-brand">{{ s.sharpenLuma.toFixed(2) }}</span></label>
              <input type="range" min="0" max="5" step="0.1" v-model.number="s.sharpenLuma" class="slider w-full" />
            </div>
            <div>
              <label class="text-muted">阈值（0=关闭） <span class="text-brand">{{ s.sharpenThresh.toFixed(2) }}</span></label>
              <input type="range" min="0" max="1" step="0.05" v-model.number="s.sharpenThresh" class="slider w-full" />
            </div>
          </div>
        </div>

        <!-- 淡入淡出 -->
        <div class="rounded-xl border border-panel2 p-3 space-y-2">
          <label class="flex items-center gap-2 cursor-pointer text-sm">
            <input type="checkbox" v-model="s.fadeOn" class="accent-brand" />
            淡入淡出
          </label>
          <div v-if="s.fadeOn" class="space-y-2 text-xs">
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" v-model="s.fadeIn" class="accent-brand" /> 淡入
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" v-model="s.fadeOut" class="accent-brand" /> 淡出
            </label>
            <div>
              <label class="text-muted">时长（秒） <span class="text-brand">{{ s.fadeDur.toFixed(1) }}</span></label>
              <input type="range" min="0.1" max="5" step="0.1" v-model.number="s.fadeDur" class="slider w-full" />
            </div>
            <div>
              <label class="text-muted">淡出开始时间（秒，0=按总时长自动算）</label>
              <input type="number" min="0" step="0.1" v-model.number="s.fadeOutStart" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-2 py-1.5 focus:border-brand outline-none" />
            </div>
          </div>
        </div>

        <!-- 去隔行 -->
        <div class="rounded-xl border border-panel2 p-3">
          <label class="flex items-center gap-2 cursor-pointer text-sm">
            <input type="checkbox" v-model="s.deintOn" class="accent-brand" />
            去隔行（yadif）
          </label>
        </div>
      </div>

      <hr class="border-panel2" />

      <!-- 音频处理 -->
      <div class="space-y-3">
        <h3 class="font-semibold text-sm">音频处理</h3>

        <div>
          <label class="text-xs text-muted">音频动作</label>
          <div class="flex flex-wrap gap-1.5 mt-1">
            <button class="seg-btn px-3 py-1.5 rounded-md border border-panel2 text-xs" :class="{ active: s.audioMode === 'copy' }" @click="s.audioMode = 'copy'">原样拷贝</button>
            <button class="seg-btn px-3 py-1.5 rounded-md border border-panel2 text-xs" :class="{ active: s.audioMode === 'loudnorm' }" @click="s.audioMode = 'loudnorm'">响度归一</button>
            <button class="seg-btn px-3 py-1.5 rounded-md border border-panel2 text-xs" :class="{ active: s.audioMode === 'mute' }" @click="s.audioMode = 'mute'">静音</button>
          </div>
        </div>

        <div v-if="s.audioMode === 'loudnorm'" class="text-xs">
          <label class="text-muted">目标响度 <span class="text-brand">{{ s.loudnormI }}</span> LUFS</label>
          <input type="range" min="-24" max="-8" step="1" v-model.number="s.loudnormI" class="slider w-full" />
          <p class="text-[11px] text-muted mt-1">常用值：-16（播客/有声书）、-14（流媒体）</p>
        </div>

        <div class="rounded-xl border border-panel2 p-3 space-y-2">
          <label class="flex items-center gap-2 cursor-pointer text-sm">
            <input type="checkbox" v-model="s.volumeOn" class="accent-brand" />
            音量调整
          </label>
          <div v-if="s.volumeOn" class="text-xs">
            <label class="text-muted">倍率 <span class="text-brand">{{ s.volumeGain.toFixed(2) }}</span>×</label>
            <input type="range" min="0" max="3" step="0.1" v-model.number="s.volumeGain" class="slider w-full" />
          </div>
        </div>
      </div>

      <hr class="border-panel2" />

      <!-- 编码设置 -->
      <div class="space-y-3">
        <h3 class="font-semibold text-sm">编码设置</h3>
        <div class="grid grid-cols-2 gap-3 text-xs">
          <div>
            <label class="text-muted">输出容器</label>
            <select v-model="s.fmt" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-2 py-1.5 focus:border-brand outline-none">
              <option value="mp4">MP4</option>
              <option value="mkv">MKV</option>
              <option value="mov">MOV</option>
              <option value="webm">WebM</option>
              <option value="avi">AVI</option>
            </select>
          </div>
          <div>
            <label class="text-muted">视频编码</label>
            <select v-model="s.vEnc" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-2 py-1.5 focus:border-brand outline-none">
              <option value="libx264">libx264 (H.264)</option>
              <option value="libx265">libx265 (H.265)</option>
              <option value="libvpx-vp9">libvpx-vp9 (WebM)</option>
            </select>
          </div>
          <div>
            <label class="text-muted">CRF（质量） <span class="text-brand">{{ s.crf }}</span></label>
            <input type="range" min="0" max="51" step="1" v-model.number="s.crf" class="slider w-full" />
          </div>
        </div>
        <p class="text-[11px] text-muted">提示：勾选任何视频滤镜都会触发重新编码；未选视频滤镜时视频流原样拷贝。</p>
      </div>

      <hr class="border-panel2" />

      <!-- 高级自定义 -->
      <div class="space-y-3">
        <h3 class="font-semibold text-sm">高级：自定义滤镜</h3>
        <div>
          <label class="text-xs text-muted">自定义视频滤镜链（逗号分隔，追加到末尾）</label>
          <input v-model="s.customVf" placeholder="如 hue=s=1.5" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none font-mono" />
        </div>
        <div>
          <label class="text-xs text-muted">自定义音频滤镜链（逗号分隔）</label>
          <input v-model="s.customAf" placeholder="如 bass=g=2" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none font-mono" />
        </div>
      </div>
    </div>
  </div>
</template>
