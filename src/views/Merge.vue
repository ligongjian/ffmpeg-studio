<script setup lang="ts">
import { reactive, computed, ref } from "vue";
import { buildMerge } from "../lib/ffmpeg";
import { invoke } from "@tauri-apps/api/core";
import CommandCard from "../components/CommandCard.vue";
import SegGroup from "../components/SegGroup.vue";

const s = reactive({ mode: "concat" });

let seq = 0;
const files = reactive<{ id: number; name: string; dur: string }[]>([
  { id: seq++, name: "intro.mp4", dur: "00:00:12" },
  { id: seq++, name: "main.mp4", dur: "00:08:40" },
  { id: seq++, name: "outro.mp4", dur: "00:00:18" },
]);

const cmd = computed(() =>
  buildMerge({ mode: s.mode as "concat" | "filter", files: files.map((f) => f.name) })
);
/** concat 模式真正消费的是 list.txt，这里把顺序如实展示出来 */
const listTxt = computed(() => files.map((f) => `file '${f.name}'`).join("\n"));

async function addFiles() {
  try {
    const picked = await invoke<string[]>("pick_files");
    picked.forEach((p) => files.push({ id: seq++, name: p.split(/[\\/]/).pop() || p, dur: "—" }));
  } catch (e) {
    console.error(e);
  }
}

// 页内拖拽排序：Tauri 只拦截「系统文件拖入窗口」，元素之间的 HTML5 拖放照常工作
const dragId = ref<number | null>(null);
const overId = ref<number | null>(null);

function onDragStart(id: number, e: DragEvent) {
  dragId.value = id;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(id)); // 部分引擎要求设置数据才会触发拖拽
  }
}
function onDragOver(id: number) {
  if (dragId.value !== null && dragId.value !== id) overId.value = id;
}
function onDrop(id: number) {
  const from = files.findIndex((f) => f.id === dragId.value);
  const to = files.findIndex((f) => f.id === id);
  if (from !== -1 && to !== -1 && from !== to) {
    const [moved] = files.splice(from, 1);
    files.splice(to, 0, moved);
  }
  onDragEnd();
}
function onDragEnd() {
  dragId.value = null;
  overId.value = null;
}
</script>

<template>
  <div class="space-y-6">
    <CommandCard title="拼接合并 · 命令预览" :command="cmd" task-name="拼接合并" />

    <div class="card rounded-2xl p-5">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-semibold">文件列表</h3>
        <span class="text-xs text-muted">按住 ⠿ 拖动排序</span>
      </div>
      <div class="space-y-2">
        <div
          v-for="f in files"
          :key="f.id"
          class="flex items-center gap-3 rounded-lg bg-ink/50 px-4 py-3 text-sm transition-colors"
          :class="{ 'opacity-40': dragId === f.id, 'ring-1 ring-brand': overId === f.id }"
          draggable="true"
          @dragstart="onDragStart(f.id, $event)"
          @dragover.prevent="onDragOver(f.id)"
          @drop.prevent="onDrop(f.id)"
          @dragend="onDragEnd"
        >
          <span class="text-muted cursor-move select-none">⠿</span>
          <span class="flex-1 truncate">{{ f.name }}</span>
          <span class="text-muted text-xs">{{ f.dur }}</span>
        </div>
      </div>
      <button
        class="mt-3 w-full border border-dashed border-panel2 rounded-lg py-2.5 text-sm text-muted hover:border-brand hover:text-brand transition-colors cursor-pointer"
        @click="addFiles"
      >
        + 添加文件
      </button>

      <div v-if="s.mode === 'concat'" class="mt-4">
        <div class="text-xs text-muted mb-1">list.txt（顺序即合并顺序，拖动上方条目即可调整）</div>
        <pre class="cmd bg-ink/70 rounded-lg p-3 text-brand whitespace-pre-wrap break-all">{{ listTxt }}</pre>
      </div>

      <div class="flex items-center gap-2 mt-4">
        <span class="text-xs text-muted">合并方式</span>
        <SegGroup
          v-model="s.mode"
          :options="[
            { value: 'concat', label: '流拼接(同编码)' },
            { value: 'filter', label: '滤镜拼接(任意)' },
          ]"
        />
      </div>
    </div>
  </div>
</template>
