import { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { FileDAO } from "../../dao/file/file.dao";
import { FileStorageService } from "../../services/file-storage.service";
import {
  enforceCompanyFilter,
  getCompanyFilterUuid,
  getCompanyForCreate,
} from "../../utils/companyScope";

// Procusto had no size/type limits; we add a defensive cap (D-note in file-storage.md).
export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

/**
 * File attachment endpoints. Consumers (parts, products, models, palletizations)
 * store files.uuid in their file FK columns.
 *
 * POST   /files              multipart (field "file", optional "description";
 *                            "companyId" is the target company UUID and is
 *                            honoured ONLY for superAdmin — see below)
 * GET    /files              list (query builder)
 * GET    /files/:uuid        metadata
 * GET    /files/:uuid/download  302 to signed S3 URL, or streamed bytes (local driver)
 * POST   /files/:uuid/copy   duplicate (Procusto `Copiar`)
 * DELETE /files/:uuid        delete row + bytes (explicit delete, divergence D10)
 */
export class FileController {
  private dao = new FileDAO();
  private storage = new FileStorageService();

  /**
   * The company an uploaded file belongs to (L-009).
   *
   * SECURITY: the target is decided by `getCompanyForCreate`, never by trusting
   * the body. A superAdmin has no company of their own, so they MUST name one
   * (`companyId`, the company UUID — a multipart text field, which multer parses
   * into `req.body`); every other caller is forced to their JWT company and a
   * `companyId` they send is ignored, not honoured.
   *
   * Responds and returns null on failure: 400 when no company can be determined,
   * 404 when the named company does not exist.
   */
  private async uploadTargetCompanyId(
    req: Request,
    res: Response,
  ): Promise<number | null> {
    const resolved = getCompanyForCreate(req);
    if (!resolved.success) {
      res.status(400).json({ success: false, message: resolved.message });
      return null;
    }
    const id = await this.dao.resolveCompanyId(resolved.companyUuid);
    if (!id) {
      res.status(404).json({ success: false, message: "Company not found" });
      return null;
    }
    return id;
  }

  public async upload(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const file = (req as any).file as
        | {
            originalname: string;
            mimetype: string;
            size: number;
            buffer: Buffer;
          }
        | undefined;
      if (!file) {
        res.status(400).json({
          success: false,
          message: "No file provided (field 'file').",
        });
        return;
      }
      const companyId = await this.uploadTargetCompanyId(req, res);
      if (companyId === null) return;

      const uuid = uuidv4();
      const storageKey = this.storage.buildStorageKey(
        companyId,
        uuid,
        file.originalname,
      );
      await this.storage.putObject(storageKey, file.buffer, file.mimetype);

      const uploadedBy = await this.dao.resolveUserId((req as any).user.userId);
      const created = await this.dao.create({
        uuid,
        companyId,
        originalName: file.originalname,
        description: req.body?.description ?? null,
        storageKey,
        contentType: file.mimetype,
        sizeBytes: file.size,
        checksum: this.storage.checksum(file.buffer),
        uploadedBy,
      });

      res.status(201).json({ success: true, data: created });
    } catch (err: any) {
      next(err);
    }
  }

  public async getAll(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      // Sets the top-level companyId query param the DAO's query config reads —
      // filters are flat (?companyId=...), NOT nested under ?filter[...].
      enforceCompanyFilter(req);
      const result = await this.dao.getAllWithFilters(req);
      res.status(200).json(result);
    } catch (err: any) {
      next(err);
    }
  }

  public async getByUuid(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyUuid = getCompanyFilterUuid(req);
      const file = await this.dao.getByUuid(req.params.uuid, companyUuid);
      if (!file) {
        res.status(404).json({ success: false, message: "File not found" });
        return;
      }
      res.status(200).json({ success: true, data: file });
    } catch (err: any) {
      next(err);
    }
  }

  public async download(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyUuid = getCompanyFilterUuid(req);
      const file = await this.dao.getByUuid(req.params.uuid, companyUuid);
      if (!file) {
        res.status(404).json({ success: false, message: "File not found" });
        return;
      }

      const url = await this.storage.getDownloadUrl(
        file.storageKey,
        file.originalName,
      );
      if (url) {
        res.redirect(302, url);
        return;
      }

      // Local-disk driver: stream through the API.
      if (!(await this.storage.localObjectExists(file.storageKey))) {
        res
          .status(404)
          .json({ success: false, message: "File bytes not found in storage" });
        return;
      }
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(file.originalName)}"`,
      );
      if (file.contentType) res.setHeader("Content-Type", file.contentType);
      this.storage.getLocalReadStream(file.storageKey).pipe(res);
    } catch (err: any) {
      next(err);
    }
  }

  public async copy(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyUuid = getCompanyFilterUuid(req);
      const source = await this.dao.getByUuid(req.params.uuid, companyUuid);
      if (!source) {
        res.status(404).json({ success: false, message: "File not found" });
        return;
      }
      const uuid = uuidv4();
      const destKey = this.storage.buildStorageKey(
        source.companyId,
        uuid,
        source.originalName,
      );
      await this.storage.copyObject(source.storageKey, destKey);
      const created = await this.dao.create({
        uuid,
        companyId: source.companyId,
        originalName: source.originalName,
        description: source.description,
        storageKey: destKey,
        contentType: source.contentType,
        sizeBytes: source.sizeBytes,
        checksum: source.checksum,
        uploadedBy: await this.dao.resolveUserId((req as any).user.userId),
      });
      res.status(201).json({ success: true, data: created });
    } catch (err: any) {
      next(err);
    }
  }

  public async delete(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const companyUuid = getCompanyFilterUuid(req);
      const file = await this.dao.getByUuid(req.params.uuid, companyUuid);
      if (!file || !file.id) {
        res.status(404).json({ success: false, message: "File not found" });
        return;
      }
      await this.dao.delete(file.id);
      // Row first, bytes second: a storage failure leaves an orphaned object,
      // never a dangling files row pointing at missing bytes.
      await this.storage.deleteObject(file.storageKey);
      res
        .status(200)
        .json({ success: true, message: "File deleted successfully" });
    } catch (err: any) {
      next(err);
    }
  }
}
