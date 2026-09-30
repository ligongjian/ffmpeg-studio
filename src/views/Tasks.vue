<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import {
  store,
  cancelTask,
  removeTask,
  clearDone,
  retryTask,
  fetchTaskLog,
  pauseQueue,
  resumeQueue,
  retryAllFailed,
  clearFailed,
  clearAll,
} from "../store";

const STATUS: Record<string, { label: string; color: string; dot: string }> = {
  queued: { label: "排队中", color: "text-amber-500", dot: "bg-amber-500" },
  running: { label: "进行中", color: "text-brand", dot: "bg-brand" },
  done: { label: "已完成", color: "text-emerald-500", dot: "bg-emerald-500" },
  canceled: { label: "已取消", color: "text-red-500", dot: "bg-red-500" },
  failed: { label: "失败", color: "text-red-500", dot: "bg-red-500" },
};

const st = (s: string) => STATUS[s] || STATUS.queued;

const stats = computed(() => {
  const t = store.tasks;
  return {
    total: t.length,
    queued: t.filter((x) => x.status === "queued").length,
    run: t.filter((x) => x.status === "running").length,
    done: t.filter((x) => x.status === "done").length,
    failed: t.filter((x) => x.status === "failed" || x.status === "canceled").length,
  };
});

function confirmClearAll() {
  if (stats.value.total === 0) return;
  if (window.confirm("确定清空队列里的全部任务吗？进行中的会被取消。")) clearAll();
}
function confirmClearFailed() {
  if (stats.value.failed === 0) return;
  if (window.confirm("确定移除所有失败/已取消的任务吗？")) clearFailed();
}

function fmtDur(ts: number | null, end?: number | null) {
  if (!ts) return "";
  const e = end ?? Date.now();
  const s = Math.floor((e - ts) / 1000);
  return s < 60 ? `耗时 ${s}s` : `耗时 ${Math.floor(s / 60)}m${s % 60}s`;
}

function fmtTime(ts: number | null) {
  if (!ts) return "—";
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ===== 详情面板：展示完整命令 + ffmpeg 输出过程 =====

const detailId = ref<string | null>(null);
const detailLog = ref("");
const autoScroll = ref(true);
const logEl = ref<HTMLElement | null>(null);
let timer: number | undefined;

const detailTask = computed(() => store.tasks.find((t) => t.id === detailId.value) || null);
const logLines = computed(() => detailLog.value.split("\n").filter((l) => l.trim() !== "").length);

async function refreshLog() {
  const id = detailId.value;
  if (!id) return;
  detailLog.value = await fetchTaskLog(id);
  if (autoScroll.value) {
    await nextTick();
    if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight;
  }
  // 任务跑完（或失败/取消）后输出不再增长，停掉轮询
  const t = store.tasks.find((x) => x.id === id);
  if (t && t.status !== "running" && t.status !== "queued") stopTimer();
}

function stopTimer() {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
}

function openDetail(id: string) {
  detailId.value = id;
  detailLog.value = "";
  autoScroll.value = true;
  stopTimer();
  refreshLog();
  // 只有还在跑的才需要轮询实时日志
  const t = store.tasks.find((x) => x.id === id);
  if (t && (t.status === "running" || t.status === "queued")) {
    timer = window.setInterval(refreshLog, 600);
  }
}

function closeDetail() {
  detailId.value = null;
  stopTimer();
}

// 任务被移除后，详情面板自动关闭
watch(
  () => (detailId.value ? store.tasks.some((t) => t.id === detailId.value) : true),
  (exists) => {
    if (detailId.value && !exists) closeDetail();
  }
);

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") closeDetail();
}
window.addEventListener("keydown", onKey);
onUnmounted(() => {
  closeDetail();
  window.removeEventListener("keydown", onKey);
});

// ===== 复制 =====

const copied = ref<"cmd" | "log" | null>(null);

async function copy(text: string, which: "cmd" | "log") {
  const done = () => {
    copied.value = which;
    setTimeout(() => (copied.value = null), 1500);
  };
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      done();
      return;
    } catch {
      /* 落到兜底方案 */
    }
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
    done();
  } catch {
    /* 忽略 */
  }
  document.body.removeChild(ta);
}
</script>

<template>
  <!-- 注意：本组件必须保持「单根」。App.vue 用 v-show 控制显隐，
       多根（Fragment）会让运行时指令失效，队列就会在所有页面都显示出来。 -->
  <div class="space-y-5">
    <div class="flex items-start justify-between flex-wrap gap-3">
      <p class="text-sm text-muted max-w-xl">这里汇总所有已提交的任务，真实调用 ffmpeg 执行（进度与日志由后端解析推送，「详情」可查看完整输出）。按入队顺序先进先出执行，可并行多个。</p>
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-xs px-2 py-1 rounded-md bg-panel2/50 text-muted">并行 {{ store.concurrency }}</span>
        <button class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-panel2 text-sm hover:border-brand hover:bg-brand/5 cursor-pointer transition-colors" :class="store.paused ? 'text-brand border-brand' : ''" @click="store.paused ? resumeQueue() : pauseQueue()">
          <svg v-if="!store.paused" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="5" x2="8" y2="19"/><line x1="16" y1="5" x2="16" y2="19"/></svg>
          <svg v-else class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 5l12 7-12 7V5z"/></svg>
          {{ store.paused ? '继续队列' : '暂停队列' }}
        </button>
        <button class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-panel2 text-sm hover:border-brand hover:bg-brand/5 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed" :disabled="stats.failed === 0" @click="retryAllFailed">
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          重试失败
        </button>
        <button class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-panel2 text-sm hover:border-brand hover:bg-brand/5 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed" :disabled="stats.failed === 0" @click="confirmClearFailed">
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
          清空失败
        </button>
        <button class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-panel2 text-sm hover:border-red-500 hover:text-red-500 hover:bg-red-500/5 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed" :disabled="stats.total === 0" @click="confirmClearAll">
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
          清空全部
        </button>
        <button class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-panel2 text-sm hover:border-brand hover:bg-brand/5 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed" :disabled="stats.done === 0" @click="clearDone">
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
          清空已完成
        </button>
      </div>
    </div>

    <div v-if="store.paused" class="text-xs text-amber-500">队列已暂停：进行中的任务会继续跑完，但不会再拉起新任务。点「继续队列」恢复。</div>

    <div class="grid grid-cols-2 sm:grid-cols-5 gap-3">
      <div class="card rounded-xl p-3"><div class="text-xs text-muted">总任务</div><div class="text-xl font-extrabold mt-0.5">{{ stats.total }}</div></div>
      <div class="card rounded-xl p-3"><div class="text-xs text-muted">排队中</div><div class="text-xl font-extrabold mt-0.5 text-amber-500">{{ stats.queued }}</div></div>
      <div class="card rounded-xl p-3"><div class="text-xs text-muted">进行中</div><div class="text-xl font-extrabold mt-0.5 text-brand">{{ stats.run }}</div></div>
      <div class="card rounded-xl p-3"><div class="text-xs text-muted">已完成</div><div class="text-xl font-extrabold mt-0.5 text-emerald-500">{{ stats.done }}</div></div>
      <div class="card rounded-xl p-3"><div class="text-xs text-muted">失败/取消</div><div class="text-xl font-extrabold mt-0.5 text-red-500">{{ stats.failed }}</div></div>
    </div>

    <div v-if="store.tasks.length" class="space-y-2">
      <div v-for="t in store.tasks" :key="t.id" class="rounded-xl bg-ink/50 px-3.5 py-2.5 border border-panel2/60">
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-2 min-w-0">
            <span class="w-2 h-2 rounded-full shrink-0" :class="st(t.status).dot"></span>
            <span class="text-sm font-medium truncate">{{ t.name }}</span>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <span class="text-xs px-2 py-0.5 rounded-md" :class="[st(t.status).color, 'bg-panel2/50']">{{ st(t.status).label }}</span>
            <button class="inline-flex items-center gap-1 text-xs text-muted hover:text-brand hover:bg-brand/10 rounded-md px-1.5 py-1 transition-colors cursor-pointer" @click="openDetail(t.id)">
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              详情
            </button>
            <button v-if="t.status === 'running'" class="inline-flex items-center gap-1 text-xs text-muted hover:text-red-500 hover:bg-red-500/10 rounded-md px-1.5 py-1 transition-colors cursor-pointer" @click="cancelTask(t.id)">
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
              取消
            </button>
            <button v-else-if="t.status === 'failed' || t.status === 'canceled'" class="inline-flex items-center gap-1 text-xs text-muted hover:text-brand hover:bg-brand/10 rounded-md px-1.5 py-1 transition-colors cursor-pointer" @click="retryTask(t.id)">
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
              重试
            </button>
            <button class="inline-flex items-center gap-1 text-xs text-muted hover:text-brand hover:bg-brand/10 rounded-md px-1.5 py-1 transition-colors cursor-pointer" @click="removeTask(t.id)">
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              移除
            </button>
          </div>
        </div>

        <!-- 状态/进度 + 开始·结束·耗时 合并为一行，左状态右时间 -->
        <div class="flex items-center justify-between gap-3 text-[11px] text-muted mt-1.5">
          <span class="min-w-0 truncate">
            <template v-if="t.status === 'running'">进度 {{ t.progress >= 0 ? Math.round(t.progress) : '…' }}%<template v-if="t.time"> · {{ t.time }}<template v-if="t.speed"> · {{ t.speed }}</template></template></template>
            <template v-else-if="t.status === 'queued'">等待中…</template>
            <template v-else-if="t.status === 'done'">处理完成</template>
            <template v-else-if="t.status === 'canceled'">已取消</template>
            <template v-else><span class="text-red-500">执行失败：{{ t.note || "见详情日志" }}</span></template>
          </span>
          <span v-if="t.startedAt" class="shrink-0 whitespace-nowrap">
            开始 <span class="font-mono text-chalk/80">{{ fmtTime(t.startedAt) }}</span>
            <template v-if="t.finishedAt"> · 结束 <span class="font-mono text-chalk/80">{{ fmtTime(t.finishedAt) }}</span></template>
            · {{ fmtDur(t.startedAt, t.finishedAt) }}
          </span>
        </div>

        <!-- 命令：单行省略，完整内容在「详情」里看，避免长长的横向滚动条 -->
        <div class="font-mono text-[11px] leading-relaxed text-brand/90 bg-ink/70 rounded-lg px-2.5 py-1 mt-1.5 truncate" :title="t.cmd">{{ t.cmd }}</div>

        <!-- 进度条：只在执行中占空间，结束态（含 100% 满条）直接隐藏 -->
        <div v-if="t.status === 'running'" class="h-1 rounded-full bg-panel2 overflow-hidden mt-1.5">
          <div
            class="h-full transition-all duration-300"
            :class="'bg-brand' + (t.progress < 0 ? ' animate-pulse' : '')"
            :style="{ width: (t.progress >= 0 ? t.progress : 100) + '%' }"
          ></div>
        </div>
      </div>
    </div>
    <div v-else class="card rounded-2xl p-8 text-center text-sm text-muted">队列为空，去任意模块点击「加入队列并运行」。</div>

    <!-- ===== 任务详情（右侧抽屉） ===== -->
    <Teleport to="body">
      <div v-if="detailTask" class="fixed inset-0 z-[60] flex justify-end">
        <div class="absolute inset-0 bg-black/40" @click="closeDetail"></div>
        <aside class="relative w-[680px] max-w-[92vw] h-full bg-panel border-l border-panel2 flex flex-col shadow-2xl">
          <!-- 头部 -->
          <header class="px-5 py-4 border-b border-panel2 shrink-0">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <span class="w-2 h-2 rounded-full shrink-0" :class="st(detailTask.status).dot"></span>
                  <h3 class="font-semibold truncate">{{ detailTask.name }}</h3>
                </div>
                <div class="mt-1 text-xs text-muted">
                  <span :class="st(detailTask.status).color">{{ st(detailTask.status).label }}</span>
                  <span v-if="detailTask.status === 'running'"> · 进度 {{ detailTask.progress >= 0 ? Math.round(detailTask.progress) : '…' }}%</span>
                  <span v-if="detailTask.time"> · {{ detailTask.time }}</span>
                  <span v-if="detailTask.speed"> · {{ detailTask.speed }}</span>
                  <span v-if="detailTask.startedAt"> · 开始 {{ fmtTime(detailTask.startedAt) }}</span>
                  <span v-if="detailTask.status === 'running' && detailTask.startedAt"> · 已运行 {{ fmtDur(detailTask.startedAt) }}</span>
                  <span v-if="detailTask.finishedAt"> · 结束 {{ fmtTime(detailTask.finishedAt) }} · {{ fmtDur(detailTask.startedAt, detailTask.finishedAt) }}</span>
                </div>
              </div>
              <button class="shrink-0 text-muted hover:text-chalk cursor-pointer leading-none p-1" title="关闭（Esc）" @click="closeDetail">
                <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div v-if="detailTask.note" class="mt-3 text-xs rounded-lg bg-red-500/10 text-red-500 px-3 py-2 break-all">{{ detailTask.note }}</div>
          </header>

          <!-- 完整命令 -->
          <section class="px-5 py-3 border-b border-panel2 shrink-0">
            <div class="flex items-center justify-between mb-2">
              <h4 class="text-xs font-semibold text-muted uppercase tracking-wide">完整命令</h4>
              <button class="inline-flex items-center gap-1 text-xs cursor-pointer" :class="copied === 'cmd' ? 'text-brand' : 'text-muted hover:text-brand'" @click="copy(detailTask.cmd, 'cmd')">
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                {{ copied === 'cmd' ? '已复制' : '复制' }}
              </button>
            </div>
            <pre class="cmd bg-ink/70 rounded-xl p-3 text-brand whitespace-pre-wrap break-all max-h-40 overflow-y-auto">{{ detailTask.cmd }}</pre>
            <div v-if="detailTask.cwd" class="mt-2 text-[11px] text-muted break-all">工作目录：{{ detailTask.cwd }}</div>
          </section>

          <!-- 执行日志 -->
          <section class="flex-1 min-h-0 flex flex-col px-5 py-3">
            <div class="flex items-center justify-between mb-2 shrink-0">
              <h4 class="text-xs font-semibold text-muted uppercase tracking-wide">
                执行日志<span class="ml-2 font-normal normal-case">共 {{ logLines }} 行</span>
              </h4>
              <div class="flex items-center gap-3">
                <label class="flex items-center gap-1.5 text-xs text-muted cursor-pointer select-none">
                  <input type="checkbox" class="slider" v-model="autoScroll" />
                  自动滚动
                </label>
                <button class="inline-flex items-center gap-1 text-xs cursor-pointer" :class="copied === 'log' ? 'text-brand' : 'text-muted hover:text-brand'" @click="copy(detailLog, 'log')">
                  <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  {{ copied === 'log' ? '已复制' : '复制日志' }}
                </button>
              </div>
            </div>
            <div ref="logEl" class="flex-1 min-h-0 overflow-auto rounded-xl bg-ink/70 border border-panel2/60 p-3">
              <pre v-if="detailLog" class="cmd text-[11.5px] text-chalk/90 whitespace-pre-wrap break-all">{{ detailLog }}</pre>
              <div v-else class="text-xs text-muted">
                {{ detailTask.status === "queued" ? "任务排队中，尚未启动。" : "暂无输出（进程可能还没产生日志）。" }}
              </div>
            </div>
          </section>
        </aside>
      </div>
    </Teleport>
  </div>
</template>
