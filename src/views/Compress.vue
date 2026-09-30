<script setup lang="ts">
import { reactive, computed } from "vue";
import { store, saveSettings } from "../store";
import { buildCompress } from "../lib/ffmpeg";
import CommandCard from "../components/CommandCard.vue";
import SegGroup from "../components/SegGroup.vue";

// CRF 与「设置 → 默认输出 → 默认 CRF」共用同一个值
const s = reactive({ preset: "medium", res: "", bitrate: "" });
const inputName = computed(() => store.inputFile || "input.mp4");
const cmd = computed(() =>
  buildCompress({ input: inputName.value, crf: store.crf, preset: s.preset, res: s.res, bitrate: s.bitrate })
);
</script>

<template>
  <div class="space-y-6">
    <CommandCard title="压缩优化 · 命令预览" :command="cmd" task-name="压缩优化" />

    <div class="card rounded-2xl p-5 space-y-6">
      <div>
        <div class="flex justify-between text-sm mb-1">
          <span class="font-semibold">CRF 恒定质量</span>
          <span class="text-brand font-bold">{{ store.crf }}</span>
        </div>
        <input type="range" min="18" max="35" v-model.number="store.crf" @change="saveSettings()" class="slider w-full" />
        <div class="flex justify-between text-xs text-muted">
          <span>18 高画质</span><span>35 高压缩</span>
        </div>
      </div>

      <div>
        <div class="text-sm font-semibold mb-2">编码预设 (速度 / 压缩率)</div>
        <SegGroup
          v-model="s.preset"
          :options="[
            { value: 'ultrafast', label: 'ultrafast' },
            { value: 'fast', label: 'fast' },
            { value: 'medium', label: 'medium' },
            { value: 'slow', label: 'slow' },
            { value: 'veryslow', label: 'veryslow' },
          ]"
        />
      </div>

      <div class="grid md:grid-cols-2 gap-4">
        <div>
          <label class="text-xs text-muted">最大分辨率</label>
          <select v-model="s.res" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none">
            <option value="">保持原始</option>
            <option value="1920:1080">1080p</option>
            <option value="1280:720">720p</option>
            <option value="854:480">480p</option>
          </select>
        </div>
        <div>
          <label class="text-xs text-muted">目标码率 (可选)</label>
          <input v-model="s.bitrate" placeholder="如 2M，留空按 CRF" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none" />
        </div>
      </div>

      <div class="rounded-xl bg-ink/50 p-4 flex items-center justify-between text-sm">
        <div>
          <div class="text-muted text-xs">预估输出</div>
          <div class="font-bold mt-0.5">约 42 MB <span class="text-muted font-normal">↓ 节省 63%</span></div>
        </div>
        <div class="text-right">
          <div class="text-muted text-xs">编码时间</div>
          <div class="font-bold mt-0.5">约 3 分 20 秒</div>
        </div>
      </div>
    </div>
  </div>
</template>
