const BROTHER_VENDOR_ID = 0x04f9;
export const QL600_PRODUCT_ID = 0x20c0;
export const USB_VENDOR_ID = BROTHER_VENDOR_ID;

const DEVICE_PIXEL_WIDTH = 720;
const LABEL_WIDTH = 566;
const LABEL_HEIGHT = 165;
const RASTER_WIDTH = 165;
const RASTER_HEIGHT = 566;
const ROW_BYTES = DEVICE_PIXEL_WIDTH / 8;

const bytes = (...values) => values;
const u32le = (value) => [
  value & 0xff,
  (value >> 8) & 0xff,
  (value >> 16) & 0xff,
  (value >> 24) & 0xff,
];

export function renderLabel(canvas, { code, expirationDate, drinkName }) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, LABEL_WIDTH, LABEL_HEIGHT);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "top";

  ctx.font = fitCanvasFont(ctx, code, 265, 44, 34, 8);
  ctx.fillText(code, 8, 10);

  const exp = `EXP ${expirationDate}`;
  ctx.font = fitCanvasFont(ctx, exp, 265, 38, 26, 8);
  const expWidth = ctx.measureText(exp).width;
  ctx.fillText(exp, LABEL_WIDTH - 8 - expWidth, 14);

  ctx.font = fitCanvasFont(ctx, drinkName, LABEL_WIDTH - 16, 94, 70, 12);
  const metrics = ctx.measureText(drinkName);
  const drinkX = Math.max(8, (LABEL_WIDTH - metrics.width) / 2);
  ctx.fillText(drinkName, drinkX, 70);
}

export function makeRasterBytes(canvas, labels, { cut = true } = {}) {
  const data = [];
  data.push(...bytes(0x1b, 0x69, 0x61, 0x01));
  data.push(...new Array(200).fill(0));
  data.push(...bytes(0x1b, 0x40));
  data.push(...bytes(0x1b, 0x69, 0x61, 0x01));

  labels.forEach((label, index) => {
    const rasterRows = labelToRasterRows(canvas, label);
    data.push(...bytes(0x1b, 0x69, 0x53));
    data.push(...mediaAndQuality(RASTER_HEIGHT, index));

    if (cut) {
      data.push(...bytes(0x1b, 0x69, 0x4d, 0x40));
      data.push(...bytes(0x1b, 0x69, 0x41, labels.length));
    }

    data.push(...bytes(0x1b, 0x69, 0x4b, cut ? 0x08 : 0x00));
    data.push(...bytes(0x1b, 0x69, 0x64, 0x00, 0x00));

    rasterRows.forEach((row) => {
      data.push(0x67, 0x00, row.length, ...row);
    });

    data.push(index === labels.length - 1 ? 0x1a : 0x0c);
  });

  return new Uint8Array(data);
}

function fitCanvasFont(ctx, text, maxWidth, maxHeight, maxSize, minSize) {
  const value = text || "";
  for (let size = maxSize; size >= minSize; size -= 1) {
    ctx.font = `700 ${size}px Arial, sans-serif`;
    const metrics = ctx.measureText(value);
    const height = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent || size;
    if (metrics.width <= maxWidth && height <= maxHeight) {
      return ctx.font;
    }
  }
  return `700 ${minSize}px Arial, sans-serif`;
}

function mediaAndQuality(rasterHeight, pageIndex) {
  return [
    0x1b,
    0x69,
    0x7a,
    0xde,
    0x0b,
    17,
    54,
    ...u32le(rasterHeight),
    pageIndex === 0 ? 0 : 1,
    0,
  ];
}

function labelToRasterRows(canvas, label) {
  renderLabel(canvas, label);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const source = ctx.getImageData(0, 0, LABEL_WIDTH, LABEL_HEIGHT).data;
  const rows = [];

  for (let y = 0; y < RASTER_HEIGHT; y += 1) {
    const row = new Uint8Array(ROW_BYTES);
    for (let x = 0; x < DEVICE_PIXEL_WIDTH; x += 1) {
      const rasterX = DEVICE_PIXEL_WIDTH - 1 - x;
      const labelX = y;
      const labelY = LABEL_HEIGHT - 1 - (rasterX - (DEVICE_PIXEL_WIDTH - RASTER_WIDTH));
      const isBlack =
        labelX >= 0 &&
        labelX < LABEL_WIDTH &&
        labelY >= 0 &&
        labelY < LABEL_HEIGHT &&
        pixelIsBlack(source, labelX, labelY);
      if (isBlack) {
        row[x >> 3] |= 0x80 >> (x & 7);
      }
    }
    rows.push(row);
  }

  return rows;
}

function pixelIsBlack(source, x, y) {
  const offset = (y * LABEL_WIDTH + x) * 4;
  const r = source[offset];
  const g = source[offset + 1];
  const b = source[offset + 2];
  const alpha = source[offset + 3] / 255;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) * alpha + 255 * (1 - alpha);
  return luminance < 180;
}
