import { v4 as uuidv4 } from "uuid";
import { CustomerDAO } from "../dao/customer/customer.dao";
import { FileStorageService } from "./file-storage.service";
import { validateAvatarFile } from "./user-avatar.service";

/** Customer counterpart of UserAvatarService; callers resolve the tenant-scoped customer id. */
export class CustomerAvatarService {
  private customerDAO = new CustomerDAO();
  private storage = new FileStorageService();

  /** Throws AvatarValidationError for a missing or non-PNG/JPEG/WebP payload. */
  async set(customerId: number, file: Buffer | undefined): Promise<string> {
    const valid = validateAvatarFile(file);
    const avatarUuid = uuidv4();
    const key = this.storage.buildCustomerAvatarKey(avatarUuid);

    const { previousAvatarUuid } = await this.storage.putObjectThen(
      key,
      valid.file,
      valid.contentType,
      () =>
        this.customerDAO.setAvatar(customerId, avatarUuid, valid.contentType),
    );
    await this.dropObject(previousAvatarUuid);
    return avatarUuid;
  }

  async clear(customerId: number): Promise<void> {
    const { previousAvatarUuid } = await this.customerDAO.setAvatar(
      customerId,
      null,
      null,
    );
    await this.dropObject(previousAvatarUuid);
  }

  private async dropObject(avatarUuid: string | null): Promise<void> {
    if (!avatarUuid) return;
    await this.storage
      .deleteObject(this.storage.buildCustomerAvatarKey(avatarUuid))
      .catch((err) =>
        console.error(`Orphaned customer avatar object ${avatarUuid}:`, err),
      );
  }
}
