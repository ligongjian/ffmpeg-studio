<script setup lang="ts">
import { reactive, computed } from "vue";
import { store } from "../store";
import { buildExtract, type ExtractOpts } from "../lib/ffmpeg";
import CommandCard from "../components/CommandCard.vue";
import SegGroup from "../components/SegGroup.vue";

const s = reactive({ tab: "audio" });
const inputName = computed(() => store.inputFile || "input.mp4");
const cmd = computed(() => buildExtract({ tab: s.tab as ExtractOpts["tab"], input: inputName.value }));
</script>

<template>
  <div class="space-y-6">
    <CommandCard title="提取分离 · 命令预览" :command="cmd" task-name="提取分离" />

    <div class="card rounded-2xl p-5">
      <SegGroup
        v-model="s.tab"
        :options="[
          { value: 'audio', label: '提取音频' },
          { value: 'video', label: '提取视频' },
          { value: 'frame', label: '抽取帧' },
          { value: 'thumb', label: '缩略图' },
        ]"
      />

      <div class="space-y-4 text-sm mt-5">
        <template v-if="s.tab === 'audio'">
          <label class="flex items-center gap-2"><input type="checkbox" class="accent-brand" checked /> 保留原始编码 (无损 -c:a copy)</label>
          <div>
            <label class="text-xs text-muted">转码为</label>
            <select class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 focus:border-brand outline-none">
              <option>AAC (.m4a)</option><option>MP3</option><option>FLAC</option><option>Opus</option>
            </select>
          </div>
        </template>
        <template v-else-if="s.tab === 'video'">
          <label class="flex items-center gap-2"><input type="checkbox" class="accent-brand" checked /> 去除音频 (-an)</label>
          <div>
            <label class="text-xs text-muted">视频编码</label>
            <select class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 focus:border-brand outline-none">
              <option>拷贝 (不重编码)</option><option>H.264</option>
            </select>
          </div>
        </template>
        <template v-else-if="s.tab === 'frame'">
          <div class="grid grid-cols-2 gap-4">
            <div><label class="text-xs text-muted">时间点 -ss</label><input value="00:00:05" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 focus:border-brand outline-none" /></div>
            <div><label class="text-xs text-muted">输出格式</label><select class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 focus:border-brand outline-none"><option>PNG</option><option>JPG</option></select></div>
          </div>
        </template>
        <template v-else>
          <div class="grid grid-cols-2 gap-4">
            <div><label class="text-xs text-muted">间隔 (秒/帧)</label><input value="10" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 focus:border-brand outline-none" /></div>
            <div><label class="text-xs text-muted">命名</label><input value="thumb_%03d.png" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 focus:border-brand outline-none font-mono" /></div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
