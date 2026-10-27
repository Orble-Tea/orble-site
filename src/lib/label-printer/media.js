/**
 * DK-1204 geometry at 300 dpi. Printable dots exclude the stock's margins.
 * Raster width/height are the landscape preview dimensions exchanged.
 * validFields selects quality, media type, width, length, and raster count;
 * mediaType 0x0b identifies die-cut stock in Brother's ESC i z command.
 */
export const LABEL_MEDIA = Object.freeze({
  name: "DK-1204",
  widthMm: 17,
  lengthMm: 54,
  widthDots: 566,
  heightDots: 165,
  validFields: 0xde,
  mediaType: 0x0b,
});
