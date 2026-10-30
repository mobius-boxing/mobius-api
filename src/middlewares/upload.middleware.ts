import { AsyncResource } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";
import multer from "multer";

/**
 * multer for a single `file` field, held in memory: the bytes go straight to
 * the storage driver and are never written to a temp file. The size limit is
 * multer's, so an oversized upload is refused while it streams; the error
 * middleware maps `LIMIT_FILE_SIZE` to a 400.
 *
 * **Why `AsyncResource.bind`.** busboy calls `next()` from the request stream's
 * `finish` event. Once the body spans more than one chunk (~150 KB) that event
 * fires outside the request's `AsyncLocalStorage` context, so the tenant handle
 * `authenticate` resolved is gone and every later `db("tenant")` throws
 * `TenantNotResolvedError` — small files passed, real logos did not. Binding
 * `next` to the context this middleware runs in carries the request through.
 */
export const singleFileUpload = (maxBytes: number) => {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes },
  }).single("file");

  return (req: Request, res: Response, next: NextFunction): void => {
    upload(req, res, AsyncResource.bind(next));
  };
};
