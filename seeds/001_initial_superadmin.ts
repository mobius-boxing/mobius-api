import { Knex } from "knex";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";

export async function seed(knex: Knex): Promise<void> {
  const email = "superadmin@mobius.local";

  // Check if superadmin already exists
  const existing = await knex("users").where({ email }).first();

  if (!existing) {
    // Hash password with 10 salt rounds (matching controllers)
    const hashedPassword = await bcrypt.hash("SuperAdmin123!", 10);

    // Insert superadmin user
    await knex("users").insert({
      uuid: uuidv4(),
      email: email,
      password: hashedPassword,
      firstName: "Super",
      lastName: "Admin",
      role: "superAdmin",
      companyId: null, // SuperAdmins don't belong to a company
      isActive: true,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    console.log("✓ SuperAdmin user created successfully");
  } else {
    console.log("✓ SuperAdmin user already exists");
  }
}
