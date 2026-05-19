import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { IInvitation } from "../../interfaces/invitation/invitation.interfaces";

export class InvitationDAO implements IBaseDAO<IInvitation> {
  private tableName = "invitations";

  async create(item: IInvitation): Promise<IInvitation> {
    const knex = KnexManager.getConnection();
    const [invitation] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        email: item.email,
        token: item.token,
        role: item.role,
        companyId: item.companyId,
        invitedBy: item.invitedBy,
        expiresAt: item.expiresAt,
        acceptedAt: item.acceptedAt,
        isUsed: item.isUsed ?? false,
      })
      .returning("*");

    return this.mapToInterface(invitation);
  }

  async getById(id: number): Promise<IInvitation | null> {
    const knex = KnexManager.getConnection();
    const invitation = await knex(this.tableName).where("id", id).first();

    return invitation ? this.mapToInterface(invitation) : null;
  }

  async getByUuid(uuid: string): Promise<IInvitation | null> {
    const knex = KnexManager.getConnection();
    const invitation = await knex(this.tableName).where("uuid", uuid).first();

    return invitation ? this.mapToInterface(invitation) : null;
  }

  async update(
    id: number,
    item: Partial<IInvitation>,
  ): Promise<IInvitation | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.email !== undefined) updateData.email = item.email;
    if (item.token !== undefined) updateData.token = item.token;
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

    return invitation ? this.mapToInterface(invitation) : null;
  }

  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  async getAll(
    page: number,
    limit: number,
  ): Promise<IDataPaginator<IInvitation>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;

    const [invitations, totalResult] = await Promise.all([
      knex(this.tableName)
        .select("*")
        .orderBy("created_at", "desc")
        .limit(limit)
        .offset(offset),
      knex(this.tableName).count("* as count").first(),
    ]);

    const totalCount = parseInt(totalResult?.count as string) || 0;

    return {
      success: true,
      data: invitations.map((invitation) => this.mapToInterface(invitation)),
      page,
      limit,
      count: invitations.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  async getByToken(token: string): Promise<IInvitation | null> {
    const knex = KnexManager.getConnection();
    const invitation = await knex(this.tableName).where("token", token).first();

    return invitation ? this.mapToInterface(invitation) : null;
  }

  // "Active" = unused AND not expired.
  async getActiveInvitations(companyId: number): Promise<IInvitation[]> {
    const knex = KnexManager.getConnection();
    const invitations = await knex(this.tableName)
      .where("companyId", companyId)
      .where("isUsed", false)
      .where("expiresAt", ">", knex.fn.now())
      .orderBy("created_at", "desc");

    return invitations.map((invitation) => this.mapToInterface(invitation));
  }

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
}
