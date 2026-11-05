/**
 * 39 × 48 mm geometry at 300 dpi. Printable dots exclude the stock's margins.
 * Raster width/height are the landscape preview dimensions exchanged.
 * validFields selects quality, media type, width, length, and raster count;
 * mediaType 0x0b identifies die-cut stock in Brother's ESC i z command.
 */
export const LABEL_MEDIA = Object.freeze({
  name: "39 × 48 mm",
  widthMm: 39,
  lengthMm: 48,
  widthDots: 495,
  heightDots: 425,
  rightMarginDots: 6,
  validFields: 0xde,
  mediaType: 0x0b,
});
