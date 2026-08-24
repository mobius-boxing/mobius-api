import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

/**
 * Byte storage behind the files table (Procusto `ManejadorArchivos` replacement —
 * spec: modules/01-system-and-cross-cutting/file-storage.md).
 *
 * Two drivers:
 *  - S3 when S3_FILES_BUCKET is set (production; EC2 instance-profile credentials).
 *  - Local disk otherwise (dev fallback — same key layout under UPLOADS_DIR), so
 *    local development needs no AWS credentials. Downloads then stream through the API.
 */
export class FileStorageService {
  private s3: S3Client | null = null;
  private bucket: string | undefined;
  private localDir: string;

  constructor() {
    this.bucket = process.env.S3_FILES_BUCKET;
    const region = process.env.S3_REGION || process.env.AWS_REGION;
    if (this.bucket && region) {
      this.s3 = new S3Client({ region });
    } else if (this.bucket) {
      this.s3 = new S3Client({});
    }
    this.localDir =
      process.env.UPLOADS_DIR || path.join(process.cwd(), "uploads");
    if (!this.s3) {
      console.warn(
        "⚠ S3_FILES_BUCKET not configured. File bytes will be stored on local disk at " +
          this.localDir,
      );
    }
  }

  public get isS3(): boolean {
    return !!this.s3;
  }

  /** Canonical object key — mirrors the spec layout. */
  public buildStorageKey(
    companyId: number,
    uuid: string,
    originalName: string,
  ): string {
    const ext = path.extname(originalName || "").toLowerCase();
    return `companies/${companyId}/files/${uuid}${ext}`;
  }

  public checksum(buffer: Buffer): string {
    return crypto.createHash("sha256").update(buffer).digest("hex");
  }

  async putObject(
    storageKey: string,
    buffer: Buffer,
    contentType?: string,
  ): Promise<void> {
    if (this.s3) {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket!,
          Key: storageKey,
          Body: buffer,
          ContentType: contentType,
        }),
      );
      return;
    }
    const filePath = path.join(this.localDir, storageKey);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, buffer);
  }

  /**
   * S3: short-lived signed GET URL (the browser downloads straight from S3).
   * Local driver: null — the caller must stream via getLocalReadStream instead.
   */
  async getDownloadUrl(
    storageKey: string,
    downloadName?: string,
  ): Promise<string | null> {
    if (!this.s3) return null;
    const command = new GetObjectCommand({
      Bucket: this.bucket!,
      Key: storageKey,
      ResponseContentDisposition: downloadName
        ? `attachment; filename="${encodeURIComponent(downloadName)}"`
        : undefined,
    });
    return getSignedUrl(this.s3, command, { expiresIn: 900 });
  }

  /**
   * The stored bytes, on BOTH drivers.
   *
   * `getDownloadUrl` is S3-only and `getLocalReadStream` is disk-only, which is
   * enough for a request handler that just hands a file to a browser but
   * useless to anything that has to *read* the content later — a background
   * worker cannot follow a signed URL it has no browser for, and cannot open a
   * local path in production. This is the one shape both drivers share.
   *
   * Whole-buffer by design: callers are size-capped before the bytes ever get
   * here (node-files refuses anything over NF_MAX_UPLOAD_BYTES), and a partial
   * read would be worse than an error for every current caller.
   */
  async getObjectBuffer(storageKey: string): Promise<Buffer> {
    if (this.s3) {
      const response = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket!, Key: storageKey }),
      );
      const body = response.Body;
      if (!body) {
        throw new Error(`Stored object has no body: ${storageKey}`);
      }
      // The v3 SDK's Node stream exposes this helper; it is the documented way
      // to collect a GetObject body without hand-rolling stream handling.
      const bytes = await (
        body as { transformToByteArray: () => Promise<Uint8Array> }
      ).transformToByteArray();
      return Buffer.from(bytes);
    }
    return fs.promises.readFile(path.join(this.localDir, storageKey));
  }

  getLocalReadStream(storageKey: string): fs.ReadStream {
    return fs.createReadStream(path.join(this.localDir, storageKey));
  }

  async localObjectExists(storageKey: string): Promise<boolean> {
    try {
      await fs.promises.access(path.join(this.localDir, storageKey));
      return true;
    } catch {
      return false;
    }
  }

  async deleteObject(storageKey: string): Promise<void> {
    if (this.s3) {
      await this.s3.send(
        new DeleteObjectCommand({ Bucket: this.bucket!, Key: storageKey }),
      );
      return;
    }
    try {
      await fs.promises.unlink(path.join(this.localDir, storageKey));
    } catch (err: any) {
      if (err?.code !== "ENOENT") throw err;
    }
  }

  /** Procusto `Copiar(guid)` analog: duplicate the bytes under a new key. */
  async copyObject(sourceKey: string, destKey: string): Promise<void> {
    if (this.s3) {
      // Encode per path segment — encoding the whole key would percent-encode
      // the '/' separators and make S3 resolve a nonexistent source.
      const encodedSource = sourceKey
        .split("/")
        .map(encodeURIComponent)
        .join("/");
      await this.s3.send(
        new CopyObjectCommand({
          Bucket: this.bucket!,
          CopySource: `${this.bucket}/${encodedSource}`,
          Key: destKey,
        }),
      );
      return;
    }
    const src = path.join(this.localDir, sourceKey);
    const dest = path.join(this.localDir, destKey);
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await fs.promises.copyFile(src, dest);
  }

  /** Procusto `TestearConexion` analog. */
  async healthCheck(): Promise<boolean> {
    if (this.s3) {
      try {
        await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket! }));
        return true;
      } catch {
        return false;
      }
    }
    try {
      await fs.promises.mkdir(this.localDir, { recursive: true });
      return true;
    } catch {
      return false;
    }
  }
}
