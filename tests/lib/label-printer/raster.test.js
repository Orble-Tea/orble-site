import { describe, expect, it } from "vitest";
import { makeRasterBytes } from "../../../src/lib/label-printer/raster.js";
import { LABEL_MEDIA } from "../../../src/lib/label-printer/media.js";

// Blank canvas isolates the command stream; browser tests cover real text pixels.
function blankCanvas() {
  const ctx = {
    fillRect() {},
    fillText() {},
    measureText: () => ({
      width: 20,
      actualBoundingBoxAscent: 10,
      actualBoundingBoxDescent: 2,
    }),
    getImageData: () => ({
      data: new Uint8ClampedArray(
        LABEL_MEDIA.widthDots * LABEL_MEDIA.heightDots * 4,
      ),
    }),
  };
  return { getContext: () => ctx };
}

describe("Brother raster jobs", () => {
  it("uses the media profile and ends the strip only after the last label", () => {
    const label = {
      code: "30TH#1,2",
      expirationDate: "11/02/26",
      drinkName: "Matcha 16oz",
    };
    const bytes = makeRasterBytes(blankCanvas(), [label, label]);
    let offset = 210; // mode + 200 nulls + initialize + mode
    for (let page = 0; page < 2; page++) {
      expect(Array.from(bytes.slice(offset, offset + 3))).toEqual([
        0x1b, 0x69, 0x53,
      ]);
      offset += 3;
      expect(Array.from(bytes.slice(offset, offset + 7))).toEqual([
        0x1b,
        0x69,
        0x7a,
        LABEL_MEDIA.validFields,
        LABEL_MEDIA.mediaType,
        LABEL_MEDIA.widthMm,
        LABEL_MEDIA.lengthMm,
      ]);
      expect(new DataView(bytes.buffer).getUint32(offset + 7, true)).toBe(
        LABEL_MEDIA.widthDots,
      );
      offset += 13;
      expect(Array.from(bytes.slice(offset, offset + 13))).toEqual([
        0x1b,
        0x69,
        0x4d,
        0, // no interval cuts
        0x1b,
        0x69,
        0x4b,
        8, // cut at job end
        0x1b,
        0x69,
        0x64,
        0,
        0, // no extra feed
      ]);
      offset += 13;
      for (let line = 0; line < LABEL_MEDIA.widthDots; line++) {
        expect(Array.from(bytes.slice(offset, offset + 3))).toEqual([
          0x67, 0, 90,
        ]);
        offset += 93;
      }
      expect(bytes[offset++]).toBe(page === 0 ? 0x0c : 0x1a);
    }
    expect(offset).toBe(bytes.length);
  });
});
