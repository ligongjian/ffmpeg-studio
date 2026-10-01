<script setup lang="ts">
import { reactive, computed, watch } from "vue";
import { store, pickInput, probeInput } from "../store";
import { buildExtract, type ExtractOpts } from "../lib/ffmpeg";
import { baseName } from "../lib/format";
import CommandCard from "../components/CommandCard.vue";
import SegGroup from "../components/SegGroup.vue";
import HwAccelSelect from "../components/HwAccelSelect.vue";

const s = reactive<{
  tab: ExtractOpts["tab"];
  audioCodec: string;
  audioBitrate: string;
  videoCodec: string;
  videoCrf: string;
  videoFmt: string;
  /** 硬件加速编码器；仅「抽取视频 + 重编码」时生效 */
  hwaccel: string;
  frameAt: string;
  frameFmt: string;
  thumbInterval: number;
  thumbWidth: number;
  thumbName: string;
}>({
  tab: "audio",
  audioCodec: "copy",
  audioBitrate: "192k",
  videoCodec: "copy",
  videoCrf: "23",
  videoFmt: "mp4",
  hwaccel: "",
  frameAt: "0",
  frameFmt: "png",
  thumbInterval: 10,
  thumbWidth: 320,
  thumbName: "thumb_%03d.png",
});

const inputName = computed(() => store.inputFile || "input.mp4");

// 换文件后自动重测元信息
watch(
  () => store.inputFile,
  () => {
    probeInput().catch(() => {});
  },
  { immediate: true },
);

/** 输出文件名：沿用源 basename + `.extracted` 后缀，按 tab 拼具体扩展名/模板 */
const outputName = computed(() => {
  const base = baseName(inputName.value).replace(/\.[^./\\]+$/, "") || "output";
  switch (s.tab) {
    case "audio": {
      const extMap: Record<string, string> = {
        aac: "m4a",
        mp3: "mp3",
        flac: "flac",
        opus: "opus",
        copy: "wav",
      };
      return `${base}.extracted.${extMap[s.audioCodec] ?? "m4a"}`;
    }
    case "video":
      return `${base}.extracted.${s.videoFmt}`;
    case "frame":
      return `${base}.extracted.${s.frameFmt === "jpg" ? "jpg" : "png"}`;
    case "thumb": {
      // 列表里展示的占位——多文件输出，只把模板示意出来
      return `${base}_${s.thumbName}`;
    }
  }
});

const cmd = computed(() =>
  buildExtract({
    tab: s.tab,
    input: inputName.value,
    audioCodec: s.audioCodec,
    audioBitrate: s.audioBitrate,
    videoCodec: s.videoCodec,
    videoCrf: s.videoCrf,
    videoFmt: s.videoFmt,
    hwaccel: s.hwaccel,
    frameAt: s.frameAt,
    frameFmt: s.frameFmt,
    thumbInterval: s.thumbInterval,
    thumbWidth: s.thumbWidth,
    thumbName: s.thumbName,
  }),
);
</script>

<template>
  <div class="space-y-6">
    <CommandCard title="提取分离 · 命令预览" :command="cmd" task-name="提取分离" />

    <div class="card rounded-2xl p-5 space-y-5">
      <div>
        <label class="text-sm font-semibold mb-2 block">源文件</label>
        <div class="rounded-xl border border-panel2 bg-ink/40 px-4 py-3 text-sm flex items-center justify-between">
          <span class="truncate">
            <template v-if="store.inputInfo">
              {{ inputName }}
            </template>
            <template v-else-if="store.inputFile">
              {{ inputName }}
              <span v-if="store.inputProbing" class="text-muted"> · 读取中…</span>
              <span v-else class="text-err"> · {{ store.inputProbeErr || "读取失败" }}</span>
            </template>
            <template v-else>未选择文件</template>
          </span>
          <span class="text-brand text-xs cursor-pointer lk" @click="pickInput()">选择</span>
        </div>
      </div>

      <div class="text-xs text-muted">输出文件：<span class="text-brand font-mono">{{ outputName }}</span></div>

      <SegGroup
        v-model="s.tab"
        :options="[
          { value: 'audio', label: '提取音频' },
          { value: 'video', label: '提取视频' },
          { value: 'frame', label: '抽取帧' },
          { value: 'thumb', label: '缩略图' },
        ]"
      />

      <!-- 提取音频 -->
      <div v-if="s.tab === 'audio'" class="grid md:grid-cols-2 gap-4">
        <div>
          <label class="text-xs text-muted">音频编码</label>
          <select v-model="s.audioCodec" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none">
            <option value="copy">无损拷贝（-c:a copy）</option>
            <option value="aac">AAC</option>
            <option value="mp3">MP3</option>
            <option value="flac">FLAC</option>
            <option value="opus">Opus</option>
          </select>
        </div>
        <div>
          <label class="text-xs text-muted">码率（仅重编码时生效）</label>
          <select v-model="s.audioBitrate" :disabled="s.audioCodec === 'copy'" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none" :class="s.audioCodec === 'copy' ? 'opacity-50 cursor-not-allowed' : ''">
            <option value="">编码器默认</option>
            <option value="96k">96k</option>
            <option value="128k">128k</option>
            <option value="192k">192k</option>
            <option value="256k">256k</option>
            <option value="320k">320k</option>
          </select>
          <p class="text-[11px] text-muted mt-1">无损拷贝时容器按原编码：aac→m4a / mp3→mp3 / flac→flac / opus→opus / 其它→wav</p>
        </div>
      </div>

      <!-- 提取视频 -->
      <div v-else-if="s.tab === 'video'" class="grid md:grid-cols-3 gap-4">
        <div>
          <label class="text-xs text-muted">视频编码</label>
          <select v-model="s.videoCodec" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none">
            <option value="copy">直接拷贝（-c:v copy）</option>
            <option value="libx264">H.264 (重编码)</option>
          </select>
        </div>
        <div>
          <label class="text-xs text-muted">CRF（仅重编码时生效）</label>
          <input v-model="s.videoCrf" :disabled="s.videoCodec === 'copy'" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none" :class="s.videoCodec === 'copy' ? 'opacity-50 cursor-not-allowed' : ''" />
        </div>
        <div>
          <label class="text-xs text-muted">输出容器</label>
          <select v-model="s.videoFmt" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none">
            <option value="mp4">MP4</option>
            <option value="mkv">MKV</option>
            <option value="mov">MOV</option>
            <option value="avi">AVI</option>
            <option value="webm">WebM</option>
          </select>
        </div>
        <HwAccelSelect
          v-model="s.hwaccel"
          :disabled="s.videoCodec === 'copy' || s.videoFmt === 'webm'"
          :off-hint="
            s.videoCodec === 'copy'
              ? '直接拷贝不重编码，无需硬件加速'
              : 'WebM 容器只支持 VP8 / VP9 / AV1，硬件 H.264/HEVC 编码器不适用'
          "
          quality-hint="该 CRF 值会映射到 -cq / -global_quality"
        />
      </div>

      <!-- 抽取帧 -->
      <div v-else-if="s.tab === 'frame'" class="grid md:grid-cols-2 gap-4">
        <div>
          <label class="text-xs text-muted">时间点 -ss</label>
          <input v-model="s.frameAt" placeholder="00:00:05 / 10 / 0.5" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm font-mono focus:border-brand outline-none" />
        </div>
        <div>
          <label class="text-xs text-muted">输出格式</label>
          <select v-model="s.frameFmt" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none">
            <option value="png">PNG（无损）</option>
            <option value="jpg">JPG（小体积）</option>
          </select>
        </div>
      </div>

      <!-- 缩略图 -->
      <div v-else class="grid md:grid-cols-3 gap-4">
        <div>
          <label class="text-xs text-muted">间隔（秒，0 = 单张封面）</label>
          <input v-model.number="s.thumbInterval" type="number" min="0" step="1" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none" />
        </div>
        <div>
          <label class="text-xs text-muted">宽度（像素）</label>
          <input v-model.number="s.thumbWidth" type="number" min="0" step="16" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none" />
        </div>
        <div>
          <label class="text-xs text-muted">命名模板</label>
          <input v-model="s.thumbName" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm font-mono focus:border-brand outline-none" />
        </div>
      </div>
      <p v-if="s.tab === 'thumb'" class="text-[11px] text-muted -mt-2">
        {{ s.thumbInterval === 0 ? "间隔为 0 时只输出 1 张封面图" : `每 ${s.thumbInterval} 秒输出一张缩略图` }}；{{ s.thumbWidth > 0 ? `宽度 ${s.thumbWidth}px（高度按比例）` : "宽度为 0 时保持原始尺寸" }}
      </p>
    </div>
  </div>
</template>
