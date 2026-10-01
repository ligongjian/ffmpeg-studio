<script setup lang="ts">
import { reactive, computed, watch, ref, onUnmounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { store, pickInput, probeInput } from "../store";
import { buildWatermark, type WatermarkOpts } from "../lib/ffmpeg";
import { baseName } from "../lib/format";
import CommandCard from "../components/CommandCard.vue";
import SegGroup from "../components/SegGroup.vue";
import HwAccelSelect from "../components/HwAccelSelect.vue";

const s = reactive<{
  tab: WatermarkOpts["tab"];
  image: string;
  sub: string;
  pos: string;
  opacity: number;
  scale: number;
  text: string;
  fontsize: number;
  color: string;
  shadow: boolean;
  fontfile: string;
  fontSel: string;
  subFontsize: number;
  fmt: string;
  /** 重编码质量（CRF）：改画面必然重编码 */
  crf: number;
  hwaccel: string;
  // ===== delogo（消除水印）=====
  /** 待消除矩形：源分辨率像素坐标 */
  dx: number;
  dy: number;
  dw: number;
  dh: number;
  /** 让 ffmpeg 画绿框，先确认坐标 */
  dshow: boolean;
}>({
  tab: "image",
  image: "",
  sub: "",
  pos: "右下",
  opacity: 70,
  scale: 20,
  text: "Demo",
  fontsize: 28,
  color: "white",
  shadow: true,
  fontfile: "",
  fontSel: "",
  subFontsize: 0,
  fmt: "mp4",
  crf: 23,
  hwaccel: "",
  dx: 40,
  dy: 40,
  dw: 160,
  dh: 60,
  dshow: false,
});

// WebM 只装得下 VP8/VP9/AV1，硬件 H.264/HEVC 编码器写进去会直接失败
const hwaccelUsable = computed(() => s.fmt !== "webm");

const POS = ["左上", "右上", "左下", "右下", "居中"];
const COLORS = ["white", "black", "yellow", "red", "green", "cyan", "magenta", "orange"];

const inputName = computed(() => store.inputFile || "input.mp4");

// 换源文件后重测元信息
watch(
  () => store.inputFile,
  () => {
    probeInput().catch(() => {});
  },
  { immediate: true },
);

/** 输出文件名预览：沿用源 basename；消除水印用 `.delogoed` 后缀便于区分 */
const outputName = computed(() => {
  const base = baseName(inputName.value).replace(/\.[^./\\]+$/, "") || "output";
  const suffix = s.tab === "delogo" ? "delogoed" : "watermarked";
  return `${base}.${suffix}.${s.fmt}`;
});

// ===== delogo：源分辨率 + 框选 =====
/** 源视频分辨率；探测不到时按 1280x720 换算（并在界面上说明） */
const srcW = computed(() => store.inputInfo?.videoWidth || 0);
const srcH = computed(() => store.inputInfo?.videoHeight || 0);
/** 换算基准：有真实分辨率用它，否则退化为 1280x720 */
const refW = computed(() => srcW.value || 1280);
const refH = computed(() => srcH.value || 720);

/** 矩形在预览框里的位置（百分比，与源像素成比例） */
const rectStyle = computed(() => ({
  left: `${(s.dx / refW.value) * 100}%`,
  top: `${(s.dy / refH.value) * 100}%`,
  width: `${(s.dw / refW.value) * 100}%`,
  height: `${(s.dh / refH.value) * 100}%`,
}));

/** 越界 / 过大 / 未探测的提示。越界 ffmpeg 会直接失败，必须提前拦住 */
const delogoWarn = computed(() => {
  if (s.tab !== "delogo") return "";
  if (s.dw <= 0 || s.dh <= 0) return "请框选或填入待消除区域（宽高需大于 0）";
  if (!srcW.value || !srcH.value) return "未探测到源分辨率，请按实际像素填写坐标";
  if (s.dx < 0 || s.dy < 0 || s.dx + s.dw > srcW.value || s.dy + s.dh > srcH.value)
    return "区域超出画面，ffmpeg 会报错（Logo area is outside of the frame）";
  if (s.dw > srcW.value * 0.5 || s.dh > srcH.value * 0.5)
    return "区域超过画面的一半，周边像素不足以插值，修复效果通常很差";
  return "";
});

/** 台标常在四角：按当前框尺寸直接吸附过去 */
function snapTo(p: string) {
  const m = 10;
  const w = refW.value;
  const h = refH.value;
  const bw = Math.min(s.dw, w - m * 2);
  const bh = Math.min(s.dh, h - m * 2);
  if (p === "左上") Object.assign(s, { dx: m, dy: m });
  else if (p === "右上") Object.assign(s, { dx: w - bw - m, dy: m });
  else if (p === "左下") Object.assign(s, { dx: m, dy: h - bh - m });
  else Object.assign(s, { dx: w - bw - m, dy: h - bh - m });
}

// 预览框内拖拽：空白处拖 = 画新框；框内拖 = 移动
const delogoZone = ref<HTMLElement | null>(null);
type DMode = "draw" | "move" | null;
let dMode: DMode = null;
let dStart = { x: 0, y: 0 };
let dBase = { x: 0, y: 0 };

function clamp(v: number, lo: number, hi: number) {
  return Math.min(Math.max(v, lo), hi);
}

/** 指针位置 → 源像素坐标（预览框尺寸已知，按比例换算） */
function toSrc(e: PointerEvent) {
  const r = delogoZone.value?.getBoundingClientRect();
  if (!r) return { x: 0, y: 0 };
  return {
    x: clamp(((e.clientX - r.left) / r.width) * refW.value, 0, refW.value),
    y: clamp(((e.clientY - r.top) / r.height) * refH.value, 0, refH.value),
  };
}

function onZoneDown(e: PointerEvent) {
  const p = toSrc(e);
  const inside =
    p.x >= s.dx && p.x <= s.dx + s.dw && p.y >= s.dy && p.y <= s.dy + s.dh;
  dMode = inside ? "move" : "draw";
  dStart = p;
  dBase = { x: s.dx, y: s.dy };
  window.addEventListener("pointermove", onZoneMove);
  window.addEventListener("pointerup", onZoneUp);
  window.addEventListener("pointercancel", onZoneUp);
}

function onZoneMove(e: PointerEvent) {
  if (!dMode) return;
  const p = toSrc(e);
  if (dMode === "draw") {
    s.dx = Math.round(Math.min(dStart.x, p.x));
    s.dy = Math.round(Math.min(dStart.y, p.y));
    s.dw = Math.round(Math.abs(p.x - dStart.x));
    s.dh = Math.round(Math.abs(p.y - dStart.y));
  } else {
    // 移动时整体不出画面
    s.dx = Math.round(clamp(dBase.x + (p.x - dStart.x), 0, refW.value - s.dw));
    s.dy = Math.round(clamp(dBase.y + (p.y - dStart.y), 0, refH.value - s.dh));
  }
}

function onZoneUp() {
  dMode = null;
  window.removeEventListener("pointermove", onZoneMove);
  window.removeEventListener("pointerup", onZoneUp);
  window.removeEventListener("pointercancel", onZoneUp);
}

// 拖到一半切走页面时，window 上的监听必须解掉
onUnmounted(onZoneUp);

/** 实际传给 ffmpeg 的字体路径：下拉选 __custom__ 时用文件选择的路径 */
const actualFontfile = computed(() =>
  s.fontSel === "__custom__" ? s.fontfile : s.fontSel,
);

const cmd = computed(() =>
  buildWatermark({
    tab: s.tab,
    input: inputName.value,
    image: s.image,
    sub: s.sub,
    pos: s.pos,
    opacity: s.opacity,
    scale: s.scale,
    text: s.text,
    fontsize: s.fontsize,
    color: s.color,
    shadow: s.shadow,
    fontfile: actualFontfile.value,
    subFontsize: s.subFontsize,
    fmt: s.fmt,
    crf: s.crf,
    hwaccel: s.hwaccel,
    dx: s.dx,
    dy: s.dy,
    dw: s.dw,
    dh: s.dh,
    dshow: s.dshow,
  }),
);

const taskName = computed(() => (s.tab === "delogo" ? "水印消除" : "水印字幕"));

/** 选自定义字体文件（ttf/otf/ttc）。 */
async function pickFont() {
  try {
    const p = await invoke<string | null>("pick_file");
    if (p) {
      s.fontfile = p;
      s.fontSel = "__custom__";
    }
  } catch (e) {
    console.error(e);
  }
}

/** 下拉切换字体时同步实际路径 */
function onFontSelChange() {
  if (s.fontSel !== "__custom__") {
    s.fontfile = s.fontSel; // 空字符串 = 用 ffmpeg 默认（微软雅黑）
  }
}

/** 预览区样式：位置 + 字号 + 颜色 + 阴影同步到 CSS，所见即所得 */
const previewStyle = computed(() => {
  // 字号：实际 ffmpeg 用的是 px，预览在 16:9 框内，按 720p 基准缩放
  const fs = Math.max(8, Math.round(s.fontsize * 0.6));
  // 位置：5 个锚点对应的 CSS top/left/right/bottom
  const gap = 8;
  const posMap: Record<string, Record<string, string>[]> = {
    左上: [{ top: `${gap}px` }, { left: `${gap}px` }],
    右上: [{ top: `${gap}px` }, { right: `${gap}px` }],
    左下: [{ bottom: `${gap}px` }, { left: `${gap}px` }],
    右下: [{ bottom: `${gap}px` }, { right: `${gap}px` }],
    居中: [{ top: "50%" }, { left: "50%" }],
  };
  const arr = posMap[s.pos] ?? posMap["右下"];
  const style: Record<string, string> = {
    fontSize: `${fs}px`,
    color: s.color,
    fontWeight: "bold",
    fontFamily: "sans-serif",
  };
  for (const s1 of arr) Object.assign(style, s1);
  if (s.pos === "居中") {
    style.transform = "translate(-50%, -50%)";
  }
  if (s.shadow) {
    style.textShadow = "2px 2px 0 rgba(0,0,0,0.8)";
  }
  return style;
});

/** 选水印图片（png/jpg） */
async function pickImage() {
  try {
    const p = await invoke<string | null>("pick_file");
    if (p) s.image = p;
  } catch (e) {
    console.error(e);
  }
}

/** 选字幕文件（srt/ass） */
async function pickSub() {
  try {
    const p = await invoke<string | null>("pick_file");
    if (p) s.sub = p;
  } catch (e) {
    console.error(e);
  }
}
</script>

<template>
  <div class="space-y-6">
    <CommandCard :title="`${taskName} · 命令预览`" :command="cmd" :task-name="taskName" />

    <div class="card rounded-2xl p-5 space-y-5">
      <!-- 源文件 -->
      <div>
        <label class="text-sm font-semibold mb-2 block">源视频</label>
        <div class="rounded-xl border border-panel2 bg-ink/40 px-4 py-3 text-sm flex items-center justify-between">
          <span class="truncate">
            <template v-if="store.inputFile">{{ inputName }}</template>
            <template v-else>未选择文件</template>
          </span>
          <span class="text-brand text-xs cursor-pointer lk" @click="pickInput()">选择</span>
        </div>
      </div>

      <div class="text-xs text-muted">输出文件：<span class="text-brand font-mono">{{ outputName }}</span></div>

      <SegGroup
        v-model="s.tab"
        :options="[
          { value: 'image', label: '图片水印' },
          { value: 'text', label: '文字水印' },
          { value: 'sub', label: '硬字幕' },
          { value: 'delogo', label: '消除水印' },
        ]"
      />

      <!-- 消除水印（delogo） -->
      <div v-if="s.tab === 'delogo'" class="space-y-4 text-sm">
        <div class="flex items-start gap-3">
          <div
            ref="delogoZone"
            class="relative rounded-md border border-panel2 overflow-hidden shrink-0 cursor-crosshair select-none touch-none"
            style="width: 288px; aspect-ratio: 16 / 9; background: linear-gradient(135deg, #1e293b 0%, #0f172a 50%, #1e293b 100%);"
            @pointerdown="onZoneDown"
          >
            <span class="absolute inset-0 flex items-center justify-center text-[9px] text-muted/40 pointer-events-none">
              {{ srcW ? `${srcW}×${srcH}` : "16:9" }}
            </span>
            <div
              class="absolute border-2 border-err bg-err/25 pointer-events-none"
              :style="rectStyle"
            >
              <span class="absolute -top-4 left-0 text-[10px] text-err font-mono whitespace-nowrap">
                {{ s.dw }}×{{ s.dh }}
              </span>
            </div>
          </div>
          <div class="text-[11px] text-muted leading-relaxed pt-1">
            <div>在画面上<b>拖动</b>框出要消除的区域；拖框内可<b>移动</b>。</div>
            <div>
              坐标单位：源视频像素
              <template v-if="!srcW">（未探测到分辨率，按 1280×720 换算）</template>
            </div>
            <div>原理是用矩形<b>周边像素插值</b>填充，台标这类平坦背景效果最好。</div>
            <div>一次只能指定一个矩形；有多处水印时对产物再处理一次。</div>
          </div>
        </div>

        <div class="grid md:grid-cols-4 gap-3">
          <div>
            <label class="text-xs text-muted">X（左边缘）</label>
            <input type="number" min="0" step="1" v-model.number="s.dx" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none" />
          </div>
          <div>
            <label class="text-xs text-muted">Y（上边缘）</label>
            <input type="number" min="0" step="1" v-model.number="s.dy" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none" />
          </div>
          <div>
            <label class="text-xs text-muted">宽度</label>
            <input type="number" min="0" step="1" v-model.number="s.dw" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none" />
          </div>
          <div>
            <label class="text-xs text-muted">高度</label>
            <input type="number" min="0" step="1" v-model.number="s.dh" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none" />
          </div>
        </div>

        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="p in ['左上', '右上', '左下', '右下']"
            :key="p"
            class="seg-btn px-3 py-1 rounded-md border border-panel2 text-xs cursor-pointer"
            @click="snapTo(p)"
          >吸附到{{ p }}</button>
        </div>

        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" v-model="s.dshow" class="accent-brand" />
          画出绿框（<span class="font-mono">delogo=show=1</span>，先跑几秒确认位置再正式处理）
        </label>

        <p v-if="delogoWarn" class="text-[11px] text-warn">{{ delogoWarn }}</p>
      </div>

      <!-- 图片水印 -->

      <!-- 图片水印 -->
      <div v-else-if="s.tab === 'image'" class="space-y-4 text-sm">
        <div>
          <label class="text-xs text-muted">水印图片</label>
          <div class="mt-1 rounded-lg border border-panel2 bg-ink/40 px-4 py-3 flex items-center justify-between gap-3">
            <span class="truncate text-xs" :class="s.image ? '' : 'text-muted'">{{ s.image || "未选择图片（png/jpg）" }}</span>
            <span class="text-brand text-xs cursor-pointer shrink-0 lk" @click="pickImage()">选择</span>
          </div>
        </div>

        <div>
          <label class="text-xs text-muted">位置</label>
          <div class="flex flex-wrap gap-1.5 mt-1">
            <button
              v-for="p in POS"
              :key="p"
              class="seg-btn px-3 py-1 rounded-md border border-panel2 text-xs"
              :class="{ active: s.pos === p }"
              @click="s.pos = p"
            >{{ p }}</button>
          </div>
        </div>

        <div class="grid md:grid-cols-2 gap-4">
          <div>
            <label class="text-xs text-muted">不透明度 <span class="text-brand">{{ s.opacity }}</span>%</label>
            <input type="range" min="10" max="100" step="5" v-model.number="s.opacity" class="slider w-full" />
          </div>
          <div>
            <label class="text-xs text-muted">缩放 <span class="text-brand">{{ s.scale }}</span>%（占源视频宽度）</label>
            <input type="range" min="5" max="60" step="5" v-model.number="s.scale" class="slider w-full" />
          </div>
        </div>
      </div>

      <!-- 文字水印 -->
      <div v-else-if="s.tab === 'text'" class="space-y-4 text-sm">
        <div>
          <label class="text-xs text-muted">文字内容</label>
          <input v-model="s.text" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 focus:border-brand outline-none" />
        </div>

        <!-- 字体选择 -->
        <div>
          <label class="text-xs text-muted">字体</label>
          <select
            v-model="s.fontSel"
            class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none"
            @change="onFontSelChange"
          >
            <option value="">微软雅黑（默认，支持中文）</option>
            <option value="C:/Windows/Fonts/simhei.ttf">黑体（SimHei）</option>
            <option value="C:/Windows/Fonts/simsun.ttc">宋体</option>
            <option value="C:/Windows/Fonts/arial.ttf">Arial（不支持中文）</option>
            <option value="C:/Windows/Fonts/segoeui.ttf">Segoe UI（不支持中文）</option>
            <option value="__custom__">自定义字体文件…</option>
          </select>
          <div v-if="s.fontSel === '__custom__'" class="mt-1.5">
            <button
              class="text-xs text-brand underline cursor-pointer"
              @click="pickFont()"
            >选择 .ttf / .otf / .ttc 字体文件</button>
          </div>
          <div v-if="actualFontfile" class="mt-1 text-[11px] text-muted break-all">
            实际使用：{{ actualFontfile }}
          </div>
        </div>

        <div>
          <label class="text-xs text-muted">位置</label>
          <div class="flex flex-wrap gap-1.5 mt-1">
            <button
              v-for="p in POS"
              :key="p"
              class="seg-btn px-3 py-1 rounded-md border border-panel2 text-xs"
              :class="{ active: s.pos === p }"
              @click="s.pos = p"
            >{{ p }}</button>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="text-xs text-muted">字号 <span class="text-brand">{{ s.fontsize }}</span></label>
            <input type="range" min="12" max="96" step="2" v-model.number="s.fontsize" class="slider w-full" />
          </div>
          <div>
            <label class="text-xs text-muted">颜色</label>
            <div class="flex flex-wrap gap-1.5 mt-1">
              <button
                v-for="c in COLORS"
                :key="c"
                class="seg-btn px-2.5 py-1 rounded-md border text-xs"
                :class="{ active: s.color === c }"
                :style="{ borderColor: s.color === c ? c : 'var(--color-panel2, #333)' }"
                @click="s.color = c"
              >{{ c }}</button>
            </div>
          </div>
        </div>

        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" v-model="s.shadow" class="accent-brand" />
          文字阴影（提高对比度）
        </label>

        <!-- 实时预览：按位置在画框内放水印文字，颜色/字号/阴影同步 -->
        <div>
          <label class="text-xs text-muted">预览</label>
          <div class="mt-1 flex items-start gap-3">
            <div
              class="relative rounded-md border border-panel2 overflow-hidden shrink-0"
              style="width: 192px; aspect-ratio: 16 / 9; background: linear-gradient(135deg, #1e293b 0%, #0f172a 50%, #1e293b 100%);"
            >
              <span class="absolute inset-0 flex items-center justify-center text-[9px] text-muted/40 select-none">
                16:9
              </span>
              <span
                class="absolute whitespace-nowrap"
                :style="previewStyle"
              >{{ s.text || "Demo" }}</span>
            </div>
            <div class="text-[11px] text-muted leading-tight pt-1">
              <div>实际帧上的水印效果示意</div>
              <div>字号按 720p 画面等比缩放</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 硬字幕 -->
      <div v-else class="space-y-4 text-sm">
        <div>
          <label class="text-xs text-muted">字幕文件</label>
          <div class="mt-1 rounded-lg border border-panel2 bg-ink/40 px-4 py-3 flex items-center justify-between gap-3">
            <span class="truncate text-xs" :class="s.sub ? '' : 'text-muted'">{{ s.sub || "未选择字幕（srt/ass）" }}</span>
            <span class="text-brand text-xs cursor-pointer shrink-0 lk" @click="pickSub()">选择</span>
          </div>
        </div>

        <div>
          <label class="text-xs text-muted">字幕大小 <span class="text-brand">{{ s.subFontsize || "默认" }}</span></label>
          <input type="range" min="0" max="60" step="2" v-model.number="s.subFontsize" class="slider w-full" />
          <p class="text-[11px] text-muted mt-1">0 = 使用字幕文件内置字号</p>
        </div>
      </div>

      <!-- 输出容器（三 tab 通用） -->
      <div>
        <label class="text-xs text-muted">输出容器</label>
        <select v-model="s.fmt" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none">
          <option value="mp4">MP4</option>
          <option value="mkv">MKV</option>
          <option value="mov">MOV</option>
          <option value="webm">WebM</option>
          <option value="avi">AVI</option>
        </select>
      </div>

      <!-- 编码参数：三个 tab 都要重编码视频 -->
      <div class="grid md:grid-cols-2 gap-4">
        <div>
          <label class="text-xs text-muted">质量 (CRF，越小越清晰)</label>
          <input type="number" min="0" max="51" step="1" v-model.number="s.crf" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none" />
          <p class="text-[11px] text-muted mt-1">音轨原样拷贝，不重编码。</p>
        </div>
        <HwAccelSelect
          v-model="s.hwaccel"
          :disabled="!hwaccelUsable"
          off-hint="WebM 容器只支持 VP8 / VP9 / AV1，硬件 H.264/HEVC 编码器不适用"
          quality-hint="该 CRF 值会映射到 -cq / -global_quality"
        />
      </div>
    </div>
  </div>
</template>
