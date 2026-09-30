<script setup lang="ts">
defineProps<{
  modelValue: string;
  options: { value: string; label: string }[];
}>();
const emit = defineEmits<{ (e: "update:modelValue", v: string): void }>();
</script>

<template>
  <div class="flex gap-1">
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      @click="emit('update:modelValue', o.value)"
      class="seg-btn px-3 py-1 rounded-md border border-panel2 text-xs"
      :class="{ active: o.value === modelValue }"
    >
      {{ o.label }}
    </button>
  </div>
</template>
