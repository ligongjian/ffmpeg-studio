<script setup lang="ts">
import { reactive, computed } from "vue";
import { store } from "../store";
import { buildWatermark } from "../lib/ffmpeg";
import CommandCard from "../components/CommandCard.vue";
import SegGroup from "../components/SegGroup.vue";

const s = reactive({
  tab: "image",
  pos: "右下",
  opacity: 100,
  text: "Demo",
  fontsize: 28,
  color: "white",
});
const POS = ["左上", "右上", "左下", "右下", "居中"];
const inputName = computed(() => store.inputFile || "in.mp4");
const cmd = computed(() =>
  buildWatermark({
    tab: s.tab as "image" | "text" | "sub",
    input: inputName.value,
    pos: s.pos,
    opacity: s.opacity,
    text: s.text,
    fontsize: s.fontsize,
    color: s.color,
  })
);
</script>

<template>
  <div class="space-y-6">
    <CommandCard title="水印字幕 · 命令预览" :command="cmd" task-name="水印字幕" />

    <div class="card rounded-2xl p-5 space-y-5">
      <SegGroup
        v-model="s.tab"
        :options="[
          { value: 'image', label: '图片水印' },
          { value: 'text', label: '文字水印' },
          { value: 'sub', label: '硬字幕' },
        ]"
      />

      <div class="space-y-4 text-sm" v-if="s.tab === 'image'">
        <div>
          <label class="text-xs text-muted">水印图片</label>
          <div class="mt-1 rounded-lg border border-panel2 bg-ink/40 px-4 py-3 flex justify-between">
            <span>logo.png</span><span class="text-brand cursor-pointer">选择</span>
          </div>
        </div>
        <div>
          <label class="text-xs text-muted">位置</label>
          <div class="flex flex-wrap gap-1.5 mt-1">
            <button
              v-for="p in POS"
              :key="p"
              class="seg-btn px-3 py-1 rounded-md border border-panel2 text-xs"
              :class="{ active: s.pos === p }"
              @click="s.pos = p"
            >
              {{ p }}
            </button>
          </div>
        </div>
        <div>
          <label class="text-xs text-muted">不透明度 <span>{{ s.opacity }}</span>%</label>
          <input type="range" min="10" max="100" v-model.number="s.opacity" class="slider w-full" />
        </div>
      </div>

      <div class="space-y-4 text-sm" v-else-if="s.tab === 'text'">
        <div>
          <label class="text-xs text-muted">文字内容</label>
          <input v-model="s.text" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 focus:border-brand outline-none" />
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div><label class="text-xs text-muted">字号</label><input v-model.number="s.fontsize" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 focus:border-brand outline-none" /></div>
          <div><label class="text-xs text-muted">颜色</label><input v-model="s.color" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 focus:border-brand outline-none" /></div>
        </div>
      </div>

      <div class="space-y-3 text-sm" v-else>
        <div>
          <label class="text-xs text-muted">字幕文件</label>
          <div class="mt-1 rounded-lg border border-panel2 bg-ink/40 px-4 py-3 flex justify-between">
            <span>sub.srt</span><span class="text-brand cursor-pointer">选择</span>
          </div>
        </div>
        <label class="flex items-center gap-2"><input type="checkbox" class="accent-brand" checked /> 烧毁字幕 (硬字幕)</label>
      </div>
    </div>
  </div>
</template>
