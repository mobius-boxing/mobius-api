/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('emailTokens', function (table) {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('userId').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('token').unique().notNullable();
    table.enu('type', ['email_verification', 'password_reset']).notNullable();
    table.timestamp('expiresAt').notNullable();
    table.boolean('isUsed').defaultTo(false);
    table.timestamps(true, true);

    // Indexes for performance
    table.index(['token']);
    table.index(['userId', 'type']);
    table.index(['expiresAt']);
    table.index(['isUsed']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('emailTokens');
};
