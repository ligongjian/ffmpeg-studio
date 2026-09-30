<script setup lang="ts">
import { reactive, computed } from "vue";
import { buildBatch } from "../lib/ffmpeg";
import { invoke } from "@tauri-apps/api/core";
import { queueTasks, resolveFfmpeg } from "../store";
import { dirOf, baseName } from "../lib/format";

const s = reactive({ files: [] as string[], op: "convert", fmt: "mp4", outDir: "./output" });
const cmds = computed(() =>
  buildBatch({ files: s.files, op: s.op as "convert" | "compress" | "extract" | "thumb", fmt: s.fmt })
);
const previewCmds = computed(() => cmds.value.map(resolveFfmpeg));

async function addFiles() {
  try {
    const picked = await invoke<string[]>("pick_files");
    if (picked.length) s.files.push(...picked);
  } catch (e) {
    console.error(e);
  }
}
function runBatch() {
  if (!s.files.length) return;
  const cwd = s.files.length ? dirOf(s.files[0]) || undefined : undefined;
  queueTasks(
    cmds.value.map((c, i) => ({
      name: "批量: " + (baseName(s.files[i]) || s.files[i]),
      cmd: resolveFfmpeg(c),
      cwd,
    }))
  );
}
</script>

<template>
  <div class="space-y-6">
    <div class="card rounded-2xl p-5 space-y-4">
      <div
        class="rounded-xl border-2 border-dashed border-panel2 bg-ink/40 p-6 text-center cursor-pointer hover:border-brand transition-colors"
        @click="addFiles"
      >
        <div class="font-semibold">+ 添加多个文件进行批量处理</div>
        <div class="text-xs text-muted mt-1">已选择 <span>{{ s.files.length }}</span> 个文件</div>
      </div>
      <div class="grid md:grid-cols-3 gap-4 text-sm">
        <div>
          <label class="text-xs text-muted">批量操作</label>
          <select v-model="s.op" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 focus:border-brand outline-none">
            <option value="convert">统一转格式</option>
            <option value="compress">统一压缩</option>
            <option value="extract">批量提取音频</option>
            <option value="thumb">批量缩略图</option>
          </select>
        </div>
        <div>
          <label class="text-xs text-muted">目标格式</label>
          <select v-model="s.fmt" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 focus:border-brand outline-none">
            <option value="mp4">mp4</option><option value="mkv">mkv</option><option value="mp3">mp3</option><option value="webm">webm</option>
          </select>
        </div>
        <div>
          <label class="text-xs text-muted">输出目录</label>
          <input v-model="s.outDir" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 focus:border-brand outline-none font-mono" />
        </div>
      </div>
      <button
        class="w-full py-3 rounded-lg bg-brand text-white font-bold hover:bg-brandd transition-colors cursor-pointer"
        @click="runBatch"
      >
        开始批量处理{{ s.files.length ? `（${s.files.length} 个任务）` : "" }}
      </button>
    </div>

    <div class="card rounded-2xl p-5" v-if="cmds.length">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-semibold text-sm">批量处理 · 命令预览（{{ cmds.length }} 条）</h3>
      </div>
      <pre
        v-for="(c, i) in previewCmds"
        :key="i"
        class="cmd bg-ink/70 rounded-xl p-3 mb-2 whitespace-pre-wrap break-all"
      >{{ c }}</pre>
    </div>
  </div>
</template>
