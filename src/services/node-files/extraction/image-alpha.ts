/**
 * Reject images whose background can be composited to black.
 *
 * MEASURED 2026-08-25 against the live OpenAI API. The same invoice rendered
 * twice — identical black text, only the background differing — extracted as:
 *
 *   flattened on white   total 987654.32   (correct)
 *   transparent RGBA     total  87164.32   (wrong)
 *
 * OpenAI composites alpha onto BLACK, so a transparent page arrives as black
 * text on black. The model does not report an unreadable page: it returns a
 * PLAUSIBLE WRONG NUMBER, and in the measured case the supplier name came back
 * correct, which makes the row read as trustworthy. Silent, confident and
 * wrong is the worst failure this module can produce, and human review does not
 * catch it — the value looks like a value.
 *
 * So an image that CAN carry transparency is refused at upload with an
 * actionable message rather than extracted into a plausible lie.
 *
 * KNOWN FALSE POSITIVE, accepted deliberately: a PNG with an alpha channel that
 * happens to be fully opaque is safe but still refused. Deciding otherwise means
 * decoding every pixel, which needs an image library this repo does not have
 * (no sharp, no jimp — verified). Refusing a safe file is an inconvenience the
 * user can fix in one step; accepting an unsafe one corrupts their data. If
 * flattening on upload is wanted later, that is a product decision with a
 * dependency attached.
 */

/** PNG IHDR colour types that carry an alpha channel. */
const PNG_COLOUR_TYPE_GREY_ALPHA = 4;
const PNG_COLOUR_TYPE_RGBA = 6;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/**
 * True when the bytes are a PNG that declares transparency — either an alpha
 * channel in the IHDR, or a `tRNS` chunk (how palette and greyscale PNGs carry
 * it). Anything that is not a PNG answers false: JPEG has no alpha, and PDFs
 * are rendered by the provider rather than composited by it.
 */
export function pngDeclaresTransparency(bytes: Buffer): boolean {
  if (bytes.length < 26 || !bytes.subarray(0, 4).equals(PNG_MAGIC))
    return false;

  // IHDR is always the first chunk: 8-byte signature, 4-byte length, 4-byte
  // type, then width/height/bit-depth, and the colour type at offset 25.
  const colourType = bytes[25];
  if (
    colourType === PNG_COLOUR_TYPE_GREY_ALPHA ||
    colourType === PNG_COLOUR_TYPE_RGBA
  ) {
    return true;
  }

  // `tRNS` marks transparency on palette/greyscale images, which the colour
  // type alone does not reveal. Bounded scan — the chunk must precede IDAT.
  const idat = bytes.indexOf("IDAT", 0, "latin1");
  const end = idat === -1 ? Math.min(bytes.length, 65536) : idat;
  return bytes.subarray(0, end).indexOf("tRNS", 0, "latin1") !== -1;
}

/** The tenant-facing refusal. Spanish, and it says what to do about it. */
export const TRANSPARENCY_REJECTION =
  "La imagen tiene fondo transparente y se leería en negro sobre negro, " +
  "devolviendo datos incorrectos. Guardala sin transparencia (fondo blanco) " +
  "o subí un PDF.";
