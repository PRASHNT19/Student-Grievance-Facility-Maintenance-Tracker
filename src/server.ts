import app from "./app";
import { config } from "./config";
import { runMigrations } from "./data/migrate";

async function startServer(): Promise<void> {
  await runMigrations();

  app.listen(config.port, () => {
    console.log(`Server running on http://localhost:${config.port}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);

  process.exit(1);
});
