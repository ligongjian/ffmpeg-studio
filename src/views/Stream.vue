<script setup lang="ts">
import { reactive, computed } from "vue";
import { store } from "../store";
import { buildStream } from "../lib/ffmpeg";
import CommandCard from "../components/CommandCard.vue";
import SegGroup from "../components/SegGroup.vue";

const s = reactive({
  mode: "push",
  proto: "RTMP",
  url: "rtmp://live.example.com/app/stream",
  vbr: "4000k",
  abr: "128k",
});
const inputName = computed(() => store.inputFile || "input.mp4");
const cmd = computed(() =>
  buildStream({
    mode: s.mode as "push" | "pull",
    proto: s.proto,
    url: s.url,
    vbr: s.vbr,
    abr: s.abr,
    input: inputName.value,
  })
);
</script>

<template>
  <div class="space-y-6">
    <CommandCard title="流媒体 · 命令预览" :command="cmd" task-name="流媒体" />

    <div class="card rounded-2xl p-5 space-y-5">
      <SegGroup
        v-model="s.mode"
        :options="[
          { value: 'push', label: '推流' },
          { value: 'pull', label: '拉流录制' },
        ]"
      />
      <div class="grid md:grid-cols-2 gap-4">
        <div class="md:col-span-2">
          <label class="text-xs text-muted">协议 / 地址</label>
          <select v-model="s.proto" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none">
            <option>RTMP</option><option>HLS</option><option>RTSP</option><option>HTTP-FLV</option>
          </select>
        </div>
        <div class="md:col-span-2">
          <label class="text-xs text-muted">服务器地址</label>
          <input v-model="s.url" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none font-mono" />
        </div>
        <div>
          <label class="text-xs text-muted">视频码率</label>
          <input v-model="s.vbr" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none" />
        </div>
        <div>
          <label class="text-xs text-muted">音频码率</label>
          <input v-model="s.abr" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none" />
        </div>
      </div>
    </div>
  </div>
</template>
