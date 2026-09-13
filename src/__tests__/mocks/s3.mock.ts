import fs from "fs";
import {
  ListObjectsV2Command,
  CopyObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

type StoredObject = {
  size: number;
  metadata: Record<string, string>;
  modified: Date;
};

/**
 * An in-memory S3 answering the five commands `PurgeObjectStore` sends. Listings
 * page after `pageSize` keys so pagination is exercised; every command sent is
 * recorded in `sent` for assertions on what did (not) reach S3.
 */
export class FakeS3 {
  readonly objects = new Map<string, StoredObject>();
  readonly sent: { command: string; input: Record<string, unknown> }[] = [];
  pageSize = 2;

  put(bucket: string, key: string, size: number): void {
    this.objects.set(`${bucket}/${key}`, {
      size,
      metadata: {},
      modified: new Date(),
    });
  }

  keys(bucket: string, prefix: string): string[] {
    return [...this.objects.keys()]
      .filter((k) => k.startsWith(`${bucket}/${prefix}`))
      .map((k) => k.slice(bucket.length + 1))
      .sort();
  }

  send = async (command: object): Promise<unknown> => {
    const input = (command as { input: Record<string, unknown> }).input;
    this.sent.push({ command: command.constructor.name, input });
    if (command instanceof ListObjectsV2Command) {
      const all = this.keys(String(input.Bucket), String(input.Prefix ?? ""));
      const start = Number(input.ContinuationToken ?? 0);
      const next = start + this.pageSize;
      return {
        Contents: all.slice(start, next).map((key) => ({
          Key: key,
          Size: this.objects.get(`${input.Bucket}/${key}`)?.size,
        })),
        IsTruncated: next < all.length,
        NextContinuationToken: next < all.length ? String(next) : undefined,
      };
    }
    if (command instanceof CopyObjectCommand) {
      const found = this.objects.get(
        decodeURIComponent(String(input.CopySource)),
      );
      if (!found) {
        throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
      }
      this.objects.set(`${input.Bucket}/${input.Key}`, { ...found });
      return {};
    }
    if (command instanceof DeleteObjectsCommand) {
      const { Objects } = input.Delete as { Objects: { Key: string }[] };
      for (const o of Objects) this.objects.delete(`${input.Bucket}/${o.Key}`);
      return {};
    }
    if (command instanceof HeadObjectCommand) {
      const found = this.objects.get(`${input.Bucket}/${input.Key}`);
      if (!found) {
        throw Object.assign(new Error("NotFound"), { name: "NotFound" });
      }
      return { Metadata: found.metadata, LastModified: found.modified };
    }
    if (command instanceof PutObjectCommand) {
      let bytes = 0;
      for await (const chunk of input.Body as fs.ReadStream) {
        bytes += (chunk as Buffer).length;
      }
      if (bytes !== Number(input.ContentLength)) {
        throw new Error(`body is ${bytes} bytes, ContentLength says ${String(input.ContentLength)}`);
      }
      this.objects.set(`${input.Bucket}/${input.Key}`, {
        size: Number(input.ContentLength),
        metadata: input.Metadata as Record<string, string>,
        modified: new Date(),
      });
      return {};
    }
    throw new Error(`unexpected command ${command.constructor.name}`);
  };
}
