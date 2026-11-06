<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
defineProps<{ title: string }>();
const panel = ref<HTMLElement>();
let previous: HTMLElement | null = null;
onMounted(() => {
  previous = document.activeElement as HTMLElement | null;
  panel.value?.focus({ preventScroll: true });
  if (panel.value) panel.value.scrollTop = 0;
});
onBeforeUnmount(() => {
  void nextTick(() => {
    if (previous?.isConnected) previous.focus();
  });
});
function trap(event: KeyboardEvent) {
  const controls = Array.from(
    panel.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), select:not(:disabled), input:not(:disabled), [tabindex="0"]',
    ) ?? [],
  );
  const first = controls[0],
    last = controls.at(-1);
  if (!first) {
    event.preventDefault();
    return;
  }
  if (
    event.shiftKey &&
    (document.activeElement === first || document.activeElement === panel.value)
  ) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
</script>
<template>
  <Teleport to="body">
    <div class="modal-backdrop">
      <section
        ref="panel"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        class="panel blocking-dialog"
        tabindex="-1"
        @keydown.esc.prevent.stop
        @keydown.tab="trap"
      >
        <h2>{{ title }}</h2>
        <div class="dialog-content"><slot /></div>
        <div v-if="$slots.actions" class="dialog-actions">
          <slot name="actions" />
        </div>
      </section>
    </div>
  </Teleport>
</template>
