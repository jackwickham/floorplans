<script setup lang="ts">
import { ref, defineProps, onBeforeUnmount } from "vue";
import ImageEditor from "./ImageEditor.vue";

const props = defineProps<{
  callback: (image: RenderableImage) => void;
}>();

const dialog = ref<HTMLDialogElement | null>(null);
const image = ref<HTMLImageElement | null>(null);

const handlePaste = (event: ClipboardEvent) => {
  const items = event.clipboardData?.items;
  if (!items) {
    return;
  }
  for (const item of items) {
    if (item.kind === "file") {
      image.value = null;
      dialog.value?.showModal();

      const blob = item.getAsFile()!;
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          image.value = img;
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(blob);
      break;
    }
  }
};

const addImage = (renderableImage: RenderableImage) => {
  dialog.value?.close();
  props.callback(renderableImage);
};

const cancelAdd = () => dialog.value?.close();

onBeforeUnmount(() => document.removeEventListener("paste", handlePaste));
document.addEventListener("paste", handlePaste);
</script>

<template>
  <dialog ref="dialog">
    <ImageEditor
      v-if="image !== null"
      :image="image"
      :onSave="addImage"
      :onCancel="cancelAdd"
    ></ImageEditor>
  </dialog>
</template>

<style scoped>
::backdrop {
  background-color: rgba(0, 0, 0, 0.75);
}

dialog {
  background-color: #eee;
}
</style>
