import dotenv from "dotenv";

dotenv.config();

function getRequiredEnv(
  name: string,
): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}`,
    );
  }

  return value;
}

export const config = {
  nodeEnv:
    process.env.NODE_ENV ?? "development",

  port: Number(
    process.env.PORT ?? 3000,
  ),

  databaseUrl:
    getRequiredEnv("DATABASE_URL"),
};