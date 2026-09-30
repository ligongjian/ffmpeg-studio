<script setup lang="ts">
import { reactive, computed, ref } from "vue";
import { buildBatch, type BatchOpts } from "../lib/ffmpeg";
import { invoke } from "@tauri-apps/api/core";
import { queueTasks, resolveFfmpeg, pickRecordDir, pickFolderFiles } from "../store";
import { baseName } from "../lib/format";

const s = reactive({
  files: [] as string[],
  op: "convert" as BatchOpts["op"],
  // ===== convert =====
  fmt: "mp4",
  vcodec: "libx264",
  acodec: "aac",
  // ===== compress =====
  crf: 28,
  preset: "medium",
  // ===== extract =====
  aext: "m4a",
  aCodec: "copy",
  // ===== thumb =====
  ts: "00:00:01",
  thumbFmt: "png",
  thumbW: 0,
  // ===== output =====
  outDir: "",
});

const adding = ref(false);

/** 合并去重（大小写不敏感，避免同一文件重复入队） */
function mergeFiles(list: string[]) {
  const have = new Set(s.files.map((f) => f.toLowerCase()));
  for (const f of list) {
    if (!have.has(f.toLowerCase())) {
      s.files.push(f);
      have.add(f.toLowerCase());
    }
  }
}

async function addFiles() {
  try {
    const picked = (await invoke<string[]>("pick_files")) || [];
    mergeFiles(picked);
  } catch (e) {
    console.error(e);
  }
}

async function addFolder() {
  adding.value = true;
  try {
    mergeFiles(await pickFolderFiles());
  } finally {
    adding.value = false;
  }
}

function removeAt(i: number) {
  s.files.splice(i, 1);
}

function clearFiles() {
  s.files = [];
}

const items = computed(() =>
  buildBatch({
    files: s.files,
    op: s.op,
    fmt: s.fmt,
    vcodec: s.vcodec,
    acodec: s.acodec,
    crf: s.crf,
    preset: s.preset,
    aext: s.aext,
    aCodec: s.aCodec,
    ts: s.ts,
    thumbFmt: s.thumbFmt,
    thumbW: s.thumbW,
    outDir: s.outDir,
  })
);

const previewCmds = computed(() => items.value.map((it) => resolveFfmpeg(it.cmd)));

async function chooseOutDir() {
  const d = await pickRecordDir();
  if (d) s.outDir = d;
}

function runBatch() {
  if (!items.value.length) return;
  queueTasks(
    items.value.map((it) => ({
      name: "批量: " + (baseName(it.file) || it.file),
      cmd: resolveFfmpeg(it.cmd),
      cwd: undefined,
    }))
  );
}

async function copyAll() {
  try {
    await navigator.clipboard.writeText(previewCmds.value.join("\n"));
    // 轻量反馈：复制成功无副作用即可，不引入额外依赖
  } catch (e) {
    console.error(e);
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- 文件来源 -->
    <div class="card rounded-2xl p-5 space-y-4">
      <div
        class="rounded-xl border-2 border-dashed border-panel2 bg-ink/40 p-6 text-center cursor-pointer hover:border-brand hover:bg-brand/5 hover:shadow-glow transition-all"
        @click="addFiles"
      >
        <div class="font-semibold">+ 点击选择多个文件进行批量处理</div>
        <div class="text-xs text-muted mt-1">
          已选择 <span>{{ s.files.length }}</span> 个文件 · 也可「添加文件夹」一次性纳入整个目录
        </div>
      </div>

      <div class="flex gap-3">
        <button
          class="flex-1 py-2.5 rounded-lg bg-panel2 hover:bg-brand/20 text-sm font-medium transition-colors cursor-pointer"
          @click="addFiles"
        >
          添加文件
        </button>
        <button
          class="flex-1 py-2.5 rounded-lg bg-panel2 hover:bg-brand/20 text-sm font-medium transition-colors cursor-pointer disabled:opacity-50"
          :disabled="adding"
          @click="addFolder"
        >
          {{ adding ? "扫描中…" : "添加文件夹（递归）" }}
        </button>
        <button
          class="px-4 py-2.5 rounded-lg bg-panel2 hover:bg-red-500/20 text-sm font-medium transition-colors cursor-pointer disabled:opacity-50"
          :disabled="!s.files.length"
          @click="clearFiles"
        >
          清空
        </button>
      </div>

      <!-- 文件清单 -->
      <div v-if="s.files.length" class="space-y-2 max-h-64 overflow-y-auto pr-1">
        <div
          v-for="(f, i) in s.files"
          :key="f"
          class="flex items-center gap-3 bg-ink/50 rounded-lg px-3 py-2 text-sm"
        >
          <span class="text-muted w-6 text-right shrink-0">{{ i + 1 }}</span>
          <div class="min-w-0 flex-1">
            <div class="truncate font-medium">{{ baseName(f) }}</div>
            <div class="text-xs text-muted truncate">{{ f }}</div>
          </div>
          <button
            class="shrink-0 w-7 h-7 rounded-lg bg-panel2 hover:bg-red-500/30 text-muted hover:text-red-300 transition-colors cursor-pointer"
            title="移除"
            @click="removeAt(i)"
          >
            ×
          </button>
        </div>
      </div>
    </div>

    <!-- 操作与参数 -->
    <div class="card rounded-2xl p-5 space-y-4">
      <div class="grid md:grid-cols-2 gap-4">
        <div>
          <label class="text-xs text-muted">批量操作</label>
          <select
            v-model="s.op"
            class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 focus:border-brand outline-none"
          >
            <option value="convert">统一转格式</option>
            <option value="compress">统一压缩（H.265）</option>
            <option value="extract">批量提取音频</option>
            <option value="thumb">批量截取缩略图</option>
          </select>
        </div>

        <!-- convert -->
        <template v-if="s.op === 'convert'">
          <div>
            <label class="text-xs text-muted">目标格式</label>
            <select
              v-model="s.fmt"
              class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 focus:border-brand outline-none"
            >
              <option value="mp4">mp4</option>
              <option value="mkv">mkv</option>
              <option value="webm">webm</option>
              <option value="mov">mov</option>
              <option value="avi">avi</option>
              <option value="gif">gif</option>
              <option value="mp3">mp3（仅音频）</option>
            </select>
          </div>
          <div>
            <label class="text-xs text-muted">视频编码</label>
            <select
              v-model="s.vcodec"
              class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 focus:border-brand outline-none"
            >
              <option value="libx264">H.264 (libx264)</option>
              <option value="libx265">H.265 (libx265)</option>
              <option value="copy">直接拷贝 (copy)</option>
            </select>
          </div>
          <div>
            <label class="text-xs text-muted">音频编码</label>
            <select
              v-model="s.acodec"
              class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 focus:border-brand outline-none"
            >
              <option value="aac">AAC</option>
              <option value="mp3">MP3 (libmp3lame)</option>
              <option value="copy">直接拷贝 (copy)</option>
            </select>
          </div>
        </template>

        <!-- compress -->
        <template v-if="s.op === 'compress'">
          <div>
            <label class="text-xs text-muted">目标格式</label>
            <select
              v-model="s.fmt"
              class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 focus:border-brand outline-none"
            >
              <option value="mp4">mp4</option>
              <option value="mkv">mkv</option>
              <option value="webm">webm</option>
              <option value="mov">mov</option>
              <option value="avi">avi</option>
            </select>
          </div>
          <div>
            <label class="text-xs text-muted">编码速度预设（{{ s.preset }}）</label>
            <select
              v-model="s.preset"
              class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 focus:border-brand outline-none"
            >
              <option value="ultrafast">ultrafast（最快）</option>
              <option value="superfast">superfast</option>
              <option value="veryfast">veryfast</option>
              <option value="faster">faster</option>
              <option value="fast">fast</option>
              <option value="medium">medium（默认）</option>
              <option value="slow">slow</option>
              <option value="slower">slower</option>
              <option value="veryslow">veryslow（最小）</option>
            </select>
          </div>
          <div class="md:col-span-2">
            <label class="text-xs text-muted">
              压缩质量 CRF：<span class="text-brand font-semibold">{{ s.crf }}</span>
              （18 高画质 ≈ 无损，35 高压缩）
            </label>
            <input
              type="range"
              min="18"
              max="35"
              step="1"
              v-model.number="s.crf"
              class="w-full mt-2 accent-brand"
            />
          </div>
        </template>

        <!-- extract -->
        <template v-if="s.op === 'extract'">
          <div>
            <label class="text-xs text-muted">音频格式</label>
            <select
              v-model="s.aext"
              class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 focus:border-brand outline-none"
            >
              <option value="m4a">m4a (AAC)</option>
              <option value="mp3">mp3</option>
              <option value="wav">wav</option>
              <option value="flac">flac</option>
              <option value="opus">opus</option>
            </select>
          </div>
          <div>
            <label class="text-xs text-muted">编码方式</label>
            <select
              v-model="s.aCodec"
              class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 focus:border-brand outline-none"
            >
              <option value="copy">无损拷贝（源已是该格式时最快）</option>
              <option value="reencode">重新编码</option>
            </select>
          </div>
        </template>

        <!-- thumb -->
        <template v-if="s.op === 'thumb'">
          <div>
            <label class="text-xs text-muted">截帧时间点</label>
            <input
              v-model="s.ts"
              placeholder="00:00:01 或 10（秒）"
              class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 focus:border-brand outline-none font-mono"
            />
          </div>
          <div>
            <label class="text-xs text-muted">缩略图格式</label>
            <select
              v-model="s.thumbFmt"
              class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 focus:border-brand outline-none"
            >
              <option value="png">png（无损）</option>
              <option value="jpg">jpg（更小）</option>
            </select>
          </div>
          <div>
            <label class="text-xs text-muted">宽度（像素，0 = 保持原始）</label>
            <input
              type="number"
              min="0"
              step="1"
              v-model.number="s.thumbW"
              class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 focus:border-brand outline-none font-mono"
            />
          </div>
        </template>
      </div>

      <!-- 输出目录 -->
      <div>
        <label class="text-xs text-muted">输出目录（留空则输出到每个源文件同目录）</label>
        <div class="flex gap-2 mt-1">
          <input
            v-model="s.outDir"
            placeholder="例如 D:/output"
            class="flex-1 bg-ink border border-panel2 rounded-lg px-3 py-2 focus:border-brand outline-none font-mono text-sm"
          />
          <button
            class="px-4 py-2 rounded-lg bg-panel2 hover:bg-brand/20 text-sm font-medium transition-colors cursor-pointer shrink-0"
            @click="chooseOutDir"
          >
            选择目录
          </button>
        </div>
      </div>

      <button
        class="w-full py-3 rounded-lg bg-brand text-white font-bold hover:bg-brandd transition-colors cursor-pointer disabled:opacity-50"
        :disabled="!items.length"
        @click="runBatch"
      >
        加入队列并运行{{ items.length ? `（${items.length} 个任务）` : "" }}
      </button>
    </div>

    <!-- 命令预览 -->
    <div class="card rounded-2xl p-5" v-if="items.length">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-semibold text-sm">
          命令预览（{{ items.length }} 条 · 输出到 <span class="text-brand">{{ s.outDir || "源文件同目录" }}</span>）
        </h3>
        <button
          class="text-xs px-3 py-1.5 rounded-lg bg-panel2 hover:bg-brand/20 transition-colors cursor-pointer"
          @click="copyAll"
        >
          复制全部
        </button>
      </div>
      <div class="space-y-3 max-h-96 overflow-y-auto pr-1">
        <div v-for="(it, i) in items" :key="i" class="rounded-xl bg-ink/70 p-3">
          <div class="text-xs text-muted mb-1 truncate">{{ baseName(it.file) }} → {{ it.out }}</div>
          <pre class="cmd whitespace-pre-wrap break-all text-xs">{{ previewCmds[i] }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>
