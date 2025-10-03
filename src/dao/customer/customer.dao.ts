import KnexManager from "../../database/KnexConnection";
import { IBaseDAO, IDataPaginator } from "../../database/d.types";
import { ICustomer } from "../../interfaces/customer/customer.interfaces";

export class CustomerDAO implements IBaseDAO<ICustomer> {
  private tableName = "customers";

  /**
   * Create a new customer
   */
  async create(item: ICustomer): Promise<ICustomer> {
    const knex = KnexManager.getConnection();
    const [customer] = await knex(this.tableName)
      .insert({
        uuid: item.uuid,
        company_id: item.companyId,
        customer_uuid: item.customerUuid,
        name: item.name,
        supplier_code: item.supplierCode,
        sales_person_id: item.salesPersonId,
        category_id: item.categoryId,
        active: item.active ?? true,
        legal_name: item.legalName,
        address: item.address,
        trade_name: item.tradeName,
        contacts: JSON.stringify(item.contacts || []),
        delivery_locations: JSON.stringify(item.deliveryLocations || []),
        delivery_days: JSON.stringify(item.deliveryDays || []),
      })
      .returning("*");

    return this.mapToInterface(customer);
  }

  /**
   * Get customer by ID
   */
  async getById(id: number): Promise<ICustomer | null> {
    const knex = KnexManager.getConnection();
    const customer = await knex(this.tableName).where("id", id).first();

    return customer ? this.mapToInterface(customer) : null;
  }

  /**
   * Get customer by UUID
   */
  async getByUuid(uuid: string): Promise<ICustomer | null> {
    const knex = KnexManager.getConnection();
    const customer = await knex(this.tableName).where("uuid", uuid).first();

    return customer ? this.mapToInterface(customer) : null;
  }

  /**
   * Update customer by ID
   */
  async update(id: number, item: Partial<ICustomer>): Promise<ICustomer | null> {
    const knex = KnexManager.getConnection();
    const updateData: any = {};

    if (item.name !== undefined) updateData.name = item.name;
    if (item.supplierCode !== undefined) updateData.supplier_code = item.supplierCode;
    if (item.salesPersonId !== undefined) updateData.sales_person_id = item.salesPersonId;
    if (item.categoryId !== undefined) updateData.category_id = item.categoryId;
    if (item.active !== undefined) updateData.active = item.active;
    if (item.legalName !== undefined) updateData.legal_name = item.legalName;
    if (item.address !== undefined) updateData.address = item.address;
    if (item.tradeName !== undefined) updateData.trade_name = item.tradeName;
    if (item.contacts !== undefined) updateData.contacts = JSON.stringify(item.contacts);
    if (item.deliveryLocations !== undefined) updateData.delivery_locations = JSON.stringify(item.deliveryLocations);
    if (item.deliveryDays !== undefined) updateData.delivery_days = JSON.stringify(item.deliveryDays);

    updateData.updated_at = knex.fn.now();

    const [customer] = await knex(this.tableName)
      .where("id", id)
      .update(updateData)
      .returning("*");

    return customer ? this.mapToInterface(customer) : null;
  }

  /**
   * Delete customer by ID
   */
  async delete(id: number): Promise<boolean> {
    const knex = KnexManager.getConnection();
    const deleted = await knex(this.tableName).where("id", id).delete();

    return deleted > 0;
  }

  /**
   * Get all customers with pagination
   */
  async getAll(page: number, limit: number): Promise<IDataPaginator<ICustomer>> {
    const knex = KnexManager.getConnection();
    const offset = (page - 1) * limit;

    const [customers, totalResult] = await Promise.all([
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
      data: customers.map((customer) => this.mapToInterface(customer)),
      page,
      limit,
      count: customers.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    };
  }

  /**
   * Get customer with related details (company, category, salesPerson) using to_jsonb
   */
  async getCustomerWithDetails(uuid: string): Promise<ICustomer | null> {
    const knex = KnexManager.getConnection();

    const customer = await knex(this.tableName)
      .select(
        "customers.*",
        knex.raw("to_jsonb(companies.*) as company"),
        knex.raw("to_jsonb(customer_categories.*) as category"),
        knex.raw(`to_jsonb(row(users.id, users.uuid, users.email, users.first_name, users.last_name, users.role)::record) as sales_person`)
      )
      .leftJoin("companies", "customers.company_id", "companies.id")
      .leftJoin("customer_categories", "customers.category_id", "customer_categories.id")
      .leftJoin("users", "customers.sales_person_id", "users.id")
      .where("customers.uuid", uuid)
      .first();

    if (!customer) return null;

    const mapped = this.mapToInterface(customer);
    mapped.company = customer.company;
    mapped.category = customer.category;
    mapped.salesPerson = customer.sales_person;

    return mapped;
  }

  /**
   * Map database record to interface
   */
  private mapToInterface(record: any): ICustomer {
    // Parse JSON fields
    let contacts = [];
    let deliveryLocations = [];
    let deliveryDays = [];

    try {
      if (record.contacts) {
        contacts = typeof record.contacts === 'string' ? JSON.parse(record.contacts) : record.contacts;
      }
      if (record.delivery_locations) {
        deliveryLocations = typeof record.delivery_locations === 'string' ? JSON.parse(record.delivery_locations) : record.delivery_locations;
      }
      if (record.delivery_days) {
        deliveryDays = typeof record.delivery_days === 'string' ? JSON.parse(record.delivery_days) : record.delivery_days;
      }
    } catch (error) {
      console.error('Error parsing customer JSON fields:', error);
    }

    return {
      id: record.id,
      uuid: record.uuid,
      companyId: record.company_id ?? record.companyId,
      customerUuid: record.customer_uuid ?? record.customerUuid,
      name: record.name,
      supplierCode: record.supplier_code ?? record.supplierCode,
      salesPersonId: record.sales_person_id ?? record.salesPersonId,
      categoryId: record.category_id ?? record.categoryId,
      active: record.active ?? true,
      legalName: record.legal_name ?? record.legalName,
      address: record.address,
      tradeName: record.trade_name ?? record.tradeName,
      contacts,
      deliveryLocations,
      deliveryDays,
      createdAt: record.created_at ?? record.createdAt,
      updatedAt: record.updated_at ?? record.updatedAt,
    };
  }
}
