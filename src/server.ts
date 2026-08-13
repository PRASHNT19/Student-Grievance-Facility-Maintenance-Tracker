import { app } from './app';
import { config } from './config';
import { runMigrations } from './data/migrate';
import dotenv from "dotenv";


dotenv.config();
/**
 * Migrations run on start-up. They are idempotent, which keeps `docker compose
 * up` a single reproducible command: the database schema, including the three
 * integrity guarantees, is always in place before the first request arrives.
 */
async function start(): Promise<void> {
  const applied = await runMigrations();
  console.log(
    applied.length
      ? `Applied migrations: ${applied.join(', ')}`
      : 'Database schema is up to date.',
  );

  app.listen(config.port, () => {
    console.log(`Listening on http://localhost:${config.port}`);
    console.log(`Swagger UI at http://localhost:${config.port}/docs`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
