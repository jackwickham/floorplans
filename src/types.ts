interface RenderableImage {
  image: HTMLImageElement;
  x: number;
  y: number;
  cropOffsetX: number;
  cropOffsetY: number;
  cropWidth: number;
  cropHeight: number;
  pixelsPerMetre: number;
  label?: string;
  id: number;
  rotationDegrees: number;
  opacity: number;
}
