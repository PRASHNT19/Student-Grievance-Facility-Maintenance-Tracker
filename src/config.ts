export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl:
    process.env.DATABASE_URL ??
    'postgres://campus:campus@localhost:5432/campus',
  nodeEnv: process.env.NODE_ENV ?? 'development',
};
