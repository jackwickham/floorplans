<script setup lang="ts">
import {
  ref,
  defineProps,
  onMounted,
  onBeforeUnmount,
  computed,
  watchEffect,
} from "vue";
import { generateId } from "../utils";

const props = defineProps<{
  image: HTMLImageElement;
  onSave: (image: RenderableImage) => void;
  onCancel: () => void;
}>();

const canvas = ref<HTMLCanvasElement | null>(null);
const context = ref<CanvasRenderingContext2D | null>(null);

const cursorClass = ref<string | null>(null);

const renderableImage: RenderableImage = {
  image: props.image,
  x: 0,
  y: 0,
  cropOffsetX: 0,
  cropOffsetY: 0,
  cropWidth: props.image.width,
  cropHeight: props.image.height,
  pixelsPerMetre: 0, // Ignored
  id: generateId(),
  rotationDegrees: 0,
  opacity: 1,
};

type CoordinateSystem = "image" | "canvas" | "screen";

interface Coordinate {
  system: CoordinateSystem;
  x: number;
  y: number;
}

type CropHandle = "xMin" | "xMax" | "yMin" | "yMax";
interface CropState {
  stage: "crop";
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  currentCropHandles: CropHandle[];
}
interface ScaleState {
  stage: "scale";
  start?: Coordinate;
  end?: Coordinate;
  length?: number;
}
type State = CropState | ScaleState;
const state = ref<State>({
  stage: "crop",
  xMin: 20,
  xMax: props.image.width - 20,
  yMin: 20,
  yMax: props.image.height - 20,
  currentCropHandles: [],
});

const saveDisabled = computed(
  () =>
    state.value.stage !== "scale" ||
    !state.value.start ||
    !state.value.end ||
    state.value.length == undefined
);

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 700;
const ZOOM_RADIUS = 100;
const ZOOM_FACTOR = 2.5;
const CROP_HANDLE_HALF_SIZE = 20;
const CROP_HANDLE_TOLERANCE = 10;

const imageToCanvasScaleFactor = () => {
  return Math.min(
    CANVAS_WIDTH / renderableImage.cropWidth,
    CANVAS_HEIGHT / renderableImage.cropHeight
  );
};

let mouseLocation: Coordinate | undefined;
let shiftPressed = false;

const snapLine = (
  start: Coordinate | undefined,
  cursor: Coordinate
): Coordinate => {
  if (shiftPressed || !start) {
    return cursor;
  }
  if (start.system !== cursor.system) {
    console.error(
      `Coordinate system mismatch: ${start.system} and ${cursor.system}`
    );
    return cursor;
  }
  const dx = cursor.x - start.x;
  const dy = cursor.y - start.y;
  if (Math.abs(dx) > Math.abs(dy)) {
    return {
      system: cursor.system,
      x: cursor.x,
      y: start.y,
    };
  } else {
    return {
      system: cursor.system,
      x: start.x,
      y: cursor.y,
    };
  }
};

const render = () => {
  if (!context.value) {
    return;
  }
  const ctx = context.value;

  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  ctx.drawImage(
    renderableImage.image,
    renderableImage.cropOffsetX,
    renderableImage.cropOffsetY,
    renderableImage.cropWidth,
    renderableImage.cropHeight,
    renderableImage.x,
    renderableImage.y,
    renderableImage.cropWidth * imageToCanvasScaleFactor(),
    renderableImage.cropHeight * imageToCanvasScaleFactor()
  );

  if (state.value.stage === "crop") {
    const xMin = state.value.xMin * imageToCanvasScaleFactor();
    const xMax = state.value.xMax * imageToCanvasScaleFactor();
    const yMin = state.value.yMin * imageToCanvasScaleFactor();
    const yMax = state.value.yMax * imageToCanvasScaleFactor();

    ctx.beginPath();
    ctx.rect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.rect(xMin, yMin, xMax - xMin, yMax - yMin);
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fill("evenodd");

    ctx.beginPath();
    ctx.rect(xMin, yMin, xMax - xMin, yMax - yMin);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "black";
    ctx.stroke();

    ctx.beginPath();
    const xMid = (xMin + xMax) / 2;
    const yMid = (yMin + yMax) / 2;
    ctx.moveTo(xMid - CROP_HANDLE_HALF_SIZE, yMin);
    ctx.lineTo(xMid + CROP_HANDLE_HALF_SIZE, yMin);

    ctx.moveTo(xMax - CROP_HANDLE_HALF_SIZE, yMin);
    ctx.lineTo(xMax, yMin);
    ctx.lineTo(xMax, yMin + CROP_HANDLE_HALF_SIZE);

    ctx.moveTo(xMax, yMid - CROP_HANDLE_HALF_SIZE);
    ctx.lineTo(xMax, yMid + CROP_HANDLE_HALF_SIZE);

    ctx.moveTo(xMax, yMax - CROP_HANDLE_HALF_SIZE);
    ctx.lineTo(xMax, yMax);
    ctx.lineTo(xMax - CROP_HANDLE_HALF_SIZE, yMax);

    ctx.moveTo(xMid + CROP_HANDLE_HALF_SIZE, yMax);
    ctx.lineTo(xMid - CROP_HANDLE_HALF_SIZE, yMax);

    ctx.moveTo(xMin + CROP_HANDLE_HALF_SIZE, yMax);
    ctx.lineTo(xMin, yMax);
    ctx.lineTo(xMin, yMax - CROP_HANDLE_HALF_SIZE);

    ctx.moveTo(xMin, yMid + CROP_HANDLE_HALF_SIZE);
    ctx.lineTo(xMin, yMid - CROP_HANDLE_HALF_SIZE);

    ctx.moveTo(xMin, yMin + CROP_HANDLE_HALF_SIZE);
    ctx.lineTo(xMin, yMin);
    ctx.lineTo(xMin + CROP_HANDLE_HALF_SIZE, yMin);

    ctx.lineWidth = 3;
    ctx.stroke();
  } else if (state.value.stage === "scale") {
    const scaleState = state.value;
    const renderMeasurementLine = (
      additionalScaleFactor: number,
      offsetX: number,
      offsetY: number
    ) => {
      if (scaleState.start && (scaleState.end || mouseLocation)) {
        ctx.beginPath();
        ctx.moveTo(
          scaleState.start.x *
            imageToCanvasScaleFactor() *
            additionalScaleFactor +
            offsetX,
          scaleState.start.y *
            imageToCanvasScaleFactor() *
            additionalScaleFactor +
            offsetY
        );
        if (scaleState.end) {
          ctx.lineTo(
            scaleState.end.x *
              imageToCanvasScaleFactor() *
              additionalScaleFactor +
              offsetX,
            scaleState.end.y *
              imageToCanvasScaleFactor() *
              additionalScaleFactor +
              offsetY
          );
        } else {
          const snappedEnd = snapLine(scaleState.start, {
            system: "image",
            x: mouseLocation!.x / imageToCanvasScaleFactor(),
            y: mouseLocation!.y / imageToCanvasScaleFactor(),
          });
          ctx.lineTo(
            snappedEnd.x * imageToCanvasScaleFactor() * additionalScaleFactor +
              offsetX,
            snappedEnd.y * imageToCanvasScaleFactor() * additionalScaleFactor +
              offsetY
          );
        }
        ctx.lineWidth = 4 * additionalScaleFactor;
        ctx.strokeStyle = "#8c1009";
        ctx.stroke();
      }
    };

    renderMeasurementLine(1, 0, 0);

    if (mouseLocation) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(mouseLocation.x, mouseLocation.y, ZOOM_RADIUS, 0, Math.PI * 2);
      ctx.closePath();
      ctx.lineWidth = 6;
      ctx.strokeStyle = "black";
      ctx.fillStyle = "white";
      ctx.stroke();
      ctx.fill();

      ctx.clip();
      ctx.drawImage(
        renderableImage.image,
        renderableImage.cropOffsetX +
          (mouseLocation.x - ZOOM_RADIUS / ZOOM_FACTOR) /
            imageToCanvasScaleFactor(),
        renderableImage.cropOffsetY +
          (mouseLocation.y - ZOOM_RADIUS / ZOOM_FACTOR) /
            imageToCanvasScaleFactor(),
        (ZOOM_RADIUS * 2) / imageToCanvasScaleFactor() / ZOOM_FACTOR,
        (ZOOM_RADIUS * 2) / imageToCanvasScaleFactor() / ZOOM_FACTOR,
        mouseLocation.x - ZOOM_RADIUS,
        mouseLocation.y - ZOOM_RADIUS,
        ZOOM_RADIUS * 2,
        ZOOM_RADIUS * 2
      );
      renderMeasurementLine(
        ZOOM_FACTOR,
        -mouseLocation.x * (ZOOM_FACTOR - 1),
        -mouseLocation.y * (ZOOM_FACTOR - 1)
      );
      ctx.restore();
    }
  }
};

watchEffect(() => {
  if (state.value.stage === "scale") {
    cursorClass.value = "cursor-crosshair";
  }

  render();
});

const findUsableCropHandles = (): CropHandle[] => {
  if (!mouseLocation || state.value.stage !== "crop") {
    return [];
  }

  const handles: CropHandle[] = [];
  if (
    Math.abs(mouseLocation.x - state.value.xMin * imageToCanvasScaleFactor()) <
    CROP_HANDLE_TOLERANCE
  ) {
    handles.push("xMin");
  }
  if (
    Math.abs(mouseLocation.x - state.value.xMax * imageToCanvasScaleFactor()) <
      CROP_HANDLE_TOLERANCE &&
    !handles.includes("xMin")
  ) {
    handles.push("xMax");
  }
  if (
    Math.abs(mouseLocation.y - state.value.yMin * imageToCanvasScaleFactor()) <
    CROP_HANDLE_TOLERANCE
  ) {
    handles.push("yMin");
  }
  if (
    Math.abs(mouseLocation.y - state.value.yMax * imageToCanvasScaleFactor()) <
      CROP_HANDLE_TOLERANCE &&
    !handles.includes("yMin")
  ) {
    handles.push("yMax");
  }
  return handles;
};

const updateCropCursor = (handles: CropHandle[]) => {
  cursorClass.value = handles.map((handle) => "cropping-" + handle).join(" ");
};

const handleMouseMove = (e: MouseEvent) => {
  if (!canvas.value) {
    return;
  }
  const boundingRect = canvas.value.getBoundingClientRect();
  mouseLocation = {
    system: "canvas",
    x: e.clientX - boundingRect.left,
    y: e.clientY - boundingRect.top,
  };

  if (state.value.stage === "crop") {
    if (state.value.currentCropHandles.length) {
      if (state.value.currentCropHandles.includes("xMin")) {
        state.value.xMin = Math.min(
          mouseLocation.x / imageToCanvasScaleFactor(),
          state.value.xMax
        );
      }
      if (state.value.currentCropHandles.includes("xMax")) {
        state.value.xMax = Math.max(
          mouseLocation.x / imageToCanvasScaleFactor(),
          state.value.yMin
        );
      }
      if (state.value.currentCropHandles.includes("yMin")) {
        state.value.yMin = Math.min(
          mouseLocation.y / imageToCanvasScaleFactor(),
          state.value.xMax
        );
      }
      if (state.value.currentCropHandles.includes("yMax")) {
        state.value.yMax = Math.max(
          mouseLocation.y / imageToCanvasScaleFactor(),
          state.value.yMin
        );
      }
    } else {
      const handles = findUsableCropHandles();
      updateCropCursor(handles);
    }
  }

  render();
};

const handleMouseDown = () => {
  if (state.value.stage === "crop" && mouseLocation) {
    const handles = findUsableCropHandles();
    if (handles.length !== 0) {
      state.value.currentCropHandles = handles;
      updateCropCursor(handles);
    }
  }
};

const handleMouseUp = () => {
  if (state.value.stage === "crop") {
    state.value.currentCropHandles = [];
    updateCropCursor([]);
  }
};

const handleMouseClick = (e: MouseEvent) => {
  if (!canvas.value) {
    return;
  }
  const boundingRect = canvas.value.getBoundingClientRect();
  if (state.value.stage === "scale") {
    const snappedImagePosition = snapLine(state.value.start, {
      system: "image",
      x: (e.clientX - boundingRect.left) / imageToCanvasScaleFactor(),
      y: (e.clientY - boundingRect.top) / imageToCanvasScaleFactor(),
    });
    if (!state.value.start || state.value.end) {
      state.value.start = snappedImagePosition;
      state.value.end = undefined;
    } else {
      state.value.end = snappedImagePosition;
    }
  }
  render();
};

const handleMouseLeave = () => {
  mouseLocation = undefined;
  render();
};

const handleSave = () => {
  if (state.value.stage !== "scale") {
    return;
  }
  if (
    !state.value.start ||
    !state.value.end ||
    state.value.length === undefined
  ) {
    return;
  }
  const xDist = state.value.end.x - state.value.start.x;
  const yDist = state.value.end.y - state.value.start.y;
  renderableImage.pixelsPerMetre =
    Math.sqrt(xDist * xDist + yDist * yDist) / state.value.length;
  props.onSave(renderableImage);
};

const handleNext = () => {
  if (state.value.stage === "crop") {
    renderableImage.cropOffsetX = state.value.xMin;
    renderableImage.cropOffsetY = state.value.yMin;
    renderableImage.cropWidth = state.value.xMax - state.value.xMin;
    renderableImage.cropHeight = state.value.yMax - state.value.yMin;
    state.value = {
      stage: "scale",
    };
  }
};

const handleKeyDown = (e: KeyboardEvent) => {
  if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
    shiftPressed = true;
    render();
  }
};

const handleKeyUp = (e: KeyboardEvent) => {
  if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
    shiftPressed = false;
    render();
  }
};

const handleLengthInputChange = (e: Event) => {
  if (state.value.stage === "scale") {
    state.value.length = (e.target as HTMLInputElement).valueAsNumber;
  }
};

onMounted(() => {
  document.addEventListener("keydown", handleKeyDown);
  document.addEventListener("keyup", handleKeyUp);

  if (canvas.value) {
    context.value = canvas.value.getContext("2d");
    render();
  }
});

onBeforeUnmount(() => {
  document.removeEventListener("keydown", handleKeyDown);
  document.removeEventListener("keyup", handleKeyUp);
});
</script>

<template>
  <div class="container">
    <canvas
      ref="canvas"
      :width="CANVAS_WIDTH"
      :height="CANVAS_HEIGHT"
      :class="cursorClass"
      @mousemove="handleMouseMove"
      @mouseleave="handleMouseLeave"
      @mousedown="handleMouseDown"
      @mouseup="handleMouseUp"
      @click.left="handleMouseClick"
    ></canvas>
    <div class="footer">
      <div class="length-input" v-show="state.stage === 'scale'">
        Length:
        <input
          type="number"
          size="5"
          :disabled="state.stage !== 'scale' || !state.end"
          @input="handleLengthInputChange"
        />m
      </div>
      <div class="spacer"></div>
      <div class="button-bar">
        <button @click="onCancel">Cancel</button>
        <button @click="handleNext" v-show="state.stage !== 'scale'">
          Next
        </button>
        <button
          @click="handleSave"
          v-show="state.stage === 'scale'"
          :disabled="saveDisabled"
        >
          Save
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
canvas {
  background-color: white;
  display: block;
  max-width: 100%;
}
button {
  background-color: #ddd;
}
.footer {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: baseline;
}
.button-bar {
  display: flex;
  flex-direction: row;
  justify-content: end;
  gap: 5px;
  padding-top: 10px;
}
.container {
  max-width: 90vw;
}

.cursor-crosshair {
  cursor: crosshair;
}
.cropping-xMin,
.cropping-xMax {
  cursor: ew-resize;
}
.cropping-yMin,
.cropping-yMax {
  cursor: ns-resize;
}
.cropping-xMin.cropping-yMin,
.cropping-xMax.cropping-yMax {
  cursor: nwse-resize;
}
.cropping-xMin.cropping-yMax,
.cropping-xMax.cropping-yMin {
  cursor: nesw-resize;
}
</style>
