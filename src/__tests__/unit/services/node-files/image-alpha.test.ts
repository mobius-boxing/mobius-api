import {
  pngDeclaresTransparency,
  TRANSPARENCY_REJECTION,
} from "../../../../services/node-files/extraction/image-alpha";

/**
 * The invariant, measured against the live OpenAI API on 2026-08-25: a
 * transparent page is composited onto black and comes back as a PLAUSIBLE WRONG
 * number (987654.32 -> 87164.32) rather than as an obvious failure. These cases
 * exist so that guard cannot be deleted without a test going red.
 */
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A minimal PNG head: signature + IHDR length/type/dims/depth/colour type. */
const pngWithColourType = (colourType: number, tail = ""): Buffer =>
  Buffer.concat([
    Buffer.from([
      ...PNG_SIG,
      0,
      0,
      0,
      13,
      0x49,
      0x48,
      0x44,
      0x52,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      1,
      8,
      colourType,
      0,
      0,
      0,
    ]),
    Buffer.from(tail, "latin1"),
  ]);

describe("transparency guard", () => {
  it("refuses RGBA — the measured 987654.32 -> 87164.32 case", () => {
    expect(pngDeclaresTransparency(pngWithColourType(6))).toBe(true);
  });

  it("refuses greyscale+alpha", () => {
    expect(pngDeclaresTransparency(pngWithColourType(4))).toBe(true);
  });

  it("refuses a palette PNG whose transparency lives in tRNS", () => {
    // Colour type 3 declares no alpha channel; the tRNS chunk is the only signal.
    expect(pngDeclaresTransparency(pngWithColourType(3, "tRNSxxIDAT"))).toBe(
      true,
    );
  });

  it("accepts an opaque RGB PNG — the flattened case that extracts correctly", () => {
    expect(pngDeclaresTransparency(pngWithColourType(2, "IDAT"))).toBe(false);
  });

  it("accepts greyscale without alpha", () => {
    expect(pngDeclaresTransparency(pngWithColourType(0, "IDAT"))).toBe(false);
  });

  it("does not claim transparency for non-PNG bytes", () => {
    // JPEG carries no alpha, and a PDF is rendered by the provider, not
    // composited by it — neither may be refused by this guard.
    expect(pngDeclaresTransparency(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      false,
    );
    expect(
      pngDeclaresTransparency(Buffer.from("%PDF-1.4 tRNS", "latin1")),
    ).toBe(false);
  });

  it("does not read past the end of a truncated file", () => {
    expect(pngDeclaresTransparency(Buffer.from(PNG_SIG))).toBe(false);
    expect(pngDeclaresTransparency(Buffer.alloc(0))).toBe(false);
  });

  it("tells the user what to do, not just that it failed", () => {
    expect(TRANSPARENCY_REJECTION).toMatch(/sin transparencia|PDF/);
  });
});
