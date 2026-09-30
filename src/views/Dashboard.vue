<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from "vue";
import { store, setTab, pickInput, setInputFile } from "../store";
import { getCurrentWebview } from "@tauri-apps/api/webview";

const QUICK: [string, string][] = [
  ["格式转换", "convert"], ["压缩优化", "compress"], ["剪辑分割", "cut"], ["拼接合并", "merge"],
  ["提取分离", "extract"], ["水印字幕", "watermark"], ["滤镜调色", "filters"], ["录制采集", "record"],
  ["流媒体", "stream"], ["批量处理", "batch"],
];

// 真实统计：全部基于 store.tasks 实时聚合（原先的「24 任务 / 3.2h / 8.4GB」是写死的假数字）
function isSameDay(ts: number, ref: Date): boolean {
  const d = new Date(ts);
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate();
}
const today = new Date();
const doneToday = computed(
  () => store.tasks.filter((t) => t.status === "done" && t.finishedAt && isSameDay(t.finishedAt, today)).length
);
const runningCount = computed(() => store.tasks.filter((t) => t.status === "running").length);
const queuedCount = computed(() => store.tasks.filter((t) => t.status === "queued").length);
const failedCount = computed(() => store.tasks.filter((t) => t.status === "failed").length);

// 拖放区：Tauri 在 webview 层拦截了系统文件拖拽，只能经由 onDragDropEvent 拿到真实路径
const zone = ref<HTMLElement | null>(null);
const dragOver = ref(false);
let unlisten: (() => void) | null = null;

/** 事件里的 position 是物理像素，换算成 CSS 像素后判断指针是否在拖放区内 */
function inZone(pos: { x: number; y: number }): boolean {
  const el = zone.value;
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
      dragOver.value = inZone(p.position);
    } else if (p.type === "drop") {
      dragOver.value = false;
      if (inZone(p.position) && p.paths.length) setInputFile(p.paths[0]);
    } else {
      dragOver.value = false;
    }
  });
});

onUnmounted(() => {
  unlisten?.();
  unlisten = null;
});
</script>

<template>
  <div class="space-y-6">
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div class="card rounded-2xl p-4">
        <div class="text-xs text-muted">今日完成</div>
        <div class="text-2xl font-extrabold mt-1">{{ doneToday }}</div>
        <div class="text-xs text-brand mt-1">已完成任务</div>
      </div>
      <div class="card rounded-2xl p-4">
        <div class="text-xs text-muted">进行中</div>
        <div class="text-2xl font-extrabold mt-1">{{ runningCount }}</div>
        <div class="text-xs text-muted mt-1">正在编码</div>
      </div>
      <div class="card rounded-2xl p-4">
        <div class="text-xs text-muted">队列中</div>
        <div class="text-2xl font-extrabold mt-1">{{ queuedCount }}</div>
        <div class="text-xs text-muted mt-1">等待开始</div>
      </div>
      <div class="card rounded-2xl p-4">
        <div class="text-xs text-muted">失败</div>
        <div class="text-2xl font-extrabold mt-1" :class="failedCount ? 'text-red-400' : ''">{{ failedCount }}</div>
        <div class="text-xs text-muted mt-1">需重试 / 处理</div>
      </div>
    </div>

    <div class="grid lg:grid-cols-3 gap-6">
      <div class="lg:col-span-2 card rounded-2xl p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-bold">快速开始</h3>
          <span class="text-xs text-muted">拖入文件或选择功能</span>
        </div>
        <div
          ref="zone"
          class="rounded-xl border-2 border-dashed border-panel2 bg-ink/40 p-8 text-center cursor-pointer hover:border-brand transition-colors"
          :class="{ 'drop-ring': dragOver }"
          @click="pickInput()"
        >
          <svg class="w-10 h-10 mx-auto text-muted mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M12 16V4m0 0L8 8m4-4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <div class="font-semibold">拖放媒体文件到这里</div>
          <div class="text-xs text-muted mt-1">
            支持 mp4 / mkv / mov / mp3 / wav / png 等（点击选择，或将文件拖入此处）
          </div>
          <div v-if="store.inputFile" class="text-xs text-brand mt-2 truncate">
            已载入：{{ store.inputFile.split(/[\\/]/).pop() }}
          </div>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          <button
            v-for="q in QUICK"
            :key="q[1]"
            class="rounded-xl border border-panel2 bg-ink/40 py-3 text-sm font-medium hover:border-brand hover:text-brand transition-colors cursor-pointer"
            @click="setTab(q[1])"
          >
            {{ q[0] }}
          </button>
        </div>
      </div>
      <div class="card rounded-2xl p-5">
        <h3 class="font-bold mb-4">最近文件</h3>
        <div v-if="store.recent.length" class="space-y-3 text-sm">
          <div v-for="r in store.recent" :key="r.path" class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-lg bg-ink/60 flex items-center justify-center text-brand">▦</div>
            <div class="flex-1 min-w-0">
              <div class="truncate font-medium">{{ r.name }}</div>
              <div class="text-xs text-muted">{{ r.time }}</div>
            </div>
            <div class="text-xs text-muted">{{ r.size }}</div>
          </div>
        </div>
        <div v-else class="text-sm text-muted">还没有文件，点击左侧拖放区选择。</div>
      </div>
    </div>
  </div>
</template>
