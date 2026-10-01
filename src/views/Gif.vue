<script setup lang="ts">
import { reactive, computed } from "vue";
import { store, pickInput } from "../store";
import { buildGif } from "../lib/ffmpeg";
import CommandCard from "../components/CommandCard.vue";
import { baseName, s2hms, hms2s } from "../lib/format";

const s = reactive({
  start: "",
  duration: "",
  fps: 15,
  width: 0,
  loop: 0,
  /** palettegen 调色板颜色数（2~256）：越小体积越小、色带越明显 */
  maxColors: 256,
  /** paletteuse 抖动算法 */
  dither: "sierra2_4a",
});

const inputName = computed(() => store.inputFile || "input.mp4");
const outputName = computed(() => {
  const base = baseName(inputName.value).replace(/\.[^./\\]+$/, "") || "output";
  return `${base}.gif`;
});

// ===== 源信息（探测状态 + 时长 + 分辨率）=====
const probing = computed(() => store.inputProbing);
const srcDuration = computed(() => store.inputInfo?.duration ?? 0);
const srcW = computed(() => store.inputInfo?.videoWidth ?? 0);
const srcH = computed(() => store.inputInfo?.videoHeight ?? 0);

// ===== 有效时长（秒）=====
// 留空 = 处理到结尾；否则解析用户输入（-t 支持 "3" 与 "00:00:03" 两种写法）
const effectiveSec = computed(() => {
  const d = s.duration.trim();
  if (d) {
    const sec = hms2s(d);
    if (Number.isFinite(sec) && sec > 0) return sec;
  }
  return srcDuration.value;
});
const unlimited = computed(() => !s.duration.trim());

// ===== 有效输出尺寸 =====
const effW = computed(() => (s.width > 0 ? s.width : srcW.value) || 0);
const effH = computed(() => {
  if (s.width > 0 && srcW.value > 0 && srcH.value > 0) {
    return Math.round(s.width * (srcH.value / srcW.value));
  }
  return srcH.value || 0;
});

// ===== 体积预估（GIF 每像素约 1 字节调色板索引，未计 LZW 压缩，作为上限参考）=====
const estBytes = computed(() => {
  if (!effW.value || !effH.value || !effectiveSec.value || !s.fps) return 0;
  return Math.round(effW.value * effH.value * effectiveSec.value * s.fps);
});
function fmtBytes(b: number): string {
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)} GB`;
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(0)} MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${b} B`;
}
// 上限估算 > 30 MB 视为偏大；源时长未知时无法预估，另行提示
const sizeWarn = computed(() => estBytes.value > 30 * 1024 * 1024);
const unknownSrc = computed(() => srcDuration.value === 0);
const longClipWarn = computed(() => unlimited.value && srcDuration.value > 10);

const DITHERS = [
  { value: "none", label: "无（色块感强，但最小最快）" },
  { value: "bayer", label: "Bayer 有序抖动" },
  { value: "floyd_steinberg", label: "Floyd–Steinberg" },
  { value: "sierra2", label: "Sierra 2" },
  { value: "sierra2_4a", label: "Sierra 2 Lite（默认）" },
  { value: "sierra3", label: "Sierra 3" },
  { value: "burkes", label: "Burkes" },
  { value: "atkinson", label: "Atkinson" },
  { value: "heckbert", label: "Heckbert" },
];

const cmd = computed(() =>
  buildGif({
    input: inputName.value,
    start: s.start,
    duration: s.duration,
    fps: s.fps,
    width: s.width,
    loop: s.loop,
    maxColors: s.maxColors,
    dither: s.dither,
  })
);
</script>

<template>
  <div class="space-y-6">
    <CommandCard title="动图 GIF · 命令预览" :command="cmd" task-name="生成 GIF" />

    <div class="card rounded-2xl p-5 space-y-5">
      <div>
        <label class="text-sm font-semibold mb-2 block">源文件</label>
        <div class="rounded-xl border border-panel2 bg-ink/40 px-4 py-3 text-sm flex items-center justify-between">
          <span class="truncate">{{ store.inputFile || "未选择文件" }}</span>
          <span class="text-brand text-xs cursor-pointer lk" @click="pickInput()">选择</span>
        </div>
      </div>

      <!-- 源时长：GIF 是最需要知道总时长的页面，必须展示 -->
      <div class="flex items-center justify-between text-xs">
        <span class="text-muted">源时长</span>
        <span class="font-mono" :class="srcDuration > 0 ? 'text-fg' : 'text-muted'">
          <template v-if="probing">读取中…</template>
          <template v-else-if="srcDuration > 0">{{ s2hms(srcDuration) }}</template>
          <template v-else>未知（未选择文件或探测失败）</template>
        </span>
      </div>

      <div class="text-xs text-muted">输出文件：<span class="text-brand font-mono">{{ outputName }}</span></div>

      <div class="grid md:grid-cols-2 gap-4">
        <div>
          <label class="text-xs text-muted">起始时间 -ss（可选）</label>
          <input
            v-model="s.start"
            placeholder="如 00:00:01 或 5"
            class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none"
          />
        </div>
        <div>
          <label class="text-xs text-muted">时长 -t 秒（可选，留空到结尾）</label>
          <input
            v-model="s.duration"
            placeholder="如 3"
            class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none"
          />
        </div>
        <div>
          <label class="text-xs text-muted">帧率（默认 15）</label>
          <input
            type="number"
            min="1"
            max="50"
            v-model.number="s.fps"
            class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none"
          />
        </div>
        <div>
          <label class="text-xs text-muted">宽度（像素，0 = 保持原始）</label>
          <input
            type="number"
            min="0"
            step="1"
            v-model.number="s.width"
            class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none"
          />
        </div>
        <div>
          <label class="text-xs text-muted">调色板颜色数（2~256）</label>
          <input
            type="number"
            min="2"
            max="256"
            v-model.number="s.maxColors"
            class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none"
          />
          <p class="text-[11px] text-muted mt-1">越小体积越小、色带越明显；默认 256 即全彩。</p>
        </div>
        <div>
          <label class="text-xs text-muted">抖动算法（dither）</label>
          <select
            v-model="s.dither"
            class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none"
          >
            <option v-for="d in DITHERS" :key="d.value" :value="d.value">{{ d.label }}</option>
          </select>
        </div>
      </div>

      <!-- 体积预估与防护：不限时长 / 长片段极易产出数百 MB -->
      <div v-if="effW && effH && s.fps" class="rounded-xl border border-panel2 bg-ink/40 p-3 text-xs space-y-1.5">
        <div class="flex items-center justify-between">
          <span class="text-muted">预计体积上限（未计 LZW 压缩）</span>
          <span class="font-mono" :class="sizeWarn ? 'text-warn' : 'text-fg'">{{ fmtBytes(estBytes) }}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-muted">有效时长</span>
          <span class="font-mono text-fg">{{ unlimited ? `至结尾（${srcDuration > 0 ? s2hms(srcDuration) : '未知'}）` : s2hms(effectiveSec) }}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-muted">有效尺寸</span>
          <span class="font-mono text-fg">{{ effW }} × {{ effH }}</span>
        </div>
      </div>

      <div
        v-if="longClipWarn"
        class="rounded-xl border border-warn/40 bg-warn/10 p-3 text-xs text-warn space-y-1"
      >
        <div>未限制时长：将处理整段视频（{{ s2hms(srcDuration) }}），长片段极易产出数百 MB 的 GIF。</div>
        <div>建议填一个较短的「时长 -t」再生成，或同时降低帧率 / 宽度 / 颜色数。</div>
      </div>
      <div
        v-else-if="sizeWarn"
        class="rounded-xl border border-warn/40 bg-warn/10 p-3 text-xs text-warn"
      >
        预计体积偏大（约 {{ fmtBytes(estBytes) }}）。建议缩短时长、或降低帧率 / 宽度 / 颜色数后再生成。
      </div>
      <div
        v-else-if="unknownSrc"
        class="rounded-xl border border-panel2 bg-ink/40 p-3 text-xs text-muted"
      >
        未探测到源时长，无法预估体积。注意：不限时长时可能产出数百 MB 的 GIF，建议先填「时长 -t」。
      </div>

      <div>
        <label class="text-xs text-muted">循环方式</label>
        <select v-model.number="s.loop" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none">
          <option :value="0">无限循环</option>
          <option :value="-1">不循环（播放一次）</option>
          <option :value="2">循环 2 次</option>
          <option :value="3">循环 3 次</option>
        </select>
        <p class="text-[11px] text-muted mt-1">采用 palettegen + paletteuse 两步法生成调色板，色彩比直接 -c:v gif 干净得多。</p>
        <p class="text-[11px] text-muted mt-1">循环次数指「额外重复次数」：设为 2 表示连播 3 遍；设为「不循环」则播放一次即停。</p>
      </div>
    </div>
  </div>
</template>
