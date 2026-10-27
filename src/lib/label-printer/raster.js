import { LABEL_MEDIA } from "./media.js";

const DEVICE_PIXEL_WIDTH = 720;
const { widthDots: LABEL_WIDTH, heightDots: LABEL_HEIGHT } = LABEL_MEDIA;
const ROW_BYTES = DEVICE_PIXEL_WIDTH / 8;

/**
 * Encodes the raster line count for Brother's little-endian command field.
 * @param {number} value Unsigned 32-bit count.
 * @returns {number[]} Four bytes, least significant first.
 */
const u32le = (value) => [
  value & 0xff,
  (value >> 8) & 0xff,
  (value >> 16) & 0xff,
  (value >> 24) & 0xff,
];

/**
 * Draws the same monochrome layout used by both preview and USB output.
 * @param {HTMLCanvasElement} canvas Destination, resized to the active media.
 * @param {{code: string, expirationDate: string, drinkName: string}} label Label text.
 * @returns {void}
 */
export function renderLabel(canvas, { code, expirationDate, drinkName }) {
  canvas.width = LABEL_WIDTH;
  canvas.height = LABEL_HEIGHT;
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

/**
 * Encodes one drink's labels as a continuous strip, cutting only at job end.
 * @param {HTMLCanvasElement} canvas Scratch canvas, separate from the preview.
 * @param {Object[]} labels Ordered labels to print.
 * @param {{cut?: boolean}} options Whether to cut the finished strip.
 * @returns {Uint8Array} Brother QL raster command stream.
 */
export function makeRasterBytes(canvas, labels, { cut = true } = {}) {
  const data = [];
  // Enter raster mode, send the QL initialization padding, reset, then re-enter raster mode.
  data.push(0x1b, 0x69, 0x61, 0x01);
  data.push(...new Array(200).fill(0));
  data.push(0x1b, 0x40);
  data.push(0x1b, 0x69, 0x61, 0x01);

  labels.forEach((label, index) => {
    const rasterRows = labelToRasterRows(canvas, label);
    // Request printer status, then describe the active label media.
    data.push(0x1b, 0x69, 0x53);
    data.push(...mediaAndQuality(LABEL_WIDTH, index));

    // Disable interval cutting; cut-at-end below avoids the 255-label interval limit.
    data.push(0x1b, 0x69, 0x4d, 0x00);

    // Select cut-at-end mode and feed zero extra dots before the raster lines.
    data.push(0x1b, 0x69, 0x4b, cut ? 0x08 : 0x00);
    data.push(0x1b, 0x69, 0x64, 0x00, 0x00);

    rasterRows.forEach((row) => {
      // 0x67 sends one packed monochrome raster row.
      data.push(0x67, 0x00, row.length, ...row);
    });

    // 0x0c advances to the next label; 0x1a finishes the print job.
    data.push(index === labels.length - 1 ? 0x1a : 0x0c);
  });

  return new Uint8Array(data);
}

/**
 * Shrinks bold text to its allotted rectangle without changing label geometry.
 * @param {CanvasRenderingContext2D} ctx Measurement context.
 * @param {string} text Text to fit.
 * @param {number} maxWidth Available width in dots.
 * @param {number} maxHeight Available height in dots.
 * @param {number} maxSize Preferred font size.
 * @param {number} minSize Smallest readable font size.
 * @returns {string} Canvas font declaration.
 */
function fitCanvasFont(ctx, text, maxWidth, maxHeight, maxSize, minSize) {
  const value = text || "";
  for (let size = maxSize; size >= minSize; size -= 1) {
    ctx.font = `700 ${size}px Arial, sans-serif`;
    const metrics = ctx.measureText(value);
    const height =
      metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent ||
      size;
    if (metrics.width <= maxWidth && height <= maxHeight) {
      return ctx.font;
    }
  }
  return `700 ${minSize}px Arial, sans-serif`;
}

/**
 * Builds ESC i z from the active stock profile and this page's raster count.
 * @param {number} rasterHeight Number of raster lines after rotation.
 * @param {number} pageIndex Zero-based page position in the job.
 * @returns {number[]} Media and quality command bytes.
 */
function mediaAndQuality(rasterHeight, pageIndex) {
  return [
    0x1b,
    0x69,
    0x7a,
    LABEL_MEDIA.validFields,
    LABEL_MEDIA.mediaType,
    LABEL_MEDIA.widthMm,
    LABEL_MEDIA.lengthMm,
    ...u32le(rasterHeight),
    pageIndex === 0 ? 0 : 1,
    0,
  ];
}

/**
 * Rotates the landscape canvas and packs black pixels into printhead-width rows.
 * @param {HTMLCanvasElement} canvas Scratch rendering surface.
 * @param {Object} label Label text to rasterize.
 * @returns {Uint8Array[]} One packed row for each feed-direction dot.
 */
function labelToRasterRows(canvas, label) {
  renderLabel(canvas, label);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const source = ctx.getImageData(0, 0, LABEL_WIDTH, LABEL_HEIGHT).data;
  const rows = [];

  for (let y = 0; y < LABEL_WIDTH; y += 1) {
    const row = new Uint8Array(ROW_BYTES);
    for (let x = 0; x < DEVICE_PIXEL_WIDTH; x += 1) {
      const rasterX = DEVICE_PIXEL_WIDTH - 1 - x;
      // The canvas is drawn landscape for preview, then rotated into the
      // printer's portrait raster coordinate system.
      const labelX = y;
      const labelY =
        LABEL_HEIGHT - 1 - (rasterX - (DEVICE_PIXEL_WIDTH - LABEL_HEIGHT));
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

/**
 * Thresholds an RGBA pixel after compositing transparency onto white stock.
 * @param {Uint8ClampedArray} source Landscape canvas RGBA buffer.
 * @param {number} x Horizontal pixel coordinate.
 * @param {number} y Vertical pixel coordinate.
 * @returns {boolean} Whether the thermal printhead should mark this pixel.
 */
function pixelIsBlack(source, x, y) {
  const offset = (y * LABEL_WIDTH + x) * 4;
  const r = source[offset];
  const g = source[offset + 1];
  const b = source[offset + 2];
  const alpha = source[offset + 3] / 255;
  const luminance =
    (0.2126 * r + 0.7152 * g + 0.0722 * b) * alpha + 255 * (1 - alpha);
  return luminance < 180;
}
