<script setup lang="ts">
import { reactive, ref, computed } from "vue";
import { store } from "../store";
import { buildCut } from "../lib/ffmpeg";
import { hms2s, s2hms } from "../lib/format";
import CommandCard from "../components/CommandCard.vue";
import SegGroup from "../components/SegGroup.vue";

const TL_TOTAL = 252; // 00:04:12
const s = reactive({ start: "00:00:25", end: "00:02:30", dur: "00:02:05", mode: "re" });
const tlPhase = ref(0);

const inputName = computed(() => store.inputFile || "input.mp4");
const cmd = computed(() => buildCut({ input: inputName.value, start: s.start, end: s.end, mode: s.mode as "re" | "copy" }));

const bandStyle = computed(() => {
  const i = Math.min(hms2s(s.start), TL_TOTAL);
  const o = Math.max(hms2s(s.end), i);
  const ip = (i / TL_TOTAL) * 100;
  const op = (o / TL_TOTAL) * 100;
  return { left: ip + "%", right: 100 - op + "%" };
});
const inStyle = computed(() => ({ left: (Math.min(hms2s(s.start), TL_TOTAL) / TL_TOTAL) * 100 + "%" }));
const outStyle = computed(() => ({ left: (Math.min(hms2s(s.end), TL_TOTAL) / TL_TOTAL) * 100 + "%" }));

function onClickTimeline(e: MouseEvent) {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const pct = (e.clientX - r.left) / r.width;
  const sec = Math.round(pct * TL_TOTAL);
  if (tlPhase.value === 0) {
    s.start = s2hms(sec);
    tlPhase.value = 1;
  } else {
    const ins = hms2s(s.start);
    s.end = s2hms(Math.max(sec, ins + 1));
    tlPhase.value = 0;
  }
  s.dur = s2hms(Math.max(0, hms2s(s.end) - hms2s(s.start)));
}
function onStartEnd() {
  tlPhase.value = 0;
  s.dur = s2hms(Math.max(0, hms2s(s.end) - hms2s(s.start)));
}
function onDur() {
  const d = hms2s(s.dur);
  s.end = s2hms(hms2s(s.start) + d);
  tlPhase.value = 0;
}
</script>

<template>
  <div class="space-y-6">
    <CommandCard title="剪辑分割 · 命令预览" :command="cmd" task-name="剪辑分割" />

    <div class="card rounded-2xl p-5">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-semibold">时间轴剪辑</h3>
        <span class="text-xs text-muted">总时长 00:04:12</span>
      </div>
      <div
        class="relative h-12 rounded-lg bg-ink/60 overflow-hidden cursor-pointer select-none"
        role="group"
        aria-label="剪辑时间轴，点击设置入点或出点"
        @click="onClickTimeline"
      >
        <div class="absolute inset-y-0 bg-brand/25 border-x-2 border-brand" :style="bandStyle"></div>
        <div class="absolute top-0 bottom-0 w-0.5 bg-brand" :style="inStyle"></div>
        <div class="absolute top-0 bottom-0 w-0.5 bg-brand" :style="outStyle"></div>
      </div>
      <div class="flex justify-between text-xs text-muted mt-1">
        <span>00:00</span><span>01:00</span><span>02:00</span><span>03:00</span><span>04:12</span>
      </div>
      <p class="text-[11px] text-muted mt-1">提示：点击时间轴先设置入点，再点击设置出点；也可直接编辑下方时间框。</p>

      <div class="grid md:grid-cols-3 gap-4 mt-5">
        <div>
          <label class="text-xs text-muted">起始 -ss</label>
          <input v-model="s.start" @input="onStartEnd" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none" />
        </div>
        <div>
          <label class="text-xs text-muted">结束 -to</label>
          <input v-model="s.end" @input="onStartEnd" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none" />
        </div>
        <div>
          <label class="text-xs text-muted">时长 -t</label>
          <input v-model="s.dur" @input="onDur" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none" />
        </div>
      </div>

      <div class="flex items-center gap-2 mt-4">
        <span class="text-xs text-muted">模式</span>
        <SegGroup
          v-model="s.mode"
          :options="[
            { value: 're', label: '重编码(精确)' },
            { value: 'copy', label: '关键帧快剪' },
          ]"
        />
      </div>
    </div>
  </div>
</template>
