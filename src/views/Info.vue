<script setup lang="ts">
import { reactive, ref, computed } from "vue";
import { invoke } from "@tauri-apps/api/core";

interface StreamInfo {
  index: number;
  codecType: string;
  codecName: string;
  width?: number | null;
  height?: number | null;
  sampleRate?: number | null;
  channels?: number | null;
  bitRate?: number | null;
}
interface MediaInfo {
  size: number;
  duration: number;
  formatName?: string | null;
  videoBitrate?: number | null;
  videoWidth?: number | null;
  videoHeight?: number | null;
  streams: StreamInfo[];
}

type Slot = { file: string; info: MediaInfo | null; err: string; probing: boolean };
const a = reactive<Slot>({ file: "", info: null, err: "", probing: false });
const b = reactive<Slot>({ file: "", info: null, err: "", probing: false });
const compare = ref(false);

/** 单文件 / 双文件对比时渲染的面板列表（用数组迭代，避免 v-for 在对象字面量上把 slot 推断成 optional） */
const panels = computed(() =>
  compare.value
    ? [{ key: "a" as const, slot: a }, { key: "b" as const, slot: b }]
    : [{ key: "a" as const, slot: a }]
);

async function pick(slot: "a" | "b") {
  try {
    const p = await invoke<string | null>("pick_file");
    if (p) {
      const s = slot === "a" ? a : b;
      s.file = p;
      await probe(slot);
    }
  } catch (e) {
    console.error(e);
  }
}

async function probe(slot: "a" | "b") {
  const s = slot === "a" ? a : b;
  if (!s.file) return;
  s.probing = true;
  s.err = "";
  s.info = null;
  try {
    s.info = await invoke<MediaInfo>("probe_media_info", { path: s.file });
  } catch (e) {
    s.err = typeof e === "string" ? e : "读取失败";
  } finally {
    s.probing = false;
  }
}

const TYPE_LABEL: Record<string, string> = {
  video: "视频",
  audio: "音频",
  subtitle: "字幕",
  data: "数据",
  attachment: "附件",
};

function fmtBytes(b: number): string {
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(2)} GB`;
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${b} B`;
}
function fmtDuration(s: number): string {
  if (!isFinite(s) || s <= 0) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = Math.floor(s % 60);
  const ms = Math.round((s % 1) * 1000);
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`;
  return `${m}:${String(x).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}
function streamDetail(st: StreamInfo): string {
  const parts: string[] = [];
  if (st.codecType === "video" && st.width && st.height) parts.push(`${st.width}×${st.height}`);
  if (st.codecType === "audio") {
    if (st.sampleRate) parts.push(`${Math.round(st.sampleRate / 1000)} kHz`);
    if (st.channels) parts.push(`${st.channels} 声道`);
  }
  if (st.bitRate) parts.push(`${Math.round(st.bitRate / 1000)} kbps`);
  return parts.join(" · ");
}
</script>

<template>
  <div class="space-y-6">
    <div class="card rounded-2xl p-5 flex items-center justify-between">
      <div>
        <h3 class="font-bold">媒体信息探针</h3>
        <p class="text-xs text-muted mt-1">查看编码格式、分辨率、码率、音轨 / 字幕轨等元信息（基于 ffprobe）。</p>
      </div>
      <label class="flex items-center gap-2 text-sm cursor-pointer select-none">
        <input type="checkbox" v-model="compare" class="accent-brand" />
        双文件对比
      </label>
    </div>

    <div class="grid gap-4" :class="compare ? 'md:grid-cols-2' : 'grid-cols-1'">
      <div v-for="p in panels" :key="p.key" class="card rounded-2xl p-5 space-y-4">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold px-2 py-0.5 rounded bg-panel2 text-muted uppercase">{{ p.key === 'a' ? '文件 A' : '文件 B' }}</span>
          <span class="text-brand text-xs cursor-pointer" @click="pick(p.key)">选择文件</span>
        </div>

        <div class="rounded-xl border border-panel2 bg-ink/40 px-4 py-3 text-sm break-all">
          {{ p.slot.file || "未选择文件" }}
        </div>

        <div v-if="p.slot.probing" class="text-sm text-muted">读取中…</div>
        <div v-else-if="p.slot.err" class="text-sm text-red-400">{{ p.slot.err }}</div>
        <div v-else-if="p.slot.info" class="space-y-4">
          <div class="grid grid-cols-3 gap-3 text-center">
            <div class="rounded-lg bg-ink/50 py-2">
              <div class="text-[11px] text-muted">封装</div>
              <div class="text-sm font-semibold truncate">{{ p.slot.info.formatName || "—" }}</div>
            </div>
            <div class="rounded-lg bg-ink/50 py-2">
              <div class="text-[11px] text-muted">时长</div>
              <div class="text-sm font-semibold">{{ fmtDuration(p.slot.info.duration) }}</div>
            </div>
            <div class="rounded-lg bg-ink/50 py-2">
              <div class="text-[11px] text-muted">大小</div>
              <div class="text-sm font-semibold">{{ fmtBytes(p.slot.info.size) }}</div>
            </div>
          </div>

          <div>
            <div class="text-xs text-muted mb-2">流（{{ p.slot.info.streams.length }}）</div>
            <div class="space-y-2 max-h-80 overflow-y-auto pr-1">
              <div
                v-for="st in p.slot.info.streams"
                :key="st.index"
                class="rounded-lg bg-ink/50 px-3 py-2 text-sm flex items-start gap-3"
              >
                <span
                  class="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded mt-0.5"
                  :class="{
                    'bg-brand/20 text-brand': st.codecType === 'video',
                    'bg-emerald-500/20 text-emerald-400': st.codecType === 'audio',
                    'bg-amber-500/20 text-amber-400': st.codecType === 'subtitle',
                    'bg-panel2 text-muted': st.codecType !== 'video' && st.codecType !== 'audio' && st.codecType !== 'subtitle',
                  }"
                >{{ TYPE_LABEL[st.codecType] || st.codecType }}</span>
                <div class="min-w-0 flex-1">
                  <div class="font-medium truncate">#{{ st.index }} {{ st.codecName }}</div>
                  <div class="text-xs text-muted truncate">{{ streamDetail(st) }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div v-else class="text-sm text-muted">选择一个媒体文件以查看其详细信息。</div>
      </div>
    </div>
  </div>
</template>
