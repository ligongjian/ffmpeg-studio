<script setup lang="ts">
import { computed } from "vue";
import { HWACCEL_ENCODERS } from "../lib/ffmpeg";

/**
 * 硬件加速编码器下拉。所有需要重编码的视频路径共用这一个控件，
 * 避免每个页面各写一份 select（选项清单曾经就是各页手抄的）。
 *
 * `disabled` 用于「当前配置根本不重编码」的场景（直接拷贝 / 纯音频 / GIF），
 * 这时给 offHint 说明原因，而不是让控件默默失效。
 */
const props = defineProps<{
  modelValue: string;
  /** 不适用时禁用 */
  disabled?: boolean;
  /** 禁用时显示的说明（为什么用不上） */
  offHint?: string;
  /** 选中后追加的质量参数说明：各页 CRF 来源不同，由调用方说清楚 */
  qualityHint?: string;
}>();

const emit = defineEmits<{ "update:modelValue": [string] }>();

const label = computed(() => HWACCEL_ENCODERS.find((e) => e.value === props.modelValue)?.label || "");
</script>

<template>
  <div>
    <label class="text-xs text-muted">硬件加速编码（可选，需对应显卡驱动）</label>
    <select
      :value="modelValue"
      :disabled="disabled"
      class="w-full mt-1 bg-ink border border-panel2 rounded-lg px-3 py-2 text-sm focus:border-brand outline-none"
      :class="disabled ? 'opacity-50 cursor-not-allowed' : ''"
      @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="e in HWACCEL_ENCODERS" :key="e.value" :value="e.value">{{ e.label }}</option>
    </select>
    <p v-if="disabled" class="mt-1 text-xs text-muted">{{ offHint || "当前设置不重编码视频" }}</p>
    <p v-else-if="modelValue" class="mt-1 text-xs text-muted">
      已选用 {{ label }}，{{ qualityHint || "质量参数按 CRF 映射到 -cq / -global_quality" }}。
    </p>
  </div>
</template>
