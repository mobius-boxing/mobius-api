import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // 1. Make companyId nullable (to support superAdmin invitations)
  await knex.schema.raw(`
    ALTER TABLE invitations
    ALTER COLUMN "companyId" DROP NOT NULL
  `);

  // 2. Update the role enum to include 'superAdmin'
  // First, drop the existing check constraint
  await knex.schema.raw(`
    ALTER TABLE invitations
    DROP CONSTRAINT IF EXISTS invitations_role_check
  `);

  // Then, add the new constraint with 'superAdmin' included
  await knex.schema.raw(`
    ALTER TABLE invitations
    ADD CONSTRAINT invitations_role_check
    CHECK (role IN ('member', 'admin', 'superAdmin'))
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Reverse the changes

  // 1. Make companyId NOT NULL again
  await knex.schema.raw(`
    ALTER TABLE invitations
    ALTER COLUMN "companyId" SET NOT NULL
  `);

  // 2. Revert role enum to original values (remove 'superAdmin')
  await knex.schema.raw(`
    ALTER TABLE invitations
    DROP CONSTRAINT IF EXISTS invitations_role_check
  `);

  await knex.schema.raw(`
    ALTER TABLE invitations
    ADD CONSTRAINT invitations_role_check
    CHECK (role IN ('member', 'admin'))
  `);
}
