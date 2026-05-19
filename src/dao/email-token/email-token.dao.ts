import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { IEmailToken } from "../../interfaces/email-token/email-token.interfaces";

export class EmailTokenDAO implements IBaseDAO<IEmailToken> {
  private tableName = "emailTokens";

  async create(item: IEmailToken): Promise<IEmailToken> {
    const knex = KnexManager.getConnection();
    const [token] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        userId: item.userId,
        token: item.token,
        type: item.type,
        expiresAt: item.expiresAt,
        isUsed: item.isUsed ?? false,
      })
      .returning("*");

    return this.mapToInterface(token);
  }

  async getById(id: number): Promise<IEmailToken | null> {
    const knex = KnexManager.getConnection();
    const token = await knex(this.tableName).where("id", id).first();

    return token ? this.mapToInterface(token) : null;
  }

  async getByUuid(uuid: string): Promise<IEmailToken | null> {
    const knex = KnexManager.getConnection();
    const token = await knex(this.tableName).where("uuid", uuid).first();

    return token ? this.mapToInterface(token) : null;
  }

  async update(
    id: number,
    item: Partial<IEmailToken>,
  ): Promise<IEmailToken | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.userId !== undefined) updateData.userId = item.userId;
    if (item.token !== undefined) updateData.token = item.token;
    if (item.type !== undefined) updateData.type = item.type;
    if (item.expiresAt !== undefined) updateData.expiresAt = item.expiresAt;
    if (item.isUsed !== undefined) updateData.isUsed = item.isUsed;

    updateData.updated_at = knex.fn.now();

    const [token] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return token ? this.mapToInterface(token) : null;
  }

  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  async getAll(
    page: number,
    limit: number,
  ): Promise<IDataPaginator<IEmailToken>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;

    const [tokens, totalResult] = await Promise.all([
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
      data: tokens.map((token) => this.mapToInterface(token)),
      page,
      limit,
      count: tokens.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  async getByToken(token: string): Promise<IEmailToken | null> {
    const knex = KnexManager.getConnection();
    const emailToken = await knex(this.tableName).where("token", token).first();

    return emailToken ? this.mapToInterface(emailToken) : null;
  }

  // "Valid" = unused AND not expired; returns the most-recently issued one.
  async getValidToken(
    userId: number,
    type: "email_verification" | "password_reset",
  ): Promise<IEmailToken | null> {
    const knex = KnexManager.getConnection();
    const token = await knex(this.tableName)
      .where("userId", userId)
      .where("type", type)
      .where("isUsed", false)
      .where("expiresAt", ">", knex.fn.now())
      .orderBy("created_at", "desc")
      .first();

    return token ? this.mapToInterface(token) : null;
  }

  private mapToInterface(record: any): IEmailToken {
    return {
      id: record.id,
      uuid: record.uuid,
      userId: record.userId,
      token: record.token,
      type: record.type,
      expiresAt: record.expiresAt,
      isUsed: record.isUsed ?? false,
      createdAt: record.created_at ?? record.createdAt,
      updatedAt: record.updated_at ?? record.updatedAt,
    };
  }
}
