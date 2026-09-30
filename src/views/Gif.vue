<script setup lang="ts">
import { reactive, computed } from "vue";
import { store, pickInput } from "../store";
import { buildGif } from "../lib/ffmpeg";
import CommandCard from "../components/CommandCard.vue";
import { baseName } from "../lib/format";

const s = reactive({ start: "", duration: "", fps: 15, width: 0, loop: 0 });

const inputName = computed(() => store.inputFile || "input.mp4");
const outputName = computed(() => {
  const base = baseName(inputName.value).replace(/\.[^./\\]+$/, "") || "output";
  return `${base}.gif`;
});
const cmd = computed(() =>
  buildGif({
    input: inputName.value,
    start: s.start,
    duration: s.duration,
    fps: s.fps,
    width: s.width,
    loop: s.loop,
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
      </div>
    </div>
  </div>
</template>
