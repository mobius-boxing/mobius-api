/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('customers', function (table) {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('company_id').notNullable().references('id').inTable('companies').onDelete('CASCADE');
    table.uuid('customer_uuid').unique().notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('name').notNullable();
    table.string('supplier_code');
    table.uuid('sales_person_id').references('id').inTable('users').onDelete('SET NULL');
    table.uuid('category_id').references('id').inTable('customer_categories').onDelete('SET NULL');
    table.boolean('active').defaultTo(true);
    table.string('legal_name');
    table.text('address');
    table.string('trade_name');
    table.jsonb('contacts').defaultTo('[]');
    table.jsonb('delivery_locations').defaultTo('[]');
    table.jsonb('delivery_days').defaultTo('[]');
    table.timestamps(true, true);

    // Indexes for performance
    table.index(['company_id']);
    table.index(['sales_person_id']);
    table.index(['category_id']);
    table.index(['active']);
    table.index(['name']);
    table.index(['supplier_code']);
    table.unique(['company_id', 'customer_uuid']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('customers');
};
