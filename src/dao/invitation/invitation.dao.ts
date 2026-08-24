import { db } from "../../database/registry";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { IInvitation } from "../../interfaces/invitation/invitation.interfaces";
import { applyCompanyUuidScope } from "../../utils/daoScope";
import { hashToken } from "../../utils/tokenHash";

export class InvitationDAO implements IBaseDAO<IInvitation> {
  private tableName = "invitations";

  async create(item: IInvitation): Promise<IInvitation> {
    const knex = db("core");
    const [invitation] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        email: item.email,
        // SECURITY (M5): store only the hash; the raw token lives in the email link.
        token: item.token ? hashToken(item.token) : item.token,
        role: item.role,
        companyId: item.companyId,
        invitedBy: item.invitedBy,
        expiresAt: item.expiresAt,
        acceptedAt: item.acceptedAt,
        isUsed: item.isUsed ?? false,
      })
      .returning("*");

    // Return the safe (token-less) shape on create; the caller already holds the raw token.
    return this.mapToSafe(invitation);
  }

  async getById(id: number): Promise<IInvitation | null> {
    const knex = db("core");
    const invitation = await knex(this.tableName).where("id", id).first();

    return invitation ? this.mapToSafe(invitation) : null;
  }

  // SECURITY (C4): companyUuid, when provided, scopes the lookup to the caller's company.
  async getByUuid(
    uuid: string,
    companyUuid?: string,
  ): Promise<IInvitation | null> {
    const knex = db("core");
    const query = knex(this.tableName).where(`${this.tableName}.uuid`, uuid);
    applyCompanyUuidScope(query, this.tableName, companyUuid);
    const invitation = await query.select(`${this.tableName}.*`).first();

    // SECURITY (C4): never leak the (hashed) token in single-record responses.
    return invitation ? this.mapToSafe(invitation) : null;
  }

  async update(
    id: number,
    item: Partial<IInvitation>,
  ): Promise<IInvitation | null> {
    const knex = db("core");
    const updateData: any = {};

    if (item.email !== undefined) updateData.email = item.email;
    // SECURITY (M5): if a token is ever rotated, store the hash, not the raw value.
    if (item.token !== undefined) updateData.token = hashToken(item.token);
    if (item.role !== undefined) updateData.role = item.role;
    if (item.companyId !== undefined) updateData.companyId = item.companyId;
    if (item.invitedBy !== undefined) updateData.invitedBy = item.invitedBy;
    if (item.expiresAt !== undefined) updateData.expiresAt = item.expiresAt;
    if (item.acceptedAt !== undefined) updateData.acceptedAt = item.acceptedAt;
    if (item.isUsed !== undefined) updateData.isUsed = item.isUsed;

    updateData.updated_at = knex.fn.now();

    const [invitation] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return invitation ? this.mapToSafe(invitation) : null;
  }

  async delete(id: number): Promise<boolean> {
    const knex = db("core");
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  // SECURITY (C4): companyUuid, when provided, restricts the list to that company's invitations.
  async getAll(
    page: number,
    limit: number,
    companyUuid?: string,
  ): Promise<IDataPaginator<IInvitation>> {
    const knex = db("core");
    const offset = (page - 1) * limit;

    const dataQuery = knex(this.tableName);
    const countQuery = knex(this.tableName);
    applyCompanyUuidScope(dataQuery, this.tableName, companyUuid);
    applyCompanyUuidScope(countQuery, this.tableName, companyUuid);

    const [invitations, totalResult] = await Promise.all([
      dataQuery
        .select(`${this.tableName}.*`)
        .orderBy(`${this.tableName}.created_at`, "desc")
        .limit(limit)
        .offset(offset),
      countQuery.count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      // SECURITY (C4): list responses never include the token.
      data: invitations.map((invitation) => this.mapToSafe(invitation)),
      page,
      limit,
      count: invitations.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  // SECURITY (M5): the caller passes the RAW token; we hash it to match the stored hash.
  // Returns the full (token-bearing) shape because internal accept/register flows need to
  // re-verify and consume the invitation — this result is never sent verbatim to clients.
  async getByToken(rawToken: string): Promise<IInvitation | null> {
    const knex = db("core");
    const hashed = hashToken(rawToken);
    let invitation = await knex(this.tableName).where("token", hashed).first();

    // TRANSITION (hash cutover): invitations issued before hashing shipped
    // are stored in plaintext (7-day TTL). Fall back to a plaintext match and
    // upgrade the row in place. Remove once pre-cutover invites have expired.
    if (!invitation) {
      invitation = await knex(this.tableName).where("token", rawToken).first();
      if (invitation) {
        await knex(this.tableName)
          .where("id", invitation.id)
          .update({ token: hashed });
      }
    }

    return invitation ? this.mapToInterface(invitation) : null;
  }

  // "Active" = unused AND not expired. SECURITY (C4): scoped by company UUID.
  async getActiveInvitations(companyUuid?: string): Promise<IInvitation[]> {
    const knex = db("core");
    const query = knex(this.tableName)
      .where(`${this.tableName}.isUsed`, false)
      .where(`${this.tableName}.expiresAt`, ">", knex.fn.now());
    applyCompanyUuidScope(query, this.tableName, companyUuid);

    const invitations = await query
      .select(`${this.tableName}.*`)
      .orderBy(`${this.tableName}.created_at`, "desc");

    // SECURITY (C4): strip the token from active-list responses.
    return invitations.map((invitation) => this.mapToSafe(invitation));
  }

  // Full mapping including the (hashed) token — for internal use only (getByToken).
  private mapToInterface(record: any): IInvitation {
    return {
      id: record.id,
      uuid: record.uuid,
      email: record.email,
      token: record.token,
      role: record.role,
      companyId: record.companyId,
      invitedBy: record.invitedBy,
      expiresAt: record.expiresAt,
      acceptedAt: record.acceptedAt,
      isUsed: record.isUsed ?? false,
      createdAt: record.created_at ?? record.createdAt,
      updatedAt: record.updated_at ?? record.updatedAt,
    };
  }

  // SECURITY (C4): token-less mapping for any response that leaves the server.
  private mapToSafe(record: any): IInvitation {
    const mapped = this.mapToInterface(record);
    delete mapped.token;
    return mapped;
  }
}
