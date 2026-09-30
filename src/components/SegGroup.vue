<script setup lang="ts">
withDefaults(
  defineProps<{
    modelValue: string;
    options: { value: string; label: string }[];
    disabled?: boolean;
  }>(),
  { disabled: false }
);
const emit = defineEmits<{ (e: "update:modelValue", v: string): void }>();
</script>

<template>
  <div class="flex gap-1" :class="disabled ? 'opacity-50' : ''">
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      :disabled="disabled"
      @click="emit('update:modelValue', o.value)"
      class="seg-btn px-3 py-1 rounded-md border border-panel2 text-xs"
      :class="[{ active: o.value === modelValue }, disabled ? 'cursor-not-allowed' : 'cursor-pointer']"
    >
      {{ o.label }}
    </button>
  </div>
</template>
