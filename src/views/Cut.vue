<script setup lang="ts">
import { reactive, ref, computed, watch, onUnmounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { store, pickInput } from "../store";
import { buildCut } from "../lib/ffmpeg";
import { hms2s, s2hms, baseName } from "../lib/format";
import CommandCard from "../components/CommandCard.vue";
import SegGroup from "../components/SegGroup.vue";

/** 入点与出点之间的最小间隔（秒） */
const MIN_SPAN = 1;

const s = reactive({ start: "00:00:25", end: "00:02:30", dur: "00:02:05", mode: "re" });

// ===== 真实总长 =====
// 原来总长写死成 00:04:12，拖到哪儿都是假的。现在选中输入文件后向后端探测，
// 时间轴按文件真实时长绘制；探测不到就不画，并如实说明原因。
const total = ref<number | null>(null);
const probeMsg = ref("");
const probing = ref(false);

async function probeDuration() {
  probeMsg.value = "";
  if (!store.inputFile) {
    total.value = null;
    return;
  }
  probing.value = true;
  try {
    const d = await invoke<number>("probe_media_duration", { path: store.inputFile });
    if (d >= MIN_SPAN) {
      total.value = d;
      // 换文件后默认整段，两端一拖就是裁剪
      s.start = s2hms(0);
      s.end = s2hms(d);
      s.dur = s2hms(d);
    } else {
      total.value = null;
      probeMsg.value = `读取到的时长为 ${d.toFixed(2)} 秒，太短，无法绘制时间轴。`;
    }
  } catch (e) {
    total.value = null;
    probeMsg.value = typeof e === "string" ? e : "无法读取媒体时长。";
  } finally {
    probing.value = false;
  }
}

watch(() => store.inputFile, probeDuration, { immediate: true });

const ready = computed(() => total.value !== null);
const T = computed(() => total.value ?? 0);

function clampNum(v: number, lo: number, hi: number) {
  return Math.min(Math.max(v, lo), hi);
}
/** 越界的时间一律夹回 [0, 总长]，时间轴绝不会画到轨道外 */
function clampSec(v: number) {
  return clampNum(v, 0, T.value);
}

const inSec = computed(() => clampSec(hms2s(s.start)));
const outSec = computed(() => clampSec(hms2s(s.end)));
const spanSec = computed(() => Math.max(0, outSec.value - inSec.value));

function pct(sec: number) {
  return T.value > 0 ? (sec / T.value) * 100 : 0;
}
const inPct = computed(() => pct(inSec.value));
const outPct = computed(() => pct(outSec.value));
const bandStyle = computed(() => ({
  left: inPct.value + "%",
  width: outPct.value - inPct.value + "%",
}));

/** 刻度标签：不足 1 小时用 mm:ss，超过用 h:mm:ss */
function fmtShort(sec: number) {
  const t = Math.round(sec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const x = t % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(x).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const ticks = computed(() =>
  [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    pct: f * 100,
    label: fmtShort(f * T.value),
  }))
);

const inputName = computed(() => store.inputFile || "input.mp4");
// 输出文件名：沿用源 basename 保持 .mp4；源本身是 mp4 时追加 .clip 防自覆盖
const outputName = computed(() => {
  const base = baseName(inputName.value).replace(/\.[^./\\]+$/, "") || "output";
  return /\.mp4$/i.test(inputName.value) ? `${base}.clip.mp4` : `${base}.mp4`;
});
const cmd = computed(() =>
  buildCut({
    input: inputName.value,
    start: s.start,
    end: s.end,
    mode: s.mode as "re" | "copy",
  })
);

// ===== 拖拽：入点手柄 / 出点手柄 / 整块平移 =====
type DragMode = "in" | "out" | "move";
const tlEl = ref<HTMLElement | null>(null);
const dragMode = ref<DragMode | null>(null);
/** 抓取点与入点之间的偏移，整块拖动时保持相对位置不跳 */
let grabOffset = 0;

function secAtX(clientX: number) {
  const el = tlEl.value;
  if (!el || T.value <= 0) return 0;
  const r = el.getBoundingClientRect();
  return clampNum((clientX - r.left) / Math.max(1, r.width), 0, 1) * T.value;
}

/** 写回三个时间框：时间轴与命令始终同源（取整到秒，与显示精度一致） */
function commit(a: number, b: number) {
  s.start = s2hms(a);
  s.end = s2hms(b);
  s.dur = s2hms(b - a);
}

function applyDrag(clientX: number) {
  const mode = dragMode.value;
  if (!mode) return;
  const x = secAtX(clientX);
  if (mode === "in") {
    commit(Math.min(x, outSec.value - MIN_SPAN), outSec.value);
  } else if (mode === "out") {
    commit(inSec.value, Math.max(x, inSec.value + MIN_SPAN));
  } else {
    const span = spanSec.value;
    const a = clampNum(x - grabOffset, 0, Math.max(0, T.value - span));
    commit(a, a + span);
  }
}

function onDown(e: PointerEvent, mode: DragMode) {
  if (!ready.value) return;
  e.preventDefault();
  e.stopPropagation();
  dragMode.value = mode;
  grabOffset = secAtX(e.clientX) - inSec.value;
  (e.currentTarget as HTMLElement).focus();
  // 手柄按下即跳到指针处，符合滑块直觉；整块拖动则保持抓取偏移
  if (mode !== "move") applyDrag(e.clientX);
  // 监听挂在 window 上：指针移出轨道也能继续拖，不会中途断掉
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}

function onMove(e: PointerEvent) {
  if (!dragMode.value) return;
  e.preventDefault();
  applyDrag(e.clientX);
}

function onUp() {
  if (!dragMode.value) return;
  dragMode.value = null;
  window.removeEventListener("pointermove", onMove);
  window.removeEventListener("pointerup", onUp);
  window.removeEventListener("pointercancel", onUp);
}

onUnmounted(onUp);

/** 拖动期间锁定光标，指针滑出轨道也不会变回箭头 */
watch(dragMode, (m) => {
  document.body.style.cursor = m === "move" ? "grabbing" : m ? "ew-resize" : "";
});

/** 键盘微调：← → 1 秒，Shift + ← → 10 秒 */
function nudge(e: KeyboardEvent, mode: DragMode) {
  if (!ready.value) return;
  const dir = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
  if (!dir) return;
  e.preventDefault();
  const step = dir * (e.shiftKey ? 10 : 1);
  if (mode === "in") {
    commit(clampNum(inSec.value + step, 0, Math.max(0, outSec.value - MIN_SPAN)), outSec.value);
  } else if (mode === "out") {
    commit(inSec.value, clampNum(outSec.value + step, inSec.value + MIN_SPAN, T.value));
  } else {
    const span = spanSec.value;
    const a = clampNum(inSec.value + step, 0, Math.max(0, T.value - span));
    commit(a, a + span);
  }
}

// 拖动时跟随指针的时间提示
const tipPct = computed(() => {
  const m = dragMode.value;
  if (m === "in") return inPct.value;
  if (m === "out") return outPct.value;
  return (inPct.value + outPct.value) / 2;
});
const tipStyle = computed(() => ({ left: clampNum(tipPct.value, 4, 96) + "%" }));
const tipText = computed(() => {
  const m = dragMode.value;
  if (m === "move") return `时长 ${s2hms(spanSec.value)}`;
  return s2hms(m === "in" ? inSec.value : outSec.value);
});

// ===== 时间框 =====
/** 输入过程中只同步时长，不打断正在敲的内容 */
function onStartEndInput() {
  s.dur = s2hms(Math.max(0, hms2s(s.end) - hms2s(s.start)));
}
function onDurInput() {
  s.end = s2hms(Math.max(0, hms2s(s.start)) + Math.max(0, hms2s(s.dur)));
}
/** 失焦时把越界值夹回 [0, 总长]，避免时间轴与命令各说各话 */
function normalize() {
  if (!ready.value) return;
  const a = clampSec(Math.min(hms2s(s.start), hms2s(s.end) - MIN_SPAN));
  const b = clampSec(Math.max(hms2s(s.end), a + MIN_SPAN));
  commit(a, b);
}
</script>

<template>
  <div class="space-y-6">
    <CommandCard title="剪辑分割 · 命令预览" :command="cmd" task-name="剪辑分割" />

    <div class="card rounded-2xl p-5 space-y-4">
      <div>
        <label class="text-sm font-semibold mb-2 block">源文件</label>
        <div class="rounded-xl border border-panel2 bg-ink/40 px-4 py-3 text-sm flex items-center justify-between">
          <span class="truncate">{{ store.inputFile || "input.mp4（未选择）" }}</span>
          <span class="text-brand text-xs cursor-pointer" @click="pickInput()">选择</span>
        </div>
      </div>

      <div class="text-xs text-muted">输出文件：<span class="text-brand font-mono">{{ outputName }}</span></div>

      <div class="flex items-center justify-between">
        <h3 class="font-semibold">时间轴剪辑</h3>
        <span class="text-xs text-muted">
          {{ ready ? `总时长 ${s2hms(T)}` : probing ? "读取时长中…" : "总时长未知" }}
        </span>
      </div>

      <div class="relative pt-7 select-none">
        <!-- 拖动中的时间提示 -->
        <div
          v-show="dragMode"
          class="absolute top-0 -translate-x-1/2 px-2 py-0.5 rounded-md bg-brand text-white text-[11px] cmd whitespace-nowrap pointer-events-none"
          :style="tipStyle"
        >
          {{ tipText }}
        </div>

        <div
          ref="tlEl"
          class="relative h-14 rounded-lg bg-ink/60 border border-panel2 touch-none"
          :class="ready ? '' : 'cursor-not-allowed'"
          :aria-disabled="!ready"
        >
          <!-- 刻度 -->
          <div
            v-for="(t, i) in ticks"
            :key="i"
            class="absolute inset-y-0 w-px bg-panel2"
            :style="{ left: t.pct + '%' }"
          ></div>

          <template v-if="ready">
            <!-- 已选区间：整块可拖动平移 -->
            <div
              class="absolute inset-y-0 bg-brand/25 border-y-2 border-brand cursor-grab active:cursor-grabbing overflow-hidden"
              :style="bandStyle"
              role="button"
              tabindex="0"
              :aria-label="`已选区间 ${s.start} 至 ${s.end}，共 ${s.dur}；左右方向键整体平移`"
              @pointerdown="onDown($event, 'move')"
              @keydown="nudge($event, 'move')"
            >
              <span
                v-if="outPct - inPct > 14"
                class="absolute inset-0 flex items-center justify-center text-[11px] cmd text-brand pointer-events-none"
              >
                {{ s.dur }}
              </span>
            </div>

            <!-- 入点手柄 -->
            <div
              class="absolute inset-y-0 w-4 -ml-2 cursor-ew-resize group"
              :style="{ left: inPct + '%' }"
              role="slider"
              tabindex="0"
              aria-label="入点 -ss"
              :aria-valuemin="0"
              :aria-valuemax="T"
              :aria-valuenow="inSec"
              :aria-valuetext="s.start"
              @pointerdown="onDown($event, 'in')"
              @keydown="nudge($event, 'in')"
            >
              <span
                class="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[3px] bg-brand group-hover:w-[5px] focus-visible:w-[5px] transition-all"
              ></span>
              <span
                class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-7 rounded-md bg-brand group-hover:scale-110 focus-visible:scale-110 transition-transform"
              ></span>
            </div>

            <!-- 出点手柄 -->
            <div
              class="absolute inset-y-0 w-4 -ml-2 cursor-ew-resize group"
              :style="{ left: outPct + '%' }"
              role="slider"
              tabindex="0"
              aria-label="出点 -to"
              :aria-valuemin="inSec + MIN_SPAN"
              :aria-valuemax="T"
              :aria-valuenow="outSec"
              :aria-valuetext="s.end"
              @pointerdown="onDown($event, 'out')"
              @keydown="nudge($event, 'out')"
            >
              <span
                class="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[3px] bg-brand group-hover:w-[5px] focus-visible:w-[5px] transition-all"
              ></span>
              <span
                class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-7 rounded-md bg-brand group-hover:scale-110 focus-visible:scale-110 transition-transform"
              ></span>
            </div>
          </template>
        </div>

        <!-- 刻度标签 -->
        <div class="relative h-4 mt-1 text-[11px] text-muted cmd">
          <span
            v-for="(t, i) in ticks"
            :key="i"
            class="absolute -translate-x-1/2"
            :style="{ left: clampNum(t.pct, 4, 96) + '%' }"
          >
            {{ t.label }}
          </span>
        </div>
      </div>

      <p v-if="!ready" class="text-[11px] text-muted mt-3 flex items-center gap-1 flex-wrap">
        <template v-if="!store.inputFile">
          <span>时间轴要先选择输入文件，才能按真实时长绘制。</span>
          <button class="text-brand underline cursor-pointer" @click="pickInput()">选择文件</button>
        </template>
        <template v-else>
          <span class="text-red-400">{{ probeMsg || "无法读取该文件的时长。" }}</span>
          <span>下方时间框仍可直接编辑。</span>
        </template>
      </p>
      <p v-else class="text-[11px] text-muted mt-3">
        提示：拖动左右手柄设置入点 / 出点，拖动中间色块整体平移；方向键微调 1 秒（按住 Shift 为 10 秒），也可直接编辑下方时间框。
      </p>

      <div class="grid md:grid-cols-3 gap-4 mt-5">
        <div>
          <label class="text-xs text-muted">起始 -ss</label>
          <input
            v-model="s.start"
            @input="onStartEndInput"
            @blur="normalize"
            @keyup.enter="normalize"
            class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm cmd focus:border-brand outline-none"
          />
        </div>
        <div>
          <label class="text-xs text-muted">结束 -to</label>
          <input
            v-model="s.end"
            @input="onStartEndInput"
            @blur="normalize"
            @keyup.enter="normalize"
            class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm cmd focus:border-brand outline-none"
          />
        </div>
        <div>
          <label class="text-xs text-muted">时长 -t</label>
          <input
            v-model="s.dur"
            @input="onDurInput"
            @blur="normalize"
            @keyup.enter="normalize"
            class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm cmd focus:border-brand outline-none"
          />
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
