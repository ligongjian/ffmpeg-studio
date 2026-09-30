<script setup lang="ts">
import { store, setTab } from "../store";
import { NAV } from "../nav";

defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();
</script>

<template>
  <aside
    class="w-64 shrink-0 bg-panel border-r border-panel2 flex flex-col fixed lg:static inset-y-0 left-0 z-30 transition-transform"
    :class="open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'"
  >
    <div class="h-16 flex items-center gap-3 px-5 border-b border-panel2">
      <div class="w-9 h-9 rounded-xl bg-brand/15 flex items-center justify-center">
        <svg class="w-5 h-5 text-brand" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M5 3l14 9-14 9V3z" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>
      <div>
        <div class="font-extrabold leading-tight">FFmpeg Studio</div>
        <div class="text-[11px] text-muted">可视化处理工作台</div>
      </div>
    </div>

    <nav class="flex-1 overflow-y-auto py-3 px-3 space-y-1 text-sm">
      <a
        v-for="n in NAV"
        :key="n.tab"
        class="nav-item flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors hover:bg-panel2/50"
        :class="{ 'nav-active': store.tab === n.tab }"
        tabindex="0"
        @click="setTab(n.tab); emit('close')"
        @keydown.enter.prevent="setTab(n.tab); emit('close')"
        @keydown.space.prevent="setTab(n.tab); emit('close')"
      >
        <span class="nav-ico text-muted" v-html="`<svg class='w-[18px] h-[18px]' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'>${n.icon}</svg>`"></span>
        <span class="truncate">{{ n.label }}</span>
        <span
          v-if="n.tab === 'tasks' && store.tasks.filter((t) => t.status === 'running').length > 0"
          class="ml-auto text-[11px] font-semibold text-white bg-brand rounded-full min-w-[18px] h-[18px] px-1.5 flex items-center justify-center"
        >{{ store.tasks.filter((t) => t.status === 'running').length }}</span>
      </a>
    </nav>

    <div class="p-3 border-t border-panel2 flex items-center gap-3">
      <button
        class="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-muted hover:text-chalk hover:bg-panel2/50 transition-colors cursor-pointer"
        title="设置"
        @click="setTab('settings'); emit('close')"
      >
        <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3" />
          <path
            d="M19 12a7 7 0 00-.1-1l2-1.5-2-3.5-2.4 1a7 7 0 00-1.7-1L14.5 3h-5l-.3 2.5a7 7 0 00-1.7 1l-2.4-1-2 3.5L3 11a7 7 0 000 2l-2 1.5 2 3.5 2.4-1a7 7 0 001.7 1l.3 2.5h5l.3-2.5a7 7 0 001.7-1l2.4 1 2-3.5L21 13a7 7 0 00.1-1z"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <div
        class="flex items-center gap-2 text-xs text-muted cursor-pointer hover:text-chalk transition-colors min-w-0 truncate"
        @click="setTab('settings'); emit('close')"
      >
        <span class="w-2 h-2 rounded-full shrink-0" :class="store.engineOk ? 'bg-brand' : 'bg-red-500'"></span>
        <span class="truncate">{{ store.engineOk ? 'FFmpeg · 已就绪' : 'FFmpeg 不可用' }}</span>
      </div>
    </div>
  </aside>
</template>
