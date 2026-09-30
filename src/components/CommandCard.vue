<script setup lang="ts">
import { ref, computed } from "vue";
import { queueTask, inputCwd, resolveFfmpeg } from "../store";

const props = defineProps<{
  title: string;
  command: string;
  taskName?: string;
  cwd?: string;
}>();

const emit = defineEmits<{ (e: "copied"): void }>();
const copied = ref(false);

/** 预览/复制/入队统一用真实引擎路径，而不是写死的 `ffmpeg` */
const shown = computed(() => resolveFfmpeg(props.command));

function flash() {
  copied.value = true;
  emit("copied");
  setTimeout(() => (copied.value = false), 1500);
}

function copy() {
  const text = shown.value;
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(flash).catch(fallback);
  } else fallback();
}
function fallback() {
  const ta = document.createElement("textarea");
  ta.value = shown.value;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
    flash();
  } catch {
    /* 忽略 */
  }
  document.body.removeChild(ta);
}

function run() {
  queueTask(props.taskName || props.title, shown.value, props.cwd ?? inputCwd());
}
</script>

<template>
  <div class="card rounded-2xl p-5">
    <div class="flex items-center justify-between mb-3">
      <h3 class="font-semibold text-sm">{{ title }}</h3>
      <button class="text-xs cursor-pointer" :class="copied ? 'text-brand' : 'text-muted hover:text-brand'" @click="copy">{{ copied ? "已复制" : "复制" }}</button>
    </div>
    <pre
      class="cmd bg-ink/70 rounded-xl p-3 text-brand whitespace-pre-wrap break-all"
    >{{ shown }}</pre>
    <slot name="actions">
      <button
        class="mt-3 w-full py-2.5 rounded-lg bg-brand text-white font-bold hover:bg-brandd transition-colors cursor-pointer"
        @click="run"
      >
        加入队列并运行
      </button>
    </slot>
  </div>
</template>
