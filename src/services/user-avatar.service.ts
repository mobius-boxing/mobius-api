import { v4 as uuidv4 } from "uuid";
import { UserDAO } from "../dao/user/user.dao";
import { FileStorageService } from "./file-storage.service";
import { sniffImageType } from "../utils/image-sniff";

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export class AvatarValidationError extends Error {}

/**
 * The one place avatars are written, shared by `/auth/avatar` (self) and
 * `/users/:uuid/avatar` (admin). Callers authorize; this only stores.
 */
export class UserAvatarService {
  private userDAO = new UserDAO();
  private storage = new FileStorageService();

  /** Throws AvatarValidationError for a missing or non-PNG/JPEG/WebP payload. */
  async set(userId: number, file: Buffer | undefined): Promise<string> {
    if (!file || file.length === 0) {
      throw new AvatarValidationError("No file uploaded.");
    }
    const contentType = sniffImageType(file);
    if (!contentType) {
      throw new AvatarValidationError(
        "Unsupported image. Use a PNG, JPEG or WebP file.",
      );
    }
    const avatarUuid = uuidv4();
    const key = this.storage.buildAvatarKey(avatarUuid);

    const { previousAvatarUuid } = await this.storage.putObjectThen(
      key,
      file,
      contentType,
      () => this.userDAO.setAvatar(userId, avatarUuid, contentType),
    );
    await this.dropObject(previousAvatarUuid);
    return avatarUuid;
  }

  async clear(userId: number): Promise<void> {
    const { previousAvatarUuid } = await this.userDAO.setAvatar(
      userId,
      null,
      null,
    );
    await this.dropObject(previousAvatarUuid);
  }

  private async dropObject(avatarUuid: string | null): Promise<void> {
    if (!avatarUuid) return;
    await this.storage
      .deleteObject(this.storage.buildAvatarKey(avatarUuid))
      .catch((err) =>
        console.error(`Orphaned avatar object ${avatarUuid}:`, err),
      );
  }
}
