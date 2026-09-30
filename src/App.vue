<script setup lang="ts">
import { ref } from "vue";
import { store } from "./store";
import Sidebar from "./components/Sidebar.vue";
import Topbar from "./components/Topbar.vue";
import Dashboard from "./views/Dashboard.vue";
import Convert from "./views/Convert.vue";
import Compress from "./views/Compress.vue";
import Cut from "./views/Cut.vue";
import Merge from "./views/Merge.vue";
import Extract from "./views/Extract.vue";
import Watermark from "./views/Watermark.vue";
import Filters from "./views/Filters.vue";
import Record from "./views/Record.vue";
import Stream from "./views/Stream.vue";
import Batch from "./views/Batch.vue";
import Audio from "./views/Audio.vue";
import Gif from "./views/Gif.vue";
import Info from "./views/Info.vue";
import Settings from "./views/Settings.vue";
import Tasks from "./views/Tasks.vue";

const sidebarOpen = ref(false);
function toggleSidebar() {
  sidebarOpen.value = !sidebarOpen.value;
}
</script>

<template>
  <a href="#content" class="skip-link bg-brand text-white px-4 py-2 rounded-lg text-sm font-bold shadow-glow">跳到主内容</a>
  <!-- 根节点显式铺 bg-ink：窗口底色是白色，任何未绘制区域都会露白（暗色下尤其明显） -->
  <div class="flex h-screen overflow-hidden bg-ink">
    <Sidebar :open="sidebarOpen" @close="sidebarOpen = false" />
    <div
      v-if="sidebarOpen"
      class="fixed inset-0 z-20 bg-black/50 lg:hidden"
      @click="sidebarOpen = false"
    ></div>

    <main class="flex-1 flex flex-col min-w-0">
      <Topbar @toggle-sidebar="toggleSidebar" />

      <!-- 各视图常驻挂载、靠 v-show 切换。注意：视图组件必须保持「单根」，
           多根（Fragment）模板会让 v-show 这类运行时指令失效，导致内容泄漏到所有页面。 -->
      <div class="flex-1 overflow-y-auto p-6" id="content">
        <Dashboard v-show="store.tab === 'dashboard'" />
        <Convert v-show="store.tab === 'convert'" />
        <Compress v-show="store.tab === 'compress'" />
        <Cut v-show="store.tab === 'cut'" />
        <Merge v-show="store.tab === 'merge'" />
        <Extract v-show="store.tab === 'extract'" />
        <Watermark v-show="store.tab === 'watermark'" />
        <Filters v-show="store.tab === 'filters'" />
        <Record v-show="store.tab === 'record'" />
        <Stream v-show="store.tab === 'stream'" />
        <Batch v-show="store.tab === 'batch'" />
        <Audio v-show="store.tab === 'audio'" />
        <Gif v-show="store.tab === 'gif'" />
        <Info v-show="store.tab === 'info'" />
        <Settings v-show="store.tab === 'settings'" />
        <Tasks v-show="store.tab === 'tasks'" />
      </div>
    </main>
  </div>

  <!-- 轻量提示：加入队列等操作的结果反馈（右下角，自动消失） -->
  <div
    v-if="store.toast.msg"
    :key="store.toast.key"
    class="toast-in fixed bottom-6 right-6 z-[80] flex items-center gap-2 max-w-xs bg-panel border border-panel2 shadow-lg rounded-xl px-4 py-3 text-sm"
  >
    <span
      class="w-2 h-2 rounded-full shrink-0"
      :class="{
        'bg-emerald-500': store.toast.type === 'success',
        'bg-brand': store.toast.type === 'info',
        'bg-red-500': store.toast.type === 'error',
      }"
    ></span>
    <span class="text-chalk/90">{{ store.toast.msg }}</span>
  </div>
</template>
