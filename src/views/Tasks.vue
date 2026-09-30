<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import {
  store,
  cancelTask,
  removeTask,
  clearDone,
  retryTask,
  fetchTaskLog,
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
  };
});

function fmtDur(ts: number | null) {
  if (!ts) return "";
  const s = Math.floor((Date.now() - ts) / 1000);
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
    <div class="flex items-center justify-between">
      <p class="text-sm text-muted">这里汇总所有已提交的任务，真实调用 ffmpeg 执行（进度与日志由后端解析推送，「详情」可查看完整输出）。</p>
      <button class="px-3 py-2 rounded-lg border border-panel2 text-sm hover:border-brand cursor-pointer transition-colors" @click="clearDone">清空已完成</button>
    </div>

    <div class="grid grid-cols-4 gap-4">
      <div class="card rounded-2xl p-4"><div class="text-xs text-muted">总任务</div><div class="text-2xl font-extrabold mt-1">{{ stats.total }}</div></div>
      <div class="card rounded-2xl p-4"><div class="text-xs text-muted">排队中</div><div class="text-2xl font-extrabold mt-1 text-amber-500">{{ stats.queued }}</div></div>
      <div class="card rounded-2xl p-4"><div class="text-xs text-muted">进行中</div><div class="text-2xl font-extrabold mt-1 text-brand">{{ stats.run }}</div></div>
      <div class="card rounded-2xl p-4"><div class="text-xs text-muted">已完成</div><div class="text-2xl font-extrabold mt-1 text-emerald-500">{{ stats.done }}</div></div>
    </div>

    <div v-if="store.tasks.length" class="space-y-2.5">
      <div v-for="t in store.tasks" :key="t.id" class="rounded-xl bg-ink/50 px-4 py-3 border border-panel2/60">
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-2 min-w-0">
            <span class="w-2 h-2 rounded-full shrink-0" :class="st(t.status).dot"></span>
            <span class="text-sm font-medium truncate">{{ t.name }}</span>
          </div>
          <div class="flex items-center gap-3 shrink-0">
            <span class="text-xs px-2 py-0.5 rounded-md" :class="[st(t.status).color, 'bg-panel2/50']">{{ st(t.status).label }}</span>
            <button class="text-xs text-muted hover:text-brand cursor-pointer" @click="openDetail(t.id)">详情</button>
            <button v-if="t.status === 'running'" class="text-xs text-muted hover:text-red-500 cursor-pointer" @click="cancelTask(t.id)">取消</button>
            <button v-else-if="t.status === 'failed' || t.status === 'canceled'" class="text-xs text-muted hover:text-brand cursor-pointer" @click="retryTask(t.id)">重试</button>
            <button class="text-xs text-muted hover:text-brand cursor-pointer" @click="removeTask(t.id)">移除</button>
          </div>
        </div>

        <!-- 命令：单行省略，完整内容在「详情」里看，避免长长的横向滚动条 -->
        <div class="font-mono text-[11px] leading-relaxed text-brand/90 bg-ink/70 rounded-lg px-2.5 py-1 mt-2 truncate" :title="t.cmd">{{ t.cmd }}</div>

        <div class="flex items-center justify-between gap-3 text-[11px] text-muted mt-2 mb-1">
          <span class="min-w-0 truncate">
            <template v-if="t.status === 'running'">进度 {{ t.progress >= 0 ? Math.round(t.progress) : '…' }}%<template v-if="t.time"> · {{ t.time }}<template v-if="t.speed"> · {{ t.speed }}</template></template></template>
            <template v-else-if="t.status === 'queued'">等待中…</template>
            <template v-else-if="t.status === 'done'">处理完成</template>
            <template v-else-if="t.status === 'canceled'">已取消</template>
            <template v-else><span class="text-red-500">执行失败：{{ t.note || "见详情日志" }}</span></template>
          </span>
          <span v-if="t.startedAt && (t.status === 'running' || t.status === 'done')" class="shrink-0">{{ fmtDur(t.startedAt) }}</span>
        </div>
        <div class="h-1.5 rounded-full bg-panel2 overflow-hidden">
          <div
            class="h-full transition-all duration-300"
            :class="(t.status === 'canceled' || t.status === 'failed' ? 'bg-red-500' : 'bg-brand') + (t.progress < 0 ? ' animate-pulse' : '')"
            :style="{ width: (t.progress >= 0 ? t.progress : 100) + '%' }"
          ></div>
        </div>
      </div>
    </div>
    <div v-else class="card rounded-2xl p-10 text-center text-sm text-muted">队列为空，去任意模块点击「加入队列并运行」。</div>

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
                </div>
              </div>
              <button class="shrink-0 text-muted hover:text-chalk cursor-pointer text-lg leading-none px-1" title="关闭（Esc）" @click="closeDetail">×</button>
            </div>
            <div v-if="detailTask.note" class="mt-3 text-xs rounded-lg bg-red-500/10 text-red-500 px-3 py-2 break-all">{{ detailTask.note }}</div>
          </header>

          <!-- 完整命令 -->
          <section class="px-5 py-3 border-b border-panel2 shrink-0">
            <div class="flex items-center justify-between mb-2">
              <h4 class="text-xs font-semibold text-muted uppercase tracking-wide">完整命令</h4>
              <button class="text-xs cursor-pointer" :class="copied === 'cmd' ? 'text-brand' : 'text-muted hover:text-brand'" @click="copy(detailTask.cmd, 'cmd')">{{ copied === 'cmd' ? '已复制' : '复制' }}</button>
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
                <button class="text-xs cursor-pointer" :class="copied === 'log' ? 'text-brand' : 'text-muted hover:text-brand'" @click="copy(detailLog, 'log')">{{ copied === 'log' ? '已复制' : '复制日志' }}</button>
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
