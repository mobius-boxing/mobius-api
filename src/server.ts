import dotenv from "dotenv";
import KnexManager from "./database/KnexConnection";
dotenv.config();

const envPort: string = process.env.PORT || "3005";

if (isNaN(parseInt(envPort))) {
  throw new Error("The port must to be a number");
}

const PORT: number = parseInt(envPort);

(async () => {
  // Initialize Knex database connection
  try {
    await KnexManager.connect();
    console.info("Database connection established successfully");
  } catch (error) {
    console.error("Failed to connect to database:", error);
    process.exit(1);
  }
})().then(async () => {
  const { default: app } = await import("./app");
  app.listen(PORT, () => console.info(`Server up and running on port ${PORT}`));
});
