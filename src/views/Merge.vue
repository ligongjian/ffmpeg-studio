<script setup lang="ts">
import { reactive, computed, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { buildMerge, buildConcatList, FMT_OPTIONS, CONCAT_LIST_NAME } from "../lib/ffmpeg";
import { queueTask, resolveFfmpeg } from "../store";
import { dirOf, baseName, s2hms } from "../lib/format";
import CommandCard from "../components/CommandCard.vue";
import SegGroup from "../components/SegGroup.vue";

/** 单个合并条目：path 是真实绝对路径 */
type MergeItem = {
  id: number;
  path: string;
  name: string;
};

const s = reactive({ mode: "concat" as "concat" | "filter", fmt: "mp4" });

let seq = 0;
const files = reactive<MergeItem[]>([]);

/** 工作目录：取第一个文件的目录；都没有就用当前目录（后端会以 "" 作 cwd） */
const cwd = computed(() => (files.length ? dirOf(files[0].path) || undefined : undefined));

const cmd = computed(() =>
  buildMerge({ mode: s.mode, files: files.map((f) => f.path), fmt: s.fmt })
);

const listTxt = computed(() => buildConcatList(files.map((f) => f.path)));

/** 输出文件名预览：沿用首个源文件 basename，加 `.merged` 后缀避免与任何源同名 */
const outputName = computed(() => {
  if (!files.length) return `merged.${s.fmt}`;
  const base = baseName(files[0].path).replace(/\.[^./\\]+$/, "") || "merged";
  return `${base}.merged.${s.fmt}`;
});

const totalSec = computed(() => 0);
const totalBytes = computed(() => 0);
const totalProbing = computed(() => false);

function fmtBytes(b: number): string {
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)} GB`;
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${b} B`;
}

/** 选中文件后写入列表。不探测元信息——之前 ffprobe 调用易卡死，列表只关心路径与顺序。 */
async function addFiles() {
  try {
    const picked = await invoke<string[]>("pick_files");
    if (!picked.length) return;
    files.push(
      ...picked.map((p) => ({
        id: seq++,
        path: p,
        name: p.split(/[\\/]/).pop() || p,
      })),
    );
  } catch (e) {
    console.error(e);
  }
}

function removeFile(id: number) {
  const i = files.findIndex((f) => f.id === id);
  if (i >= 0) files.splice(i, 1);
}

function move(id: number, dir: -1 | 1) {
  const i = files.findIndex((f) => f.id === id);
  if (i < 0) return;
  const j = i + dir;
  if (j < 0 || j >= files.length) return;
  const [it] = files.splice(i, 1);
  files.splice(j, 0, it);
}

function clearAll() {
  files.splice(0, files.length);
}

/** 页内拖拽排序：Tauri 只拦截系统文件拖入，元素间的 HTML5 拖放照常用 */
const dragId = ref<number | null>(null);
const overId = ref<number | null>(null);

function onDragStart(id: number, e: DragEvent) {
  dragId.value = id;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(id));
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

/**
 * 加入队列：concat 模式必须先落地 list.txt（否则 ffmpeg 找不到 list.txt）。
 * filter 模式不需要额外文件。
 */
async function run() {
  if (files.length < 2 && s.mode === "concat") {
    alert("concat 模式至少需要 2 个文件。");
    return;
  }
  if (!files.length) {
    alert("请先添加文件。");
    return;
  }
  if (s.mode === "concat" && cwd.value) {
    try {
      await invoke("write_concat_list", {
        dir: cwd.value,
        files: files.map((f) => f.path),
      });
    } catch (e) {
      alert("写入 " + CONCAT_LIST_NAME + " 失败：" + (typeof e === "string" ? e : String(e)));
      return;
    }
  }
  queueTask("拼接合并", resolveFfmpeg(cmd.value), cwd.value);
}
</script>

<template>
  <div class="space-y-6">
    <CommandCard
      v-if="files.length"
      title="拼接合并 · 命令预览"
      :command="cmd"
      task-name="拼接合并"
      :cwd="cwd"
    >
      <template #actions>
        <button
          class="mt-3 w-full py-2.5 rounded-lg bg-brand text-white font-bold hover:bg-brandd transition-colors cursor-pointer disabled:opacity-50"
          :disabled="files.length < 2 && s.mode === 'concat'"
          @click="run"
        >
          加入队列并运行
        </button>
      </template>
    </CommandCard>
    <div v-else class="card rounded-2xl p-5">
      <h3 class="font-semibold text-sm mb-2">拼接合并 · 命令预览</h3>
      <pre class="cmd bg-ink/70 rounded-xl p-3 text-muted whitespace-pre-wrap break-all">
先添加至少 1 个文件以生成命令预览</pre>
    </div>

    <div class="card rounded-2xl p-5 space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="font-semibold">文件列表</h3>
        <div class="flex items-center gap-3 text-xs">
          <span class="text-muted">
            <template v-if="files.length">按住 ⠿ 拖动排序</template>
          </span>
          <button
            v-if="files.length"
            class="text-muted hover:text-err underline cursor-pointer"
            @click="clearAll"
          >清空</button>
        </div>
      </div>

      <div class="space-y-2">
        <div
          v-for="(f, i) in files"
          :key="f.id"
          class="flex items-center gap-3 rounded-lg bg-ink/50 px-3 py-2.5 text-sm transition-colors"
          :class="{ 'opacity-40': dragId === f.id, 'ring-1 ring-brand': overId === f.id }"
          draggable="true"
          @dragstart="onDragStart(f.id, $event)"
          @dragover.prevent="onDragOver(f.id)"
          @drop.prevent="onDrop(f.id)"
          @dragend="onDragEnd"
        >
          <span class="text-muted cursor-move select-none" aria-hidden="true">⠿</span>
          <span class="text-muted text-xs w-6 text-right">{{ i + 1 }}</span>
          <span class="flex-1 truncate" :title="f.path">
            <span class="font-medium">{{ f.name }}</span>
            <span class="text-muted"> · </span>
            <span class="text-muted text-xs">{{ f.path }}</span>
          </span>
          <button class="text-muted hover:text-brand disabled:opacity-30 cursor-pointer" :disabled="i === 0" title="上移" @click="move(f.id, -1)">↑</button>
          <button class="text-muted hover:text-brand disabled:opacity-30 cursor-pointer" :disabled="i === files.length - 1" title="下移" @click="move(f.id, 1)">↓</button>
          <button class="text-muted hover:text-err cursor-pointer" title="移除" @click="removeFile(f.id)">✕</button>
        </div>
      </div>

      <button
        class="w-full border border-dashed border-panel2 rounded-lg py-2.5 text-sm text-muted hover:border-brand hover:text-brand transition-colors cursor-pointer"
        @click="addFiles"
      >
        + 添加文件
      </button>

      <div class="grid md:grid-cols-2 gap-4">
        <div>
          <span class="text-xs text-muted">合并方式</span>
          <div class="mt-1">
            <SegGroup
              v-model="s.mode"
              :options="[
                { value: 'concat', label: '流拼接(同编码)' },
                { value: 'filter', label: '滤镜拼接(任意)' },
              ]"
            />
          </div>
          <p class="text-[11px] text-muted mt-1">
            <template v-if="s.mode === 'concat'">
              流拼接零拷贝、最快，要求所有源编码/分辨率/采样率一致；不一致请选滤镜拼接。
            </template>
            <template v-else>
              滤镜拼接会重编码（libx264 + aac），不同编码也能拼；但慢且体积略大。
            </template>
          </p>
        </div>
        <div>
          <label class="text-xs text-muted">输出容器</label>
          <select v-model="s.fmt" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none">
            <option v-for="o in FMT_OPTIONS.filter(o => !['gif','mp3'].includes(o.value))" :key="o.value" :value="o.value">
              {{ o.label }}
            </option>
          </select>
          <p class="text-[11px] text-muted mt-1">
            输出文件名：<span class="text-brand font-mono">{{ outputName }}</span>
          </p>
        </div>
      </div>

      <div v-if="s.mode === 'concat' && files.length" class="mt-2">
        <div class="text-xs text-muted mb-1">{{ CONCAT_LIST_NAME }}（顺序即合并顺序，后端写入到首文件所在目录）</div>
        <pre class="cmd bg-ink/70 rounded-lg p-3 text-brand whitespace-pre-wrap break-all">{{ listTxt }}</pre>
      </div>

      <p v-if="!files.length" class="text-[11px] text-muted">
        提示：先选择 2 个或以上的视频文件。流拼接要求所有文件编码/分辨率一致；不一致时切换「滤镜拼接」会自动重编码兼容。
      </p>
      <p v-else-if="files.length === 1" class="text-[11px] text-muted">
        当前只有 1 个文件，合并无意义——再添加一个即可，或直接使用该文件。
      </p>
    </div>
  </div>
</template>
