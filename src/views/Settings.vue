<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { store, toggleTheme, saveSettings } from "../store";
import { FMT_OPTIONS } from "../lib/ffmpeg";

async function applyPath() {
  await saveSettings();
  try {
    const ver = await invoke<string>("ffmpeg_version");
    store.engineMsg = ver;
    store.engineOk = true;
  } catch (e) {
    store.engineMsg = typeof e === "string" ? e : "FFmpeg 不可用";
    store.engineOk = false;
  }
}

async function browse() {
  try {
    const p = await invoke<string | null>("pick_executable");
    if (p) {
      store.ffmpegPath = p;
      await applyPath();
    }
  } catch (e) {
    console.error(e);
  }
}
</script>

<template>
  <div class="max-w-2xl space-y-5">
    <div class="card rounded-2xl p-5 space-y-4">
      <h3 class="font-semibold">FFmpeg 引擎</h3>
      <div>
        <label class="text-xs text-muted">可执行文件位置</label>
        <div class="flex gap-2 mt-1">
          <input v-model="store.ffmpegPath" class="flex-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none font-mono" />
          <button class="px-3 py-2 rounded-lg border border-panel2 text-sm hover:border-brand cursor-pointer" @click="browse">浏览</button>
        </div>
        <button class="mt-2 text-xs text-brand cursor-pointer" @click="applyPath">应用并检测</button>
      </div>
      <div class="flex items-center justify-between rounded-lg bg-ink/50 px-4 py-3">
        <div>
          <div class="text-sm font-medium">版本检测</div>
          <div class="text-xs text-muted">{{ store.engineMsg }}</div>
        </div>
        <span class="px-2 py-1 rounded-md text-brand text-xs font-bold bg-brand/15">{{ store.engineOk ? "正常" : "异常" }}</span>
      </div>
    </div>

    <div class="card rounded-2xl p-5 space-y-4">
      <h3 class="font-semibold">默认输出</h3>
      <div class="grid md:grid-cols-2 gap-4 text-sm">
        <div>
          <label class="text-xs text-muted">默认容器</label>
          <select v-model="store.fmt" @change="saveSettings()" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 focus:border-brand outline-none">
            <option v-for="f in FMT_OPTIONS" :key="f.value" :value="f.value">{{ f.label }}</option>
          </select>
          <p class="mt-1 text-xs text-muted">与「格式转换」页的目标格式联动</p>
        </div>
        <div>
          <label class="text-xs text-muted">默认 CRF</label>
          <input type="number" min="18" max="35" v-model.number="store.crf" @change="saveSettings()" class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 focus:border-brand outline-none" />
          <p class="mt-1 text-xs text-muted">与「压缩优化」页的 CRF 联动</p>
        </div>
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" v-model="store.notifyOnDone" @change="saveSettings()" class="accent-brand" /> 完成后通知
        </label>
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" v-model="store.overwrite" @change="saveSettings()" class="accent-brand" /> 覆盖已存在文件
        </label>
      </div>
      <p class="text-xs text-muted">
        关掉「覆盖已存在文件」后，命令会带上 <span class="font-mono">-n</span>，输出文件已存在时直接跳过而不是覆盖。
      </p>
    </div>

    <div class="card rounded-2xl p-5 flex items-center justify-between">
      <div>
        <div class="font-semibold">外观主题</div>
        <div class="text-xs text-muted">深色 / 浅色</div>
      </div>
      <button class="px-4 py-2 rounded-lg bg-brand text-white font-bold cursor-pointer hover:bg-brandd transition-colors" @click="toggleTheme()">切换</button>
    </div>
  </div>
</template>
