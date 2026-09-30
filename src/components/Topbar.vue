<script setup lang="ts">
import { computed } from "vue";
import { store, toggleTheme, setTab } from "../store";
// 标题表由 nav.ts 的单一数据源生成：新增模块不会再出现「侧栏有、顶栏 fallback」的不同步
import { TITLES } from "../nav";

const emit = defineEmits<{ (e: "toggle-sidebar"): void }>();

const title = computed(() => TITLES[store.tab]?.[0] ?? "FFmpeg Studio");
const sub = computed(() => TITLES[store.tab]?.[1] ?? "");
const badge = computed(() => store.tasks.length);
</script>

<template>
  <!-- bg-panel/80 而非 /60：页面底色比卡片更暗，半透明比例越低顶栏越被衬得发灰 -->
  <header class="h-16 shrink-0 flex items-center justify-between px-6 border-b border-panel2 bg-panel/80 backdrop-blur">
    <div class="flex items-center gap-3">
      <button
        class="lg:hidden w-9 h-9 rounded-lg border border-panel2 flex items-center justify-center hover:border-brand transition-colors cursor-pointer"
        title="菜单"
        @click="emit('toggle-sidebar')"
      >
        <svg class="w-[18px] h-[18px] text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 6h16M4 12h16M4 18h16" stroke-linecap="round" />
        </svg>
      </button>
      <h1 class="font-bold text-lg leading-tight">{{ title }}</h1>
      <p class="text-xs text-muted">{{ sub }}</p>
    </div>
    <div class="flex items-center gap-2">
      <button
        class="w-9 h-9 rounded-lg border border-panel2 flex items-center justify-center hover:border-brand transition-colors cursor-pointer"
        title="切换主题"
        @click="toggleTheme()"
      >
        <svg class="w-[18px] h-[18px] text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 12.8A9 9 0 1111.2 3 7 7 0 0021 12.8z" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <button
        class="relative w-9 h-9 rounded-lg border border-panel2 flex items-center justify-center hover:border-brand transition-colors cursor-pointer"
        title="任务队列"
        @click="setTab('tasks')"
      >
        <svg class="w-[18px] h-[18px] text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 6h16M4 12h16M4 18h10" stroke-linecap="round" />
        </svg>
        <span
          v-if="badge > 0"
          class="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-brand text-white text-[10px] font-bold flex items-center justify-center"
          >{{ badge }}</span
        >
      </button>
    </div>
  </header>
</template>
