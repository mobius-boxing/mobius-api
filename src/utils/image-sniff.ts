export type AvatarContentType = "image/png" | "image/jpeg" | "image/webp";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];

const startsWith = (buf: Buffer, sig: number[], offset = 0): boolean =>
  buf.length >= offset + sig.length &&
  sig.every((b, i) => buf[offset + i] === b);

/** Decides the type from the bytes alone; the client-declared MIME is never trusted. */
export function sniffImageType(buf: Buffer): AvatarContentType | null {
  if (startsWith(buf, PNG)) return "image/png";
  if (startsWith(buf, JPEG)) return "image/jpeg";
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}
