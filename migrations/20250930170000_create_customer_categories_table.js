/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('customer_categories', function (table) {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('customer_category_uuid').unique().notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('name').notNullable();
    table.uuid('company_id').notNullable().references('id').inTable('companies').onDelete('CASCADE');
    table.timestamps(true, true);

    // Indexes for performance
    table.index(['company_id']);
    table.index(['name']);
    table.unique(['company_id', 'name']); // Unique category name per company
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('customer_categories');
};
