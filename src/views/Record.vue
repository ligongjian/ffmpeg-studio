<script setup lang="ts">
import { reactive, computed } from "vue";
import { buildRecord } from "../lib/ffmpeg";
import { queueTask, resolveFfmpeg } from "../store";
import CommandCard from "../components/CommandCard.vue";
import SegGroup from "../components/SegGroup.vue";

const s = reactive({ src: "screen", src2: "显示器 1 (1920×1080)", fps: "30", fmt: "mp4", aud: "系统 + 麦克风" });
const cmd = computed(() => buildRecord({ src: s.src as "screen" | "cam" | "both", fps: s.fps, fmt: s.fmt, aud: s.aud }));

function start() {
  queueTask("录制: " + (s.src === "screen" ? "屏幕" : s.src === "cam" ? "摄像头" : "画中画"), resolveFfmpeg(cmd.value));
}
</script>

<template>
  <div class="space-y-6">
    <CommandCard title="录制采集 · 命令预览" :command="cmd" task-name="录制采集" />

    <div class="card rounded-2xl p-5 space-y-5">
      <SegGroup
        v-model="s.src"
        :options="[
          { value: 'screen', label: '屏幕录制' },
          { value: 'cam', label: '摄像头' },
          { value: 'both', label: '画中画' },
        ]"
      />
      <div class="grid md:grid-cols-2 gap-4">
        <div>
          <label class="text-xs text-muted">视频源</label>
          <select v-model="s.src2" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none">
            <option>显示器 1 (1920×1080)</option><option>显示器 2</option>
          </select>
        </div>
        <div>
          <label class="text-xs text-muted">音频源</label>
          <select v-model="s.aud" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none">
            <option>系统音频</option><option>麦克风</option><option>系统 + 麦克风</option><option>无声</option>
          </select>
        </div>
        <div>
          <label class="text-xs text-muted">帧率</label>
          <select v-model="s.fps" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none">
            <option>30</option><option>60</option><option>24</option>
          </select>
        </div>
        <div>
          <label class="text-xs text-muted">输出格式</label>
          <select v-model="s.fmt" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none">
            <option>mp4</option><option>mkv</option><option>mov</option>
          </select>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <button
          class="px-5 py-2.5 rounded-lg bg-brand text-white font-bold hover:bg-brandd transition-colors cursor-pointer flex items-center gap-2"
          @click="start"
        >
          <span class="w-2.5 h-2.5 rounded-full bg-ink"></span>开始录制
        </button>
        <span class="text-xs text-muted">00:00:00</span>
      </div>
    </div>
  </div>
</template>
