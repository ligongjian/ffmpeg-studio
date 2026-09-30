<script setup lang="ts">
import { reactive, computed, watch, ref, onMounted, onUnmounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { store, pickInput, probeInput, setInputFile } from "../store";
import { buildAudio, AUDIO_ONLY_FMT } from "../lib/ffmpeg";
import { baseName } from "../lib/format";
import CommandCard from "../components/CommandCard.vue";
import SegGroup from "../components/SegGroup.vue";

// 音频容器清单（AUDIO_ONLY_FMT 的键子集，编码器由 ffmpeg.ts 同一份常量推导，避免漂移）
const AUDIO_LABELS: Record<string, string> = {
  mp3: "MP3",
  m4a: "M4A (AAC)",
  wav: "WAV (PCM)",
  flac: "FLAC (无损)",
  opus: "Opus",
};
const AUDIO_FMT = Object.keys(AUDIO_LABELS).map((k) => ({ value: k, label: AUDIO_LABELS[k] }));

const SAMPLE_RATES = [
  { value: 0, label: "保持原始" },
  { value: 44100, label: "44.1 kHz (CD)" },
  { value: 48000, label: "48 kHz (视频标准)" },
  { value: 32000, label: "32 kHz" },
  { value: 22050, label: "22.05 kHz (语音)" },
];

const WAV_DEPTHS = [
  { value: 16, label: "16 bit (s16le)" },
  { value: 24, label: "24 bit (s24le)" },
  { value: 32, label: "32 bit 浮点 (f32le)" },
];

const s = reactive({
  mode: "process" as "process" | "concat",
  files: [] as string[],
  /** 拼接各文件的探测时长（秒），用于总时长与淡出起点 */
  fileDurs: {} as Record<string, number>,
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
  /** WAV 位深（仅 wav 生效） */
  wavDepth: 16,
  /** 自定义音频滤镜链（高级） */
  customAf: "",
});

// 换文件后自动重测元信息（提供时长，用于淡出起点计算；与 Extract 页一致）
watch(
  () => store.inputFile,
  () => {
    probeInput().catch(() => {});
  },
  { immediate: true }
);

async function addFiles() {
  try {
    const picked = (await invoke<string[]>("pick_files")) || [];
    const have = new Set(s.files.map((f) => f.toLowerCase()));
    for (const f of picked) {
      if (!have.has(f.toLowerCase())) {
        s.files.push(f);
        have.add(f.toLowerCase());
        // 探测时长：拼接总时长 / 淡出起点都依赖它
        invoke<{ duration: number }>("probe_media_info", { path: f })
          .then((info) => {
            s.fileDurs[f] = info?.duration || 0;
          })
          .catch(() => {
            s.fileDurs[f] = 0;
          });
      }
    }
  } catch (e) {
    console.error(e);
  }
}
function removeAt(i: number) {
  const f = s.files[i];
  delete s.fileDurs[f];
  s.files.splice(i, 1);
}

// 拼接模式下拖入文件：逐个去重并探测时长（与 addFiles 逻辑一致）
async function addPaths(paths: string[]) {
  const have = new Set(s.files.map((f) => f.toLowerCase()));
  for (const f of paths) {
    if (!have.has(f.toLowerCase())) {
      s.files.push(f);
      have.add(f.toLowerCase());
      invoke<{ duration: number }>("probe_media_info", { path: f })
        .then((info) => {
          s.fileDurs[f] = info?.duration || 0;
        })
        .catch(() => {
          s.fileDurs[f] = 0;
        });
    }
  }
}

// 秒 → m:ss，用于显示已选文件时长
function formatDur(d: number): string {
  if (!d) return "";
  const m = Math.floor(d / 60);
  const x = Math.round(d % 60);
  return `${m}:${String(x).padStart(2, "0")}`;
}

// 拖放区：Tauri 在 webview 层拦截系统文件拖拽，只能经由 onDragDropEvent 拿真实路径
const zone = ref<HTMLElement | null>(null);
const zoneConcat = ref<HTMLElement | null>(null);
const dragOver = ref(false);
const dragOverConcat = ref(false);
let unlisten: (() => void) | null = null;

/** 事件里的 position 是物理像素，换算成 CSS 像素后判断指针是否落在某拖放区内 */
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
      dragOver.value = s.mode === "process" && inZone(zone.value, p.position);
      dragOverConcat.value = s.mode === "concat" && inZone(zoneConcat.value, p.position);
    } else if (p.type === "drop") {
      dragOver.value = false;
      dragOverConcat.value = false;
      if (!p.paths.length) return;
      if (s.mode === "process" && inZone(zone.value, p.position)) {
        setInputFile(p.paths[0]);
      } else if (s.mode === "concat" && inZone(zoneConcat.value, p.position)) {
        addPaths(p.paths);
      }
    } else {
      dragOver.value = false;
      dragOverConcat.value = false;
    }
  });
});

onUnmounted(() => {
  unlisten?.();
  unlisten = null;
});

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

// 当前处理对象的总时长：process = 输入文件时长；concat = 各文件之和。
// 用于正确计算淡出起点（st = 时长 - 淡出时长）。
const totalDuration = computed(() => {
  if (s.mode === "concat") {
    return s.files.reduce((a, f) => a + (s.fileDurs[f] || 0), 0);
  }
  return store.inputInfo?.duration ?? 0;
});
const totalDurationText = computed(() => {
  const d = totalDuration.value;
  if (!d) return "";
  const m = Math.floor(d / 60);
  const x = Math.round(d % 60);
  return `${m}:${String(x).padStart(2, "0")}`;
});
// 淡出需要总时长；尚未探测到时给出提示，避免用户以为淡出已正确生效
const fadeOutReady = computed(() => totalDuration.value > 0);

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
    duration: totalDuration.value,
    wavDepth: s.wavDepth,
    customAf: s.customAf,
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

      <!-- 输入选择：处理模式（单文件） -->
      <template v-if="s.mode === 'process'">
        <div>
          <label class="text-sm font-semibold mb-2 block">输入选择（源文件）</label>
          <div
            ref="zone"
            class="rounded-xl border-2 border-dashed px-4 py-6 text-sm flex flex-col items-center justify-center gap-2 cursor-pointer transition-all"
            :class="dragOver ? 'border-brand bg-brand/10 shadow-glow' : 'border-panel2 bg-ink/40 hover:border-brand hover:bg-brand/5 hover:shadow-glow'"
            @click="pickInput()"
          >
            <template v-if="store.inputFile">
              <div class="font-medium truncate max-w-full">{{ store.inputFile.split(/[\\/]/).pop() }}</div>
              <div v-if="store.inputInfo?.duration" class="text-[11px] text-muted">
                时长 {{ formatDur(store.inputInfo.duration) }}<template v-if="store.inputInfo.size"> · {{ (store.inputInfo.size / 1048576).toFixed(1) }} MB</template>
              </div>
              <span class="text-brand text-xs">重新选择 / 拖拽替换</span>
            </template>
            <template v-else>
              <div class="font-medium">点击或拖拽选择音频文件</div>
              <div class="text-[11px] text-muted">支持 MP3 / WAV / M4A / FLAC / Opus 等</div>
            </template>
          </div>
        </div>
      </template>

      <!-- 输入选择：拼接模式（多文件，按顺序） -->
      <template v-else>
        <div>
          <label class="text-sm font-semibold mb-2 block">输入选择（按顺序拼接）</label>
          <div
            ref="zoneConcat"
            class="rounded-xl border-2 border-dashed px-4 py-6 text-center cursor-pointer transition-all"
            :class="dragOverConcat ? 'border-brand bg-brand/10 shadow-glow' : 'border-panel2 bg-ink/40 hover:border-brand hover:bg-brand/5 hover:shadow-glow'"
            @click="addFiles"
          >
            <div class="font-semibold text-sm">+ 添加音频文件</div>
            <div class="text-xs text-muted mt-1">已选择 {{ s.files.length }} 个文件（按顺序排列）</div>
            <div class="text-[11px] text-muted mt-1">也可直接把文件拖拽到此处</div>
          </div>
        </div>
        <div v-if="s.files.length" class="space-y-2 max-h-48 overflow-y-auto pr-1">
          <div v-for="(f, i) in s.files" :key="f" class="flex items-center gap-3 bg-ink/50 rounded-lg px-3 py-2 text-sm">
            <span class="text-muted w-6 text-right shrink-0">{{ i + 1 }}</span>
            <div class="min-w-0 flex-1 truncate">{{ f.split(/[\\/]/).pop() }}</div>
            <button class="shrink-0 w-7 h-7 rounded-lg bg-panel2 hover:bg-red-500/30 text-muted hover:text-red-300 transition-colors cursor-pointer" @click="removeAt(i)">×</button>
          </div>
        </div>
        <p v-if="s.files.length && totalDurationText" class="text-[11px] text-muted">
          拼接总时长 ≈ <span class="text-brand font-mono">{{ totalDurationText }}</span>（用于淡出起点计算）
        </p>
      </template>

      <div class="grid md:grid-cols-2 gap-4">
        <div>
          <label class="text-xs text-muted">输出格式</label>
          <select v-model="s.outFmt" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none">
            <option v-for="f in AUDIO_FMT" :key="f.value" :value="f.value">{{ f.label }}</option>
          </select>
          <p class="mt-1 text-[11px] text-muted">编码器：{{ AUDIO_ONLY_FMT[s.outFmt] || "aac" }}</p>
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
            <p v-if="s.fadeOut > 0 && !fadeOutReady" class="mt-1 text-[11px] text-amber-500">
              淡出起点需总时长；选择文件并探测后自动确定
            </p>
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
        <p class="text-[11px] text-muted">
          拼接采用 filter_complex 串联，各文件需同为音频；输出统一重编码为所选格式。
          若需在拼接后整体调音（音量 / 淡入淡出 / 响度归一化 / 去静音），先切换到「音频处理」模式处理拼接产物。
        </p>
      </template>
    </div>

    <!-- 高级选项（对齐格式转换页的「高级选项」卡片） -->
    <div class="card rounded-2xl p-5 space-y-4">
      <h3 class="font-semibold">高级选项</h3>
      <div class="grid md:grid-cols-2 gap-4">
        <div>
          <label class="text-xs text-muted">WAV 位深</label>
          <select
            v-model.number="s.wavDepth"
            :disabled="s.outFmt !== 'wav'"
            class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none"
            :class="s.outFmt !== 'wav' ? 'opacity-50 cursor-not-allowed' : ''"
          >
            <option v-for="d in WAV_DEPTHS" :key="d.value" :value="d.value">{{ d.label }}</option>
          </select>
          <p v-if="s.outFmt !== 'wav'" class="mt-1 text-[11px] text-muted">仅 WAV 容器生效</p>
        </div>
        <div>
          <label class="text-xs text-muted">自定义音频滤镜（追加到 -af 末尾）</label>
          <input
            v-model="s.customAf"
            placeholder="如 lowpass=f=16000,highpass=f=80"
            class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm font-mono focus:border-brand outline-none"
          />
          <p class="mt-1 text-[11px] text-muted">逗号分隔的 ffmpeg 音频滤镜，高级用法</p>
        </div>
      </div>
    </div>
  </div>
</template>
