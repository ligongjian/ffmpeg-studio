<script setup lang="ts">
import { reactive, computed, watch } from "vue";
import { store, pickInput, saveSettings } from "../store";
import {
  buildConvert,
  isAudioOnly,
  isVideoOnly,
  supportsFaststart,
  AUDIO_ONLY_FMT,
  FMT_OPTIONS,
  HWACCEL_ENCODERS,
} from "../lib/ffmpeg";
import { baseName } from "../lib/format";
import CommandCard from "../components/CommandCard.vue";
import SegGroup from "../components/SegGroup.vue";

const s = reactive({
  enc: "libx264",
  res: "",
  aud: "aac",
  quality: "23",
  faststart: true,
  deint: false,
  norm: false,
  hwaccel: "",
});

const audioOnly = computed(() => isAudioOnly(store.fmt));
const videoOnly = computed(() => isVideoOnly(store.fmt));
const faststartOk = computed(() => supportsFaststart(store.fmt));
// 分辨率 / 去隔行 只对"真的重编码视频"有意义（直接拷贝、纯音频都用不上）
const resUsable = computed(() => !audioOnly.value && s.enc !== "copy");
const deintUsable = computed(() => !audioOnly.value && !videoOnly.value && s.enc !== "copy");
const normUsable = computed(() => !videoOnly.value);

const crfHint = computed(() => {
  if (videoOnly.value) return "GIF 编码不使用 CRF";
  if (audioOnly.value) return "纯音频输出，CRF 只作用于视频，不生效";
  if (s.enc === "copy") return "直接拷贝流、不重编码，CRF 不生效";
  return "";
});

// 换容器时跟着修正音频编码：mp3 容器只能装 libmp3lame，切回来恢复 AAC
watch(
  () => store.fmt,
  (fmt) => {
    if (isAudioOnly(fmt)) s.aud = AUDIO_ONLY_FMT[fmt];
    else if (s.aud === "libmp3lame") s.aud = "aac";
  },
  { immediate: true }
);

const inputName = computed(() => store.inputFile || "input.mov");
// 输出文件名：沿用源文件 basename，后缀换成目标容器；同名时追加 .converted
const outputName = computed(() => {
  const base = baseName(inputName.value).replace(/\.[^./\\]+$/, "") || "output";
  const fmt = store.fmt.toLowerCase();
  return base === fmt ? `${base}.converted.${store.fmt}` : `${base}.${store.fmt}`;
});
const cmd = computed(() =>
  buildConvert({
    input: inputName.value,
    fmt: store.fmt,
    enc: s.enc,
    res: s.res,
    aud: s.aud,
    quality: s.quality,
    faststart: s.faststart,
    deint: s.deint,
    norm: s.norm,
    hwaccel: s.hwaccel,
  })
);

// 硬件加速只对"真正重编码的视频"有意义（纯音频 / GIF / 直接拷贝都不适用）
const hwaccelUsable = computed(() => !audioOnly.value && !videoOnly.value && s.enc !== "copy");
</script>

<template>
  <div class="space-y-6">
    <CommandCard title="格式转换 · 命令预览" :command="cmd" task-name="格式转换" />

    <div class="card rounded-2xl p-5 space-y-5">
      <div>
        <label class="text-sm font-semibold mb-2 block">源文件</label>
        <div class="rounded-xl border border-panel2 bg-ink/40 px-4 py-3 text-sm flex items-center justify-between">
          <span class="truncate">{{ store.inputFile || "demo_record.mov（示例）" }}</span>
          <span class="text-brand text-xs cursor-pointer" @click="pickInput()">选择</span>
        </div>
      </div>

      <div class="text-xs text-muted">输出文件：<span class="text-brand font-mono">{{ outputName }}</span></div>

      <div class="grid md:grid-cols-2 gap-4">
        <div>
          <label class="text-xs text-muted">目标格式</label>
          <select v-model="store.fmt" @change="saveSettings()" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none">
            <option v-for="f in FMT_OPTIONS" :key="f.value" :value="f.value">{{ f.label }}</option>
          </select>
        </div>
        <div>
          <label class="text-xs text-muted">编码方式</label>
          <select
            v-model="s.enc"
            :disabled="audioOnly"
            class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none"
            :class="audioOnly ? 'opacity-50 cursor-not-allowed' : ''"
          >
            <option value="libx264">H.264 (libx264)</option>
            <option value="libx265">H.265 / HEVC</option>
            <option value="vp9">VP9</option>
            <option value="copy">直接拷贝 (不重编码)</option>
          </select>
          <p v-if="audioOnly" class="mt-1 text-xs text-muted">纯音频输出，不使用视频编码</p>
        </div>
        <div>
          <label class="text-xs text-muted">分辨率</label>
          <select
            v-model="s.res"
            :disabled="!resUsable"
            class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none"
            :class="resUsable ? '' : 'opacity-50 cursor-not-allowed'"
          >
            <option value="">保持原始</option>
            <option value="3840:2160">4K (3840×2160)</option>
            <option value="1920:1080">1080p</option>
            <option value="1280:720">720p</option>
            <option value="854:480">480p</option>
          </select>
          <p v-if="audioOnly" class="mt-1 text-xs text-muted">纯音频输出，分辨率不适用</p>
          <p v-else-if="s.enc === 'copy'" class="mt-1 text-xs text-muted">直接拷贝流，无法缩放</p>
        </div>
        <div>
          <label class="text-xs text-muted">音频编码</label>
          <select
            v-model="s.aud"
            :disabled="videoOnly"
            class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none"
            :class="videoOnly ? 'opacity-50 cursor-not-allowed' : ''"
          >
            <template v-if="audioOnly">
              <option :value="AUDIO_ONLY_FMT[store.fmt]">{{ AUDIO_ONLY_FMT[store.fmt] }}（{{ store.fmt }} 容器唯一可用）</option>
            </template>
            <template v-else>
              <option value="aac">AAC</option>
              <option value="mp3">MP3</option>
              <option value="opus">Opus</option>
              <option value="copy">拷贝</option>
            </template>
          </select>
          <p v-if="videoOnly" class="mt-1 text-xs text-muted">GIF 没有音轨</p>
        </div>
      </div>

      <div>
        <label class="text-xs text-muted">硬件加速编码（可选，需对应显卡驱动）</label>
        <select
          v-model="s.hwaccel"
          :disabled="!hwaccelUsable"
          class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none"
          :class="hwaccelUsable ? '' : 'opacity-50 cursor-not-allowed'"
        >
          <option v-for="e in HWACCEL_ENCODERS" :key="e.value" :value="e.value">{{ e.label }}</option>
        </select>
        <p v-if="!hwaccelUsable" class="mt-1 text-xs text-muted">纯音频 / GIF / 直接拷贝时无需硬件加速</p>
        <p v-else-if="s.hwaccel" class="mt-1 text-xs text-muted">
          已选用 {{ HWACCEL_ENCODERS.find((e) => e.value === s.hwaccel)?.label }}，质量参数按 CRF 映射到 -cq / -global_quality。
        </p>
      </div>

      <div>
        <div class="flex items-center gap-2">
          <span class="text-xs text-muted">质量 (CRF)</span>
          <SegGroup
            v-model="s.quality"
            :options="[
              { value: '28', label: '省空间' },
              { value: '23', label: '均衡' },
              { value: '18', label: '高画质' },
            ]"
          />
        </div>
        <p v-if="crfHint" class="mt-1 text-xs text-muted">{{ crfHint }}</p>
      </div>
    </div>

    <div class="card rounded-2xl p-5">
      <h3 class="font-semibold mb-3">高级选项</h3>
      <div class="grid md:grid-cols-3 gap-4 text-sm">
        <label class="flex items-center gap-2" :class="faststartOk ? 'cursor-pointer' : 'opacity-50'">
          <input type="checkbox" v-model="s.faststart" :disabled="!faststartOk" class="accent-brand" />
          Web 快速启动
          <span v-if="!faststartOk" class="text-xs text-muted">（仅 mp4 / mov 支持）</span>
        </label>
        <label class="flex items-center gap-2" :class="deintUsable ? 'cursor-pointer' : 'opacity-50'">
          <input type="checkbox" v-model="s.deint" :disabled="!deintUsable" class="accent-brand" />
          去隔行
          <span v-if="!deintUsable" class="text-xs text-muted">（需重编码视频）</span>
        </label>
        <label class="flex items-center gap-2" :class="normUsable ? 'cursor-pointer' : 'opacity-50'">
          <input type="checkbox" v-model="s.norm" :disabled="!normUsable" class="accent-brand" />
          音频响度归一
          <span v-if="!normUsable" class="text-xs text-muted">（无音轨）</span>
        </label>
      </div>
    </div>
  </div>
</template>
