<script setup lang="ts">
import { reactive, ref, computed, watch, onMounted, onUnmounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { store, pickInput, setInputFile } from "../store";

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
  // A 槽走全局输入：与工作台共享同一份源文件，换文件时由下方 watch 自动同步并重新探测
  if (slot === "a") {
    await pickInput();
    return;
  }
  // B 槽是对比用的第二份文件，独立选择，不写入全局以免污染工作台的源
  try {
    const p = await invoke<string | null>("pick_file");
    if (p) {
      b.file = p;
      await probe("b");
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

// A 槽复用工作台的当前源文件：进入页面即带入，工作台换文件时同步并重新探测
watch(
  () => store.inputFile,
  (v) => {
    a.file = v || "";
    a.info = null;
    a.err = "";
    if (v) void probe("a");
  },
  { immediate: true }
);

// 拖放区：Tauri 在 webview 层拦截系统文件拖拽，只能经由 onDragDropEvent 拿真实路径
const zoneA = ref<HTMLElement | null>(null);
const zoneB = ref<HTMLElement | null>(null);
const dragOverA = ref(false);
const dragOverB = ref(false);
const dragState = computed<Record<"a" | "b", boolean>>(() => ({
  a: dragOverA.value,
  b: dragOverB.value,
}));
let unlisten: (() => void) | null = null;

function setZone(key: "a" | "b", el: unknown) {
  const node = (el as HTMLElement | null) ?? null;
  if (key === "a") zoneA.value = node;
  else zoneB.value = node;
}

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
      dragOverA.value = inZone(zoneA.value, p.position);
      dragOverB.value = inZone(zoneB.value, p.position);
    } else if (p.type === "drop") {
      const toA = inZone(zoneA.value, p.position);
      const toB = inZone(zoneB.value, p.position);
      dragOverA.value = false;
      dragOverB.value = false;
      if (!p.paths.length) return;
      if (toA) setInputFile(p.paths[0]);
      else if (toB) {
        b.file = p.paths[0];
        void probe("b");
      }
    } else {
      dragOverA.value = false;
      dragOverB.value = false;
    }
  });
});

onUnmounted(() => {
  unlisten?.();
  unlisten = null;
});

function fileName(f: string): string {
  return f.split(/[\\/]/).pop() || f;
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
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs font-semibold px-2 py-0.5 rounded bg-panel2 text-muted uppercase">{{ p.key === 'a' ? '文件 A' : '文件 B' }}</span>
          <span v-if="p.key === 'a'" class="text-[11px] text-muted">复用工作台当前源文件</span>
        </div>

        <div
          :ref="(el) => setZone(p.key, el)"
          class="rounded-xl border-2 border-dashed px-4 py-5 text-sm flex flex-col items-center justify-center gap-2 cursor-pointer transition-all"
          :class="dragState[p.key] ? 'border-brand bg-brand/10 shadow-glow' : 'border-panel2 bg-ink/40 hover:border-brand hover:bg-brand/5 hover:shadow-glow'"
          @click="pick(p.key)"
        >
          <template v-if="p.slot.file">
            <div class="font-medium truncate max-w-full" :title="p.slot.file">{{ fileName(p.slot.file) }}</div>
            <div v-if="p.slot.info" class="text-[11px] text-muted">
              {{ fmtDuration(p.slot.info.duration) }} · {{ fmtBytes(p.slot.info.size) }} · {{ p.slot.info.streams.length }} 条流
            </div>
            <span class="text-brand text-xs">重新选择 / 拖拽替换</span>
          </template>
          <template v-else>
            <div class="font-medium">点击或拖拽选择媒体文件</div>
            <div class="text-[11px] text-muted">支持音视频 / 图片等常见格式</div>
          </template>
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
        <div v-else class="text-sm text-muted">点击上方区域或拖入一个媒体文件以查看其详细信息。</div>
      </div>
    </div>
  </div>
</template>
