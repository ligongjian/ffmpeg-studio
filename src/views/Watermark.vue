<script setup lang="ts">
import { reactive, computed, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { store, pickInput, probeInput } from "../store";
import { buildWatermark, type WatermarkOpts } from "../lib/ffmpeg";
import { baseName } from "../lib/format";
import CommandCard from "../components/CommandCard.vue";
import SegGroup from "../components/SegGroup.vue";

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
});

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

/** 输出文件名预览：沿用源 basename + `.watermarked` 后缀 */
const outputName = computed(() => {
  const base = baseName(inputName.value).replace(/\.[^./\\]+$/, "") || "output";
  return `${base}.watermarked.${s.fmt}`;
});

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
  }),
);

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
  const posMap: Record<string, CSSStyleDeclaration[]> = {
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
    <CommandCard title="水印字幕 · 命令预览" :command="cmd" task-name="水印字幕" />

    <div class="card rounded-2xl p-5 space-y-5">
      <!-- 源文件 -->
      <div>
        <label class="text-sm font-semibold mb-2 block">源视频</label>
        <div class="rounded-xl border border-panel2 bg-ink/40 px-4 py-3 text-sm flex items-center justify-between">
          <span class="truncate">
            <template v-if="store.inputFile">{{ inputName }}</template>
            <template v-else>未选择文件</template>
          </span>
          <span class="text-brand text-xs cursor-pointer" @click="pickInput()">选择</span>
        </div>
      </div>

      <div class="text-xs text-muted">输出文件：<span class="text-brand font-mono">{{ outputName }}</span></div>

      <SegGroup
        v-model="s.tab"
        :options="[
          { value: 'image', label: '图片水印' },
          { value: 'text', label: '文字水印' },
          { value: 'sub', label: '硬字幕' },
        ]"
      />

      <!-- 图片水印 -->
      <div v-if="s.tab === 'image'" class="space-y-4 text-sm">
        <div>
          <label class="text-xs text-muted">水印图片</label>
          <div class="mt-1 rounded-lg border border-panel2 bg-ink/40 px-4 py-3 flex items-center justify-between gap-3">
            <span class="truncate text-xs" :class="s.image ? '' : 'text-muted'">{{ s.image || "未选择图片（png/jpg）" }}</span>
            <span class="text-brand text-xs cursor-pointer shrink-0" @click="pickImage()">选择</span>
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
            <span class="text-brand text-xs cursor-pointer shrink-0" @click="pickSub()">选择</span>
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
    </div>
  </div>
</template>
