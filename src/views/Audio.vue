<script setup lang="ts">
import { reactive, computed } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { store, pickInput } from "../store";
import { buildAudio } from "../lib/ffmpeg";
import { baseName } from "../lib/format";
import CommandCard from "../components/CommandCard.vue";
import SegGroup from "../components/SegGroup.vue";

const AUDIO_FMT = [
  { value: "mp3", label: "MP3" },
  { value: "m4a", label: "M4A (AAC)" },
  { value: "wav", label: "WAV (PCM)" },
  { value: "flac", label: "FLAC (无损)" },
  { value: "opus", label: "Opus" },
];

const SAMPLE_RATES = [
  { value: 0, label: "保持原始" },
  { value: 44100, label: "44.1 kHz (CD)" },
  { value: 48000, label: "48 kHz (视频标准)" },
  { value: 32000, label: "32 kHz" },
  { value: 22050, label: "22.05 kHz (语音)" },
];

const s = reactive({
  mode: "process" as "process" | "concat",
  files: [] as string[],
  outFmt: "mp3",
  quality: "standard" as "high" | "standard" | "small",
  sampleRate: 0,
  normalize: false,
  loudnormI: -16,
  fadeIn: 0,
  fadeOut: 0,
  volumeGain: 0,
  silenceRemove: false,
  channels: 0,
});

async function addFiles() {
  try {
    const picked = (await invoke<string[]>("pick_files")) || [];
    const have = new Set(s.files.map((f) => f.toLowerCase()));
    for (const f of picked) {
      if (!have.has(f.toLowerCase())) {
        s.files.push(f);
        have.add(f.toLowerCase());
      }
    }
  } catch (e) {
    console.error(e);
  }
}
function removeAt(i: number) {
  s.files.splice(i, 1);
}

// WAV 是 PCM 无损，「音质档位」对它没有意义
const qualityUsable = computed(() => s.outFmt !== "wav");
const qualityHint = computed(() => {
  switch (s.outFmt) {
    case "mp3":
      return "VBR 档位映射 -q:a：高音质 0 / 均衡 2 / 体积优先 4";
    case "m4a":
      return "AAC 码率映射：高音质 192k / 均衡 128k / 体积优先 96k";
    case "opus":
      return "Opus 码率映射：高音质 160k / 均衡 96k / 体积优先 64k";
    case "flac":
      return "压缩级别映射：高音质 12 / 均衡 5 / 体积优先 0";
    default:
      return "WAV 输出 PCM 无损采样，音质档位不生效";
  }
});

const inputName = computed(() => store.inputFile || "input.mp3");
// 输出文件名预览：与 buildAudio 内部命名规则保持一致
const outputName = computed(() => {
  const fmt = s.outFmt;
  if (s.mode === "concat") {
    const base = baseName(s.files[0] || "merged").replace(/\.[^./\\]+$/, "") || "merged";
    return `${base}.merged.${fmt}`;
  }
  const base = baseName(inputName.value).replace(/\.[^./\\]+$/, "") || "output";
  return `${base}.audio.${fmt}`;
});

const cmd = computed(() =>
  buildAudio({
    mode: s.mode,
    input: inputName.value,
    files: s.files,
    outFmt: s.outFmt,
    quality: s.quality,
    sampleRate: s.sampleRate,
    normalize: s.normalize,
    loudnormI: s.loudnormI,
    fadeIn: s.fadeIn,
    fadeOut: s.fadeOut,
    volumeGain: s.volumeGain,
    silenceRemove: s.silenceRemove,
    channels: s.channels,
  })
);
</script>

<template>
  <div class="space-y-6">
    <CommandCard title="音频处理 · 命令预览" :command="cmd" task-name="音频处理" />

    <div class="card rounded-2xl p-5 space-y-5">
      <div>
        <div class="text-sm font-semibold mb-2">模式</div>
        <SegGroup
          v-model="s.mode"
          :options="[
            { value: 'process', label: '音频处理' },
            { value: 'concat', label: '拼接合并' },
          ]"
        />
      </div>

      <div class="grid md:grid-cols-2 gap-4">
        <div>
          <label class="text-xs text-muted">输出格式</label>
          <select v-model="s.outFmt" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none">
            <option v-for="f in AUDIO_FMT" :key="f.value" :value="f.value">{{ f.label }}</option>
          </select>
        </div>
        <div>
          <label class="text-xs text-muted">采样率</label>
          <select v-model.number="s.sampleRate" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none">
            <option v-for="r in SAMPLE_RATES" :key="r.value" :value="r.value">{{ r.label }}</option>
          </select>
        </div>
      </div>

      <div class="text-xs text-muted">输出文件：<span class="text-brand font-mono">{{ outputName }}</span></div>

      <!-- 处理模式 -->
      <template v-if="s.mode === 'process'">
        <div>
          <label class="text-sm font-semibold mb-2 block">源文件</label>
          <div class="rounded-xl border border-panel2 bg-ink/40 px-4 py-3 text-sm flex items-center justify-between">
            <span class="truncate">{{ store.inputFile || "未选择文件" }}</span>
            <span class="text-brand text-xs cursor-pointer" @click="pickInput()">选择</span>
          </div>
        </div>

        <div>
          <div class="flex items-center gap-2">
            <span class="text-xs text-muted">音质档位</span>
            <SegGroup
              v-model="s.quality"
              :disabled="!qualityUsable"
              :options="[
                { value: 'high', label: '高音质' },
                { value: 'standard', label: '均衡' },
                { value: 'small', label: '体积优先' },
              ]"
            />
          </div>
          <p class="mt-1 text-xs text-muted">{{ qualityHint }}</p>
        </div>

        <div class="grid md:grid-cols-2 gap-4">
          <div>
            <label class="text-xs text-muted">音量增益 (dB，可负)</label>
            <input type="number" step="0.5" v-model.number="s.volumeGain" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none" />
          </div>
          <div>
            <label class="text-xs text-muted">声道</label>
            <select v-model.number="s.channels" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none">
              <option :value="0">保持原始</option>
              <option :value="1">单声道</option>
              <option :value="2">立体声</option>
            </select>
          </div>
          <div>
            <label class="text-xs text-muted">淡入时长（秒，0 = 不淡入）</label>
            <input type="number" min="0" step="0.5" v-model.number="s.fadeIn" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none" />
          </div>
          <div>
            <label class="text-xs text-muted">淡出时长（秒，0 = 不淡出）</label>
            <input type="number" min="0" step="0.5" v-model.number="s.fadeOut" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none" />
          </div>
        </div>

        <div class="grid md:grid-cols-2 gap-3 text-sm">
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" v-model="s.normalize" class="accent-brand" />
            响度归一化 (loudnorm)
          </label>
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" v-model="s.silenceRemove" class="accent-brand" />
            去除首尾静音
          </label>
        </div>
        <div v-if="s.normalize" class="max-w-xs">
          <label class="text-xs text-muted">目标响度 LUFS（默认 -16）</label>
          <input type="number" step="1" v-model.number="s.loudnormI" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none" />
        </div>
      </template>

      <!-- 拼接模式 -->
      <template v-else>
        <div
          class="rounded-xl border-2 border-dashed border-panel2 bg-ink/40 p-4 text-center cursor-pointer hover:border-brand transition-colors"
          @click="addFiles"
        >
          <div class="font-semibold text-sm">+ 添加音频文件</div>
          <div class="text-xs text-muted mt-1">已选择 {{ s.files.length }} 个文件（按顺序排列）</div>
        </div>
        <div v-if="s.files.length" class="space-y-2 max-h-48 overflow-y-auto pr-1">
          <div v-for="(f, i) in s.files" :key="f" class="flex items-center gap-3 bg-ink/50 rounded-lg px-3 py-2 text-sm">
            <span class="text-muted w-6 text-right shrink-0">{{ i + 1 }}</span>
            <div class="min-w-0 flex-1 truncate">{{ f.split(/[\\/]/).pop() }}</div>
            <button class="shrink-0 w-7 h-7 rounded-lg bg-panel2 hover:bg-red-500/30 text-muted hover:text-red-300 transition-colors cursor-pointer" @click="removeAt(i)">×</button>
          </div>
        </div>
        <p class="text-[11px] text-muted">
          拼接采用 filter_complex 串联，各文件需同为音频；输出统一重编码为所选格式。
          上方勾选的音量增益、淡入淡出、响度归一化、去静音会整体作用于拼接结果。
        </p>
      </template>
    </div>
  </div>
</template>
