/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('invitations', function (table) {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('email').notNullable();
    table.string('token').unique().notNullable();
    table.enu('role', ['member', 'admin']).notNullable();
    table.uuid('companyId').notNullable().references('id').inTable('companies').onDelete('CASCADE');
    table.uuid('invitedBy').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.timestamp('expiresAt').notNullable();
    table.timestamp('acceptedAt');
    table.boolean('isUsed').defaultTo(false);
    table.timestamps(true, true);

    // Indexes for performance
    table.index(['email', 'companyId']);
    table.index(['token']);
    table.index(['companyId']);
    table.index(['invitedBy']);
    table.index(['isUsed']);
    table.index(['expiresAt']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('invitations');
};
