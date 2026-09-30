<script setup lang="ts">
import { reactive, computed, ref } from "vue";
import { store } from "../store";
import { buildFilters, filterList } from "../lib/ffmpeg";
import CommandCard from "../components/CommandCard.vue";

const active = reactive<Record<string, boolean>>({});
const custom = ref("");

const inputName = computed(() => store.inputFile || "input.mp4");
const cmd = computed(() => buildFilters({ active: active as Record<string, boolean>, custom: custom.value }, inputName.value));

const filters = filterList();
</script>

<template>
  <div class="space-y-6">
    <CommandCard title="滤镜调色 · 命令预览" :command="cmd" task-name="滤镜调色" />

    <div class="card rounded-2xl p-5">
      <h3 class="font-semibold mb-4">滤镜链 (可叠加)</h3>
      <div class="grid sm:grid-cols-2 gap-3">
        <button
          v-for="f in filters"
          :key="f[0]"
          class="filter-chip rounded-xl border border-panel2 bg-ink/40 px-4 py-3 text-left hover:border-brand transition-colors cursor-pointer"
          :class="{ active: active[f[0]] }"
          @click="active[f[0]] = !active[f[0]]"
        >
          <div class="font-medium text-sm">{{ f[1] }}</div>
          <div class="text-[11px] text-muted font-mono truncate">{{ f[2] }}</div>
        </button>
      </div>
      <div class="mt-5">
        <label class="text-xs text-muted">自定义滤镜参数 (高级)</label>
        <input
          v-model="custom"
          placeholder="如 eq=brightness=0.1:contrast=1.2"
          class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none font-mono"
        />
      </div>
    </div>
  </div>
</template>
