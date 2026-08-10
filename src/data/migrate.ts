import fs from "fs/promises";
import path from "path";
import { pool, withTransaction } from "./db";

const MIGRATIONS_DIR = path.resolve(
  process.cwd(),
  "migrations",
);

async function ensureMigrationTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function runMigrations(): Promise<void> {
  await ensureMigrationTable();

  const files = (await fs.readdir(MIGRATIONS_DIR))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const filename of files) {
    const alreadyApplied = await pool.query(
      `
        SELECT filename
        FROM schema_migrations
        WHERE filename = $1
      `,
      [filename],
    );

    if (alreadyApplied.rowCount && alreadyApplied.rowCount > 0) {
      console.log(`Skipping ${filename}`);
      continue;
    }

    const filePath = path.join(
      MIGRATIONS_DIR,
      filename,
    );

    const sql = await fs.readFile(
      filePath,
      "utf8",
    );

    console.log(`Applying ${filename}...`);

    await withTransaction(async (client) => {
      await client.query(sql);

      await client.query(
        `
          INSERT INTO schema_migrations (filename)
          VALUES ($1)
        `,
        [filename],
      );
    });

    console.log(`Applied ${filename}`);
  }

  console.log("Database migrations complete.");
}

if (require.main === module) {
  runMigrations()
    .catch((error) => {
      console.error(
        "Migration failed:",
        error,
      );

      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}

export { runMigrations };