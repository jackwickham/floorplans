<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
import {
  faCircleHalfStroke,
  faPencil,
  faRotateLeft,
  faRotateRight,
} from "@fortawesome/free-solid-svg-icons";
import AddImageHandler from "./AddImageHandler.vue";
import { faTrashCan } from "@fortawesome/free-regular-svg-icons";

const canvas = ref<HTMLCanvasElement | null>(null);
const context = ref<CanvasRenderingContext2D | null>(null);
const canvasContainer = ref<HTMLDivElement | null>(null);

const images: RenderableImage[] = [];
const canvasPixelsPerMeter = ref<number>(50);
const renderOrigin = ref<{ x: number; y: number }>({ x: 0, y: 0 });

let selectedImage = ref<RenderableImage | null>(null);

const SAVE_KEY = "state";

type SavedState = (Omit<RenderableImage, "image"> & {
  image: string;
})[];

let loadFinished = false;

const getImageBoundingBox = (image: RenderableImage) => {
  const originalWidth = image.cropWidth / image.pixelsPerMetre;
  const originalHeight = image.cropHeight / image.pixelsPerMetre;
  if (image.rotationDegrees === 0 || image.rotationDegrees == 180) {
    return {
      xMin: image.x,
      xMax: image.x + originalWidth,
      yMin: image.y,
      yMax: image.y + originalHeight,
    };
  } else {
    return {
      xMin: image.x + originalWidth / 2 - originalHeight / 2,
      xMax: image.x + originalWidth / 2 + originalHeight / 2,
      yMin: image.y + originalHeight / 2 - originalWidth / 2,
      yMax: image.y + originalHeight / 2 + originalWidth / 2,
    };
  }
};

const render = () => {
  if (context.value === null) {
    return;
  }
  const ctx = context.value;

  ctx.clearRect(0, 0, canvas.value!.width, canvas.value!.height);
  for (let i = images.length - 1; i >= 0; i--) {
    const img = images[i];
    const x = (img.x - renderOrigin.value.x) * canvasPixelsPerMeter.value;
    const y = (img.y - renderOrigin.value.y) * canvasPixelsPerMeter.value;
    const width =
      (img.cropWidth * canvasPixelsPerMeter.value) / img.pixelsPerMetre;
    const height =
      (img.cropHeight * canvasPixelsPerMeter.value) / img.pixelsPerMetre;
    ctx.translate(x + width / 2, y + height / 2);
    if (img.rotationDegrees !== 0) {
      ctx.rotate((img.rotationDegrees * Math.PI) / 180);
    }
    ctx.globalAlpha = img.opacity;
    ctx.drawImage(
      img.image,
      img.cropOffsetX,
      img.cropOffsetY,
      img.cropWidth,
      img.cropHeight,
      -width / 2,
      -height / 2,
      width,
      height
    );
    ctx.globalAlpha = 1;
    if (selectedImage.value?.id === img.id) {
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = "#888";
      ctx.strokeRect(-width / 2, -height / 2, width, height);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
};

const saveState = () => {
  if (!loadFinished) {
    console.warn("tried to save before load had finished, ignoring");
  }
  const savedState: SavedState = images.map((img) => ({
    ...img,
    image: img.image.src,
  }));
  window.localStorage.setItem(SAVE_KEY, JSON.stringify(savedState));
};

const loadState = async () => {
  const val = window.localStorage.getItem(SAVE_KEY);
  if (val !== null) {
    const state = JSON.parse(val) as SavedState;
    const resolved = await Promise.all(
      state.map(
        (elem) =>
          new Promise<RenderableImage>((resolve) => {
            const img = new Image();
            img.onload = () =>
              resolve({
                ...elem,
                image: img,
              });
            img.src = elem.image;
          })
      )
    );
    resolved.forEach((img) => images.push(img));
    loadFinished = true;
    render();
  }
};

const resizeCanvas = () => {
  if (canvas.value && canvasContainer.value) {
    const { width, height } = canvasContainer.value.getBoundingClientRect();
    canvas.value.width = width;
    canvas.value.height = height;
    render();
  }
};

const addImageCallback = (image: RenderableImage) => {
  images.unshift(image);
  saveState();
  render();
};

let imageDragState:
  | { lastX: number; lastY: number; img: RenderableImage }
  | undefined;
let canvasDragState: { lastX: number; lastY: number } | undefined;
let mousePos: { x: number; y: number } | undefined;

const handleMouseMove = (e: MouseEvent) => {
  if (!canvas.value) {
    return;
  }
  const boundingRect = canvas.value.getBoundingClientRect();
  mousePos = {
    x: e.clientX - boundingRect.left,
    y: e.clientY - boundingRect.top,
  };

  if (imageDragState) {
    imageDragState.img.x +=
      (e.clientX - imageDragState.lastX) / canvasPixelsPerMeter.value;
    imageDragState.img.y +=
      (e.clientY - imageDragState.lastY) / canvasPixelsPerMeter.value;
    imageDragState.lastX = e.clientX;
    imageDragState.lastY = e.clientY;
    render();
  } else if (canvasDragState) {
    renderOrigin.value.x -=
      (e.clientX - canvasDragState.lastX) / canvasPixelsPerMeter.value;
    renderOrigin.value.y -=
      (e.clientY - canvasDragState.lastY) / canvasPixelsPerMeter.value;
    canvasDragState.lastX = e.clientX;
    canvasDragState.lastY = e.clientY;
    render();
  }
};

const handleMouseDown = (e: MouseEvent) => {
  if (!canvas.value) {
    return;
  }
  e.preventDefault();
  const boundingRect = canvas.value.getBoundingClientRect();
  const [mouseX, mouseY] = [
    (e.clientX - boundingRect.left) / canvasPixelsPerMeter.value +
      renderOrigin.value.x,
    (e.clientY - boundingRect.top) / canvasPixelsPerMeter.value +
      renderOrigin.value.y,
  ];
  if (e.button === 0) {
    const imgIdx = images.findIndex((image) => {
      const bbox = getImageBoundingBox(image);
      return (
        bbox.xMin <= mouseX &&
        bbox.xMax >= mouseX &&
        bbox.yMin <= mouseY &&
        bbox.yMax >= mouseY
      );
    });
    if (imgIdx === -1) {
      selectedImage.value = null;
      render();
      return;
    }
    const img = images[imgIdx];
    if (imgIdx !== 0) {
      images.splice(imgIdx, 1);
      images.unshift(img);
      saveState();
    }
    imageDragState = {
      lastX: e.clientX,
      lastY: e.clientY,
      img: img,
    };
    selectedImage.value = img;
  } else if (e.button === 1) {
    canvasDragState = {
      lastX: e.clientX,
      lastY: e.clientY,
    };
  }
  render();
};

const handleMouseUp = (e: MouseEvent) => {
  e.preventDefault();
  saveState();
  imageDragState = undefined;
  canvasDragState = undefined;
};

const handleMouseWheel = (e: WheelEvent) => {
  e.preventDefault();
  const multiplier = Math.pow(1.3, e.deltaY * -0.01);
  if (mousePos) {
    const mousePosMetres = {
      x: mousePos.x / canvasPixelsPerMeter.value + renderOrigin.value.x,
      y: mousePos.y / canvasPixelsPerMeter.value + renderOrigin.value.y,
    };
    renderOrigin.value.x =
      mousePosMetres.x - (mousePosMetres.x - renderOrigin.value.x) / multiplier;
    renderOrigin.value.y =
      mousePosMetres.y - (mousePosMetres.y - renderOrigin.value.y) / multiplier;
  }
  canvasPixelsPerMeter.value *= multiplier;
  render();
};

const handleRotateLeft = () => {
  if (selectedImage.value) {
    selectedImage.value.rotationDegrees =
      (selectedImage.value.rotationDegrees + 270) % 360;
    render();
  }
};
const handleRotateRight = () => {
  if (selectedImage.value) {
    selectedImage.value.rotationDegrees =
      (selectedImage.value.rotationDegrees + 90) % 360;
    render();
  }
};

const handleRename = () => {
  if (selectedImage.value) {
    selectedImage.value.label =
      prompt("Enter name", selectedImage.value.label) || undefined;
  }
};

const handleOpacityChange = (e: Event) => {
  if (selectedImage.value) {
    selectedImage.value.opacity = (e.target as HTMLInputElement).valueAsNumber;
    render();
  }
};

const handleDelete = () => {
  if (selectedImage.value) {
    const idx = images.findIndex((img) => img.id === selectedImage.value?.id);
    if (idx >= 0) {
      images.splice(idx, 1);
      render();
    }
  }
};

onMounted(() => {
  loadState();

  if (canvas.value) {
    context.value = canvas.value.getContext("2d");
    resizeCanvas();
    render();
  }
});

window.addEventListener("resize", resizeCanvas);
onBeforeUnmount(() => {
  window.removeEventListener("resize", resizeCanvas);
});
</script>

<template>
  <div class="page-container">
    <div class="toolbar">
      <button
        class="skinny"
        :disabled="selectedImage === null"
        @click="handleRotateLeft"
      >
        <FontAwesomeIcon :icon="faRotateLeft" />
      </button>
      <button
        class="skinny"
        :disabled="selectedImage === null"
        @click="handleRotateRight"
      >
        <FontAwesomeIcon :icon="faRotateRight" />
      </button>
      <span>
        <FontAwesomeIcon :icon="faCircleHalfStroke" />
        <input
          type="range"
          :value="selectedImage?.opacity || 1"
          :disabled="selectedImage === null"
          @input="handleOpacityChange"
          min="0"
          max="1"
          step="0.1"
        />
      </span>
      <button
        class="skinny"
        :disabled="selectedImage === null"
        @click="handleDelete"
      >
        <FontAwesomeIcon :icon="faTrashCan" />
      </button>
      <span>
        {{
          selectedImage ? selectedImage.label || "No label" : "None selected"
        }}
      </span>
      <button
        class="skinny"
        :disabled="selectedImage === null"
        @click="handleRename"
      >
        <FontAwesomeIcon :icon="faPencil" />
      </button>
    </div>
    <div ref="canvasContainer" class="canvas-container">
      <canvas
        class="canvas"
        ref="canvas"
        @mousedown="handleMouseDown"
        @mousemove="handleMouseMove"
        @mouseup="handleMouseUp"
        @click.capture.stop.prevent
        @wheel="handleMouseWheel"
      ></canvas>
    </div>
    <AddImageHandler :callback="addImageCallback"></AddImageHandler>
  </div>
</template>

<style scoped>
.page-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
}
.canvas-container {
  width: 100%;
  height: 100%;
  overflow: hidden;
  flex-grow: 1;
}
.toolbar {
  background-color: #ccc;
  flex: 0 0 30px;
  display: flex;
  flex-direction: row;
  column-gap: 15px;
  align-items: center;
  padding: 10px;
}
</style>
