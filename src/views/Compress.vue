<script setup lang="ts">
import { reactive, computed, watch } from "vue";
import { store, pickInput, probeInput, saveSettings } from "../store";
import { buildCompress, HWACCEL_ENCODERS } from "../lib/ffmpeg";
import CommandCard from "../components/CommandCard.vue";
import SegGroup from "../components/SegGroup.vue";
import { baseName } from "../lib/format";

// CRF 与「设置 → 默认输出 → 默认 CRF」共用同一个值
const s = reactive({ preset: "medium", res: "", bitrate: "", hwaccel: "" });
const inputName = computed(() => store.inputFile || "input.mp4");
// 输出文件名：沿用源 basename 保持 .mp4；源本身已是 mp4 时追加 .compressed 防自覆盖
const outputName = computed(() => {
  const base = baseName(inputName.value).replace(/\.[^./\\]+$/, "") || "output";
  return /\.mp4$/i.test(inputName.value) ? `${base}.compressed.mp4` : `${base}.mp4`;
});
const cmd = computed(() =>
  buildCompress({ input: inputName.value, crf: store.crf, preset: s.preset, res: s.res, bitrate: s.bitrate, hwaccel: s.hwaccel })
);

// 换文件后自动重测元信息（inputFile 由 setInputFile 写入；这里覆盖"重新选同名文件"之类的边界）
watch(
  () => store.inputFile,
  () => {
    probeInput().catch(() => {
      /* 忽略 */
    });
  },
  { immediate: true }
);

// ===== 预估输出 / 编码时间（基于真实元信息 + 经验因子） =====

/**
 * 经验映射：CRF → 大致视频码率（Mbps）。
 * 取 1080p x264 medium 的典型经验值；分辨率/预设变化时再乘修正系数。
 */
const CRF_Mbps: Record<number, number> = {
  18: 28,
  20: 20,
  21: 16,
  22: 12,
  23: 10,
  24: 8,
  25: 6.5,
  26: 5,
  27: 4,
  28: 3,
  29: 2.4,
  30: 2,
  31: 1.6,
  32: 1.2,
  33: 1,
  34: 0.8,
  35: 0.6,
};

/** 预设对编码时间的倍率（相对于 medium=1x）。CRF 模式下也影响文件大小 ±5% 左右，这里保守取 1.0 */
const PRESET_SPEED: Record<string, number> = {
  ultrafast: 4.0,
  fast: 2.2,
  medium: 1.0,
  slow: 0.6,
  veryslow: 0.4,
};

/** 目标分辨率相对 1080p 的像素比（x264 在 CRF 下码率大致正比于像素数） */
function resPixels(res: string): number {
  if (!res) return 1080 * 1920; // 保持原始按 1080p 基准估
  const [w, h] = res.split(":").map((n) => parseInt(n, 10));
  return (w || 0) * (h || 0);
}
const BASE_PIXELS = 1080 * 1920;

/** "2M" → 2_000_000 bps；"1024k" → 1_024_000 bps */
function parseBitrate(input: string): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*(?:[kKmMbB]?)(?:bps|b\/s)?$/.exec(input.trim().toLowerCase().replace(",", "."));
  if (!m) return null;
  const v = parseFloat(m[1]);
  const unit = m[2];
  if (!unit || unit === "b" || unit === "bps") return v;
  if (unit === "k" || unit === "kb") return v * 1024;
  if (unit === "m" || unit === "mb") return v * 1024 * 1024;
  return null;
}

/** 实际视频流比特率（bps）。用户填了码率就听用户的，否则按 CRF × 分辨率修正 */
function estimateVideoBitrate(): number | null {
  const explicit = parseBitrate(s.bitrate);
  if (explicit && explicit > 0) return explicit;
  const crf = store.crf;
  const mbps = CRF_Mbps[crf] ?? CRF_Mbps[Math.min(35, Math.max(18, Math.round(crf)))];
  if (!mbps) return null;
  const factor = resPixels(s.res) / BASE_PIXELS;
  return mbps * 1_000_000 * factor;
}

/** 音频轨道按 128 kbps 估（aac 典型值）；纯音频/无源信息时不计 */
const AUDIO_BPS = 128 * 1024;

/** 预估输出大小（字节）；信息不全时返回 null，UI 显示占位文案 */
const estBytes = computed<number | null>(() => {
  const info = store.inputInfo;
  if (!info || info.duration <= 0) return null;
  const vbps = estimateVideoBitrate();
  const hasVideo = info.videoBitrate != null || info.videoWidth != null;
  const totalBps = (vbps ?? 0) + (hasVideo ? AUDIO_BPS : 0);
  if (totalBps <= 0) return null;
  return Math.round((totalBps * info.duration) / 8);
});

const savingsPct = computed<number | null>(() => {
  const info = store.inputInfo;
  const est = estBytes.value;
  if (!info || !est || info.size <= 0) return null;
  const p = (info.size - est) / info.size * 100;
  return Math.round(p);
});

/** 编码时间（秒）。经验：x264 medium 大约能以 10~30× 实时编码，这里取 18×，按 preset 缩放 */
const estSeconds = computed<number | null>(() => {
  const info = store.inputInfo;
  if (!info || info.duration <= 0) return null;
  const speed = PRESET_SPEED[s.preset] ?? 1.0;
  const realtime = 18 * speed; // 倍实时
  return info.duration / realtime;
});

function fmtBytes(b: number): string {
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)} GB`;
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${b} B`;
}
function fmtSec(s: number): string {
  if (s < 60) return `${Math.round(s)} 秒`;
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  if (m < 60) return sec ? `${m} 分 ${sec} 秒` : `${m} 分`;
  const h = Math.floor(m / 60);
  return `${h} 时 ${m % 60} 分`;
}
function fmtDuration(s: number): string {
  if (!isFinite(s) || s <= 0) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = Math.floor(s % 60);
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`;
  return `${m}:${String(x).padStart(2, "0")}`;
}
</script>

<template>
  <div class="space-y-6">
    <CommandCard title="压缩优化 · 命令预览" :command="cmd" task-name="压缩优化" />

    <div class="card rounded-2xl p-5 space-y-6">
      <div>
        <label class="text-sm font-semibold mb-2 block">源文件</label>
        <div class="rounded-xl border border-panel2 bg-ink/40 px-4 py-3 text-sm flex items-center justify-between">
          <span class="truncate">
            <template v-if="store.inputInfo">
              {{ inputName }} · {{ fmtBytes(store.inputInfo.size) }} · {{ fmtDuration(store.inputInfo.duration) }}
            </template>
            <template v-else-if="store.inputFile">
              {{ inputName }}
              <span v-if="store.inputProbing" class="text-muted"> · 读取中…</span>
              <span v-else class="text-err"> · {{ store.inputProbeErr || "读取失败" }}</span>
            </template>
            <template v-else>未选择文件</template>
          </span>
          <span class="text-brand text-xs cursor-pointer lk" @click="pickInput()">选择</span>
        </div>
      </div>

      <div class="text-xs text-muted">输出文件：<span class="text-brand font-mono">{{ outputName }}</span></div>

      <div>
        <div class="flex justify-between text-sm mb-1">
          <span class="font-semibold">CRF 恒定质量</span>
          <span class="text-brand font-bold">{{ store.crf }}</span>
        </div>
        <input type="range" min="18" max="35" v-model.number="store.crf" @change="saveSettings()" class="slider w-full" />
        <div class="flex justify-between text-xs text-muted">
          <span>18 高画质</span><span>35 高压缩</span>
        </div>
      </div>

      <div>
        <div class="text-sm font-semibold mb-2">编码预设 (速度 / 压缩率)</div>
        <SegGroup
          v-model="s.preset"
          :options="[
            { value: 'ultrafast', label: 'ultrafast' },
            { value: 'fast', label: 'fast' },
            { value: 'medium', label: 'medium' },
            { value: 'slow', label: 'slow' },
            { value: 'veryslow', label: 'veryslow' },
          ]"
        />
      </div>

      <div>
        <label class="text-xs text-muted">硬件加速编码（可选，需对应显卡驱动）</label>
        <select v-model="s.hwaccel" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none">
          <option v-for="e in HWACCEL_ENCODERS" :key="e.value" :value="e.value">{{ e.label }}</option>
        </select>
        <p v-if="s.hwaccel" class="text-[11px] text-muted mt-1">
          已选用 {{ HWACCEL_ENCODERS.find((e) => e.value === s.hwaccel)?.label }}，质量参数按 CRF 映射到 -cq / -global_quality；需本机装有对应显卡与驱动。
        </p>
      </div>

      <div class="grid md:grid-cols-2 gap-4">
        <div>
          <label class="text-xs text-muted">最大分辨率</label>
          <select v-model="s.res" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none">
            <option value="">保持原始</option>
            <option value="1920:1080">1080p</option>
            <option value="1280:720">720p</option>
            <option value="854:480">480p</option>
          </select>
        </div>
        <div>
          <label class="text-xs text-muted">目标码率 (可选)</label>
          <input v-model="s.bitrate" placeholder="如 2M，留空按 CRF" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none" />
        </div>
      </div>

      <div class="rounded-xl bg-ink/50 p-4 flex items-center justify-between text-sm">
        <div>
          <div class="text-muted text-xs">预估输出</div>
          <div v-if="estBytes !== null" class="font-bold mt-0.5">
            约 {{ fmtBytes(estBytes) }}
            <span v-if="savingsPct !== null" :class="savingsPct >= 0 ? 'text-brand' : 'text-err'">
              {{ savingsPct >= 0 ? `↓ 节省 ${savingsPct}%` : `↑ 增大 ${Math.abs(savingsPct)}%` }}
            </span>
          </div>
          <div v-else class="font-bold mt-0.5 text-muted">— 选择文件后可估算 —</div>
        </div>
        <div class="text-right">
          <div class="text-muted text-xs">编码时间</div>
          <div v-if="estSeconds !== null" class="font-bold mt-0.5">约 {{ fmtSec(estSeconds) }}</div>
          <div v-else class="font-bold mt-0.5 text-muted">—</div>
        </div>
      </div>
      <p class="text-[11px] text-muted -mt-3">
        基于 CRF / 预设 / 分辨率 / 码率与源文件真实时长估算，仅供预览参考；实际取决于素材复杂度。
      </p>
    </div>
  </div>
</template>
