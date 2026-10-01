<script setup lang="ts">
import { reactive, computed } from "vue";
import {
  store,
  pickInput,
  pickRecordDir,
  queueTask,
  inputCwd,
  resolveFfmpeg,
  showToast,
} from "../store";
import {
  buildStream,
  type StreamMode,
  type StreamProto,
  type StreamOpts,
} from "../lib/ffmpeg";
import CommandCard from "../components/CommandCard.vue";
import SegGroup from "../components/SegGroup.vue";
import HwAccelSelect from "../components/HwAccelSelect.vue";

const s = reactive({
  mode: "push",
  proto: "RTMP",
  url: "rtmp://live.example.com/app/stream",
  vbr: "4000k",
  abr: "128k",
  preset: "veryfast",
  scale: "",
  fps: "",
  gopSec: 2,
  audio: true,
  transcode: false,
  /** 硬件加速编码器；推流 / 拉流转码时生效（码率控制模式） */
  hwaccel: "",
  // ===== 拉流输出（可配置，不再写死 record.ts）=====
  /** 输出目录；留空则后端兜底到系统「视频」文件夹 */
  outDir: "",
  /** 文件名（不含扩展名）；留空 = 自动 `pull_时间戳` */
  outName: "",
  /** 输出容器。ts=取消也不损坏；mp4/mkv 取消后会留下废文件 */
  pullFmt: "ts",
});

/** 生成 `YYYYMMDD_HHMMSS` 本地时间戳（与录制页同一套写法） */
function makeTs(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(
    d.getHours()
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * 拉流输出文件名（含扩展名，容器随扩展名走）。
 * - 用户填了名字 → 用它（结尾若是已知容器后缀先剥掉，避免出现 `a.mp4.ts`）
 * - 留空 → `pull_<时间戳>`
 *
 * `preview=true` 用稳定占位时间戳：命令预览不会每秒跳动，复制下来也不会带过期时间戳；
 * 真正入队时才用当前时刻，保证文件名是"开始拉流的那一刻"。
 */
function pullFileName(preview: boolean): string {
  const raw = s.outName.trim().replace(/\.(ts|mkv|mp4)$/i, "");
  const base = raw || `pull_${preview ? "YYYYMMDD_HHMMSS" : makeTs()}`;
  return `${base}.${s.pullFmt}`;
}

const inputName = computed(() => store.inputFile || "input.mp4");

/**
 * 任务的工作目录。拉流没有本地输入文件，若沿用 inputCwd() 会把录像落地到
 * 上一次选过的那个文件旁边；这里显式只在推流时用 inputCwd()，
 * 拉流留空交给后端兜底（系统「视频」文件夹）。
 */
const taskCwd = computed(() =>
  s.mode === "pull" ? s.outDir || undefined : inputCwd()
);

const outDirDisplay = computed(
  () => s.outDir || "未选择（默认存入系统「视频」文件夹）"
);
async function pickDir() {
  const p = await pickRecordDir();
  if (p) s.outDir = p;
}

function opts(preview: boolean): StreamOpts {
  return {
    mode: s.mode as StreamMode,
    proto: s.proto as StreamProto,
    url: s.url,
    vbr: s.vbr,
    abr: s.abr,
    preset: s.preset,
    scale: s.scale,
    fps: s.fps,
    gopSec: Number(s.gopSec) || 0,
    audio: s.audio,
    transcode: s.transcode,
    hwaccel: s.hwaccel,
    input: inputName.value,
    outName: pullFileName(preview),
  };
}

const cmd = computed(() => buildStream(opts(true)));

const taskName = computed(() => (s.mode === "pull" ? "拉流录制" : "推流"));

function enqueue() {
  if (!s.url.trim()) {
    showToast("请先填写服务器地址", "error");
    return;
  }
  queueTask(taskName.value, resolveFfmpeg(buildStream(opts(false))), taskCwd.value);
}
</script>

<template>
  <div class="space-y-6">
    <CommandCard title="流媒体 · 命令预览" :command="cmd" :task-name="taskName" :cwd="taskCwd">
      <template #actions>
        <button
          class="mt-3 w-full py-2.5 rounded-lg bg-brand text-white font-bold hover:bg-brandd transition-colors cursor-pointer"
          @click="enqueue"
        >
          加入队列并运行
        </button>
      </template>
    </CommandCard>

    <div class="card rounded-2xl p-5 space-y-5">
      <SegGroup
        v-model="s.mode"
        :options="[
          { value: 'push', label: '推流' },
          { value: 'pull', label: '拉流录制' },
        ]"
      />

      <!-- 推流需要本地源文件；拉流不需要 -->
      <div v-if="s.mode === 'push'">
        <label class="text-sm font-semibold mb-2 block">源文件</label>
        <div class="rounded-xl border border-panel2 bg-ink/40 px-4 py-3 text-sm flex items-center justify-between">
          <span class="truncate">{{ store.inputFile || 'input.mp4（示例）' }}</span>
          <span class="text-brand text-xs cursor-pointer lk" @click="pickInput()">选择</span>
        </div>
      </div>
      <div
        v-else
        class="rounded-xl border border-panel2 bg-ink/40 px-4 py-3 text-xs text-muted"
      >
        拉流录制从网络地址读取，不需要本地源文件。
      </div>

      <div class="grid md:grid-cols-2 gap-4">
        <div class="md:col-span-2">
          <label class="text-xs text-muted">协议 / 地址</label>
          <select v-model="s.proto" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none">
            <option>RTMP</option><option>HLS</option><option>RTSP</option><option>HTTP-FLV</option>
          </select>
        </div>
        <div class="md:col-span-2">
          <label class="text-xs text-muted">服务器地址</label>
          <input v-model="s.url" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none font-mono" />
          <p class="text-[11px] text-muted mt-1">
            <template v-if="s.mode === 'push'">
              <template v-if="s.proto === 'HLS'">HLS 推流地址通常以 <span class="font-mono">.m3u8</span> 结尾</template>
              <template v-else-if="s.proto === 'RTSP'">RTSP 地址形如 <span class="font-mono">rtsp://host:port/path</span></template>
              <template v-else>RTMP / HTTP-FLV 地址形如 <span class="font-mono">rtmp://host/app/stream</span></template>
            </template>
            <template v-else>支持 <span class="font-mono">rtmp://</span> / <span class="font-mono">https://…m3u8</span> / <span class="font-mono">rtsp://</span> / <span class="font-mono">http://…flv</span>。直播流不会自己结束，需要录制时点任务列表里的「取消」停止。</template>
          </p>
        </div>

        <!-- 推流：编码参数 -->
        <template v-if="s.mode === 'push'">
          <div>
            <label class="text-xs text-muted">视频码率</label>
            <input v-model="s.vbr" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none" />
          </div>
          <div>
            <label class="text-xs text-muted">音频码率</label>
            <input v-model="s.abr" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none" />
          </div>
          <div>
            <label class="text-xs text-muted">编码速度</label>
            <select v-model="s.preset" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none">
              <option value="ultrafast">ultrafast（最快/体积大）</option>
              <option value="superfast">superfast</option>
              <option value="veryfast">veryfast（推荐）</option>
              <option value="faster">faster</option>
              <option value="fast">fast</option>
              <option value="medium">medium（默认/最慢）</option>
            </select>
          </div>
          <div>
            <label class="text-xs text-muted">关键帧间隔（秒）</label>
            <input v-model.number="s.gopSec" type="number" min="0" step="1" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none" />
          </div>
          <div>
            <label class="text-xs text-muted">输出分辨率</label>
            <input v-model="s.scale" placeholder="如 1280:720，留空=跟随源" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none placeholder:text-muted/60" />
          </div>
          <div>
            <label class="text-xs text-muted">输出帧率</label>
            <input v-model="s.fps" placeholder="如 30，留空=跟随源" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none placeholder:text-muted/60" />
          </div>
          <HwAccelSelect v-model="s.hwaccel" quality-hint="直播必须码率可控，走 -b:v 而非 -cq" />
          <label class="md:col-span-2 flex items-center gap-2 text-sm cursor-pointer select-none">
            <input type="checkbox" v-model="s.audio" class="accent-brand w-4 h-4" />
            包含音频（取消勾选则仅推视频流 <span class="font-mono">-an</span>）
          </label>
        </template>

        <!-- 拉流：输出位置 / 名称 / 容器 -->
        <template v-else>
          <div class="md:col-span-2">
            <label class="text-xs text-muted">保存目录</label>
            <div class="rounded-xl border border-panel2 bg-ink/40 px-4 py-2.5 text-sm flex items-center justify-between mt-1">
              <span class="truncate">{{ outDirDisplay }}</span>
              <span class="text-brand text-xs cursor-pointer lk" @click="pickDir()">选择</span>
            </div>
          </div>
          <div>
            <label class="text-xs text-muted">文件名</label>
            <input
              v-model="s.outName"
              placeholder="留空 = 自动 pull_时间戳"
              class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none placeholder:text-muted/60 font-mono"
            />
          </div>
          <div>
            <label class="text-xs text-muted">输出容器</label>
            <select v-model="s.pullFmt" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none">
              <option value="ts">TS（推荐：随时取消都不损坏）</option>
              <option value="mkv">MKV（取消后文件可能打不开）</option>
              <option value="mp4">MP4（取消后文件基本报废）</option>
            </select>
          </div>
          <p class="md:col-span-2 text-[11px] text-muted -mt-2">
            直播流的结束方式只有「取消」，而取消是直接结束后台进程。TS 的包自带同步头，被切断也能播；
            MP4/MKV 需要收尾时回写索引，中途被杀就只剩几十字节。只有在源流会自己结束时才建议改选 MP4。
          </p>
        </template>
      </div>

      <!-- 拉流：编码选项 -->
      <div v-if="s.mode === 'pull'" class="border-t border-panel2 pt-4 grid md:grid-cols-2 gap-4">
        <label class="md:col-span-2 flex items-center gap-2 text-sm cursor-pointer select-none">
          <input type="checkbox" v-model="s.transcode" class="accent-brand w-4 h-4" />
          转码输出（取消勾选则直接拷贝 <span class="font-mono">-c copy</span>，最省资源）
        </label>
        <template v-if="s.transcode">
          <div>
            <label class="text-xs text-muted">视频码率</label>
            <input v-model="s.vbr" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none" />
          </div>
          <div>
            <label class="text-xs text-muted">音频码率</label>
            <input v-model="s.abr" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none" />
          </div>
          <div class="md:col-span-2">
            <label class="text-xs text-muted">编码速度</label>
            <select v-model="s.preset" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none">
              <option value="ultrafast">ultrafast（最快/体积大）</option>
              <option value="superfast">superfast</option>
              <option value="veryfast">veryfast（推荐）</option>
              <option value="faster">faster</option>
              <option value="fast">fast</option>
              <option value="medium">medium（默认/最慢）</option>
            </select>
          </div>
          <HwAccelSelect v-model="s.hwaccel" quality-hint="直播必须码率可控，走 -b:v 而非 -cq" />
        </template>
      </div>
    </div>
  </div>
</template>
