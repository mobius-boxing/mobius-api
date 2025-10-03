/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.alterTable('users', function (table) {
    // Add new columns
    table.uuid('companyId').references('id').inTable('companies').onDelete('CASCADE');
    table.boolean('emailVerified').defaultTo(false);
  })
  .then(() => {
    // Rename columns to camelCase - must be done sequentially
    return knex.schema.raw('ALTER TABLE users RENAME COLUMN first_name TO "firstName"');
  })
  .then(() => {
    return knex.schema.raw('ALTER TABLE users RENAME COLUMN last_name TO "lastName"');
  })
  .then(() => {
    return knex.schema.raw('ALTER TABLE users RENAME COLUMN is_active TO "isActive"');
  })
  .then(() => {
    return knex.schema.raw('ALTER TABLE users RENAME COLUMN created_at TO "createdAt"');
  })
  .then(() => {
    return knex.schema.raw('ALTER TABLE users RENAME COLUMN updated_at TO "updatedAt"');
  })
  .then(() => {
    // Drop the old role column and add new enum
    return knex.schema.alterTable('users', function (table) {
      table.dropColumn('role');
    });
  })
  .then(() => {
    return knex.schema.alterTable('users', function (table) {
      table.enu('role', ['member', 'admin', 'superAdmin']).notNullable().defaultTo('member');
    });
  })
  .then(() => {
    // Add indexes for performance
    return knex.schema.alterTable('users', function (table) {
      table.index(['companyId']);
      table.index(['role']);
      table.index(['isActive']);
      table.index(['emailVerified']);
    });
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.alterTable('users', function (table) {
    // Drop new columns
    table.dropColumn('companyId');
    table.dropColumn('emailVerified');
    table.dropColumn('role');
  })
  .then(() => {
    // Restore old column names
    return knex.schema.raw('ALTER TABLE users RENAME COLUMN "firstName" TO first_name');
  })
  .then(() => {
    return knex.schema.raw('ALTER TABLE users RENAME COLUMN "lastName" TO last_name');
  })
  .then(() => {
    return knex.schema.raw('ALTER TABLE users RENAME COLUMN "isActive" TO is_active');
  })
  .then(() => {
    return knex.schema.raw('ALTER TABLE users RENAME COLUMN "createdAt" TO created_at');
  })
  .then(() => {
    return knex.schema.raw('ALTER TABLE users RENAME COLUMN "updatedAt" TO updated_at');
  })
  .then(() => {
    // Add back old role column
    return knex.schema.alterTable('users', function (table) {
      table.string('role').defaultTo('user');
    });
  });
};
