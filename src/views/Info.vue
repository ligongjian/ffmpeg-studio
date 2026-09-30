<script setup lang="ts">
import { reactive, ref, computed, watch, onMounted, onUnmounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { store, pickInput, setInputFile, type MediaInfo, type StreamInfo } from "../store";

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

/** 常见 ISO 639-2 语言码；未收录的码原样显示 */
const LANG_LABEL: Record<string, string> = {
  und: "未指定",
  eng: "英语",
  chi: "中文",
  zho: "中文",
  jpn: "日语",
  kor: "韩语",
  fre: "法语",
  fra: "法语",
  ger: "德语",
  deu: "德语",
  spa: "西班牙语",
  rus: "俄语",
};

/** 容器标签的中文名；未收录的键原样显示 */
const TAG_LABEL: Record<string, string> = {
  title: "标题",
  artist: "艺术家",
  album: "专辑",
  encoder: "编码器",
  creation_time: "创建时间",
  comment: "注释",
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
function fmtKbps(b?: number | null): string {
  if (!b) return "";
  const k = b / 1000;
  return k >= 1000 ? `${(k / 1000).toFixed(2)} Mbps` : `${Math.round(k)} kbps`;
}
function fmtFps(f?: number | null): string {
  if (!f) return "—";
  // 保留两位再去掉多余的 0：30 → "30"，29.970… → "29.97"
  return `${Number(f.toFixed(2))} fps`;
}
function langLabel(code?: string | null): string {
  if (!code) return "";
  return LANG_LABEL[code] || code;
}

/** 「3 条 · 视频 1 · 音频 1 · 字幕 1」式的流构成概览 */
function streamSummary(list: StreamInfo[]): string {
  if (!list.length) return "0 条";
  const count: Record<string, number> = {};
  for (const s of list) count[s.codecType] = (count[s.codecType] || 0) + 1;
  const parts = Object.entries(count).map(([k, v]) => `${TYPE_LABEL[k] || k} ${v}`);
  return `${list.length} 条 · ${parts.join(" · ")}`;
}

function streamDetail(st: StreamInfo): string {
  const parts: string[] = [];
  if (st.codecType === "video") {
    if (st.width && st.height) parts.push(`${st.width}×${st.height}`);
    if (st.displayAspectRatio) parts.push(`DAR ${st.displayAspectRatio}`);
    if (
      st.codedWidth &&
      st.codedHeight &&
      (st.codedWidth !== st.width || st.codedHeight !== st.height)
    ) {
      parts.push(`编码 ${st.codedWidth}×${st.codedHeight}`);
    }
    if (st.pixFmt) parts.push(st.pixFmt);
    if (st.colorSpace) parts.push(st.colorSpace);
    const fps = fmtFps(st.fps);
    if (fps !== "—") parts.push(fps);
    if (st.profile) parts.push(st.level ? `${st.profile} L${st.level}` : st.profile);
    if (st.nbFrames) parts.push(`${st.nbFrames} 帧`);
  } else if (st.codecType === "audio") {
    if (st.sampleRate) parts.push(`${(st.sampleRate / 1000).toFixed(1)} kHz`);
    if (st.channelLayout) parts.push(st.channelLayout);
    else if (st.channels) parts.push(`${st.channels} 声道`);
    if (st.sampleFmt) parts.push(st.sampleFmt);
  } else if (st.language) {
    parts.push(langLabel(st.language));
  }
  const br = fmtKbps(st.bitRate);
  if (br) parts.push(br);
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
          <div class="rounded-xl border border-panel2 overflow-hidden">
            <table class="info-table">
              <thead>
                <tr>
                  <th style="width: 92px">属性</th>
                  <th>值</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td class="k">封装格式</td>
                  <td :title="p.slot.info.formatLongName || ''">
                    {{ p.slot.info.formatName || "—" }}
                    <span v-if="p.slot.info.formatLongName" class="text-xs text-muted"> · {{ p.slot.info.formatLongName }}</span>
                  </td>
                </tr>
                <tr>
                  <td class="k">时长</td>
                  <td class="font-mono">{{ fmtDuration(p.slot.info.duration) }}</td>
                </tr>
                <tr>
                  <td class="k">文件大小</td>
                  <td class="font-mono">{{ fmtBytes(p.slot.info.size) }}</td>
                </tr>
                <tr>
                  <td class="k">分辨率</td>
                  <td class="font-mono">
                    {{ p.slot.info.videoWidth && p.slot.info.videoHeight ? `${p.slot.info.videoWidth}×${p.slot.info.videoHeight}` : "—" }}
                  </td>
                </tr>
                <tr>
                  <td class="k">帧率</td>
                  <td class="font-mono">{{ fmtFps(p.slot.info.videoFps) }}</td>
                </tr>
                <tr>
                  <td class="k">总码率</td>
                  <td class="font-mono">{{ fmtKbps(p.slot.info.bitRate || p.slot.info.videoBitrate) || "—" }}</td>
                </tr>
                <tr v-if="p.slot.info.startTime">
                  <td class="k">起始时间</td>
                  <td class="font-mono">{{ Number(p.slot.info.startTime.toFixed(3)) }} s</td>
                </tr>
                <tr>
                  <td class="k">流构成</td>
                  <td>{{ streamSummary(p.slot.info.streams) }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-if="p.slot.info.tags?.length" class="flex flex-wrap gap-2">
            <span
              v-for="t in p.slot.info.tags"
              :key="t.key"
              class="text-[11px] px-2 py-0.5 rounded bg-panel2 text-muted"
            >{{ TAG_LABEL[t.key] || t.key }}：{{ t.value }}</span>
          </div>

          <div>
            <div class="text-xs text-muted mb-2">流（{{ p.slot.info.streams.length }}）</div>
            <div class="rounded-xl border border-panel2 overflow-hidden max-h-80 overflow-y-auto">
              <table class="info-table">
                <thead>
                  <tr>
                    <th style="width: 56px">类型</th>
                    <th style="width: 30px">#</th>
                    <th>编码</th>
                    <th>详情</th>
                    <th style="width: 64px">语言</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="st in p.slot.info.streams" :key="st.index">
                    <td>
                      <span
                        class="text-[10px] font-bold px-1.5 py-0.5 rounded"
                        :class="{
                          'bg-brand/20 text-brand': st.codecType === 'video',
                          'bg-emerald-500/20 text-emerald-400': st.codecType === 'audio',
                          'bg-amber-500/20 text-amber-400': st.codecType === 'subtitle',
                          'bg-panel2 text-muted': st.codecType !== 'video' && st.codecType !== 'audio' && st.codecType !== 'subtitle',
                        }"
                      >{{ TYPE_LABEL[st.codecType] || st.codecType }}</span>
                    </td>
                    <td class="text-muted font-mono">{{ st.index }}</td>
                    <td>
                      <div class="font-medium">{{ st.codecName }}</div>
                      <div v-if="st.codecLongName" class="text-[11px] text-muted">{{ st.codecLongName }}</div>
                    </td>
                    <td>
                      <div class="text-xs text-muted">{{ streamDetail(st) }}</div>
                      <div v-if="st.title" class="text-[11px] text-muted">标题：{{ st.title }}</div>
                    </td>
                    <td class="text-xs">{{ st.language && st.language !== 'und' ? langLabel(st.language) : '—' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div v-else class="text-sm text-muted">点击上方区域或拖入一个媒体文件以查看其详细信息。</div>
      </div>
    </div>
  </div>
</template>
