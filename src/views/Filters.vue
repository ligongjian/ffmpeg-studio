<script setup lang="ts">
import { reactive, computed, watch } from "vue";
import { store, pickInput, probeInput, inputCwd } from "../store";
import { buildFilters, type FiltersOpts } from "../lib/ffmpeg";
import { baseName } from "../lib/format";
import CommandCard from "../components/CommandCard.vue";

const s = reactive<{
  input: string;
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
  input: "",
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

// 进入页面时用全局源文件作为初始值；换文件时同步
watch(
  () => store.inputFile,
  (v) => { if (v) s.input = v; },
  { immediate: true },
);
watch(
  () => store.fmt,
  (v) => { if (v) s.fmt = v; },
  { immediate: true },
);

const inputName = computed(() => s.input || "input.mp4");

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
      <!-- 源文件 -->
      <div>
        <label class="text-sm font-semibold mb-2 block">源视频</label>
        <div class="rounded-xl border border-panel2 bg-ink/40 px-4 py-3 text-sm flex items-center justify-between">
          <span class="truncate">
            <template v-if="s.input">{{ inputName }}</template>
            <template v-else>未选择文件</template>
          </span>
          <span class="text-brand text-xs cursor-pointer" @click="pick()">选择</span>
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
