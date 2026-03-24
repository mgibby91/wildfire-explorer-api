import dotenv from "dotenv";

dotenv.config();

function required(name: string, value?: string): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 3001),

  db: {
    host: required("DB_HOST", process.env.DB_HOST),
    port: Number(process.env.DB_PORT ?? 5432),
    database: required("DB_NAME", process.env.DB_NAME),
    user: required("DB_USER", process.env.DB_USER),
    password: required("DB_PASSWORD", process.env.DB_PASSWORD),
  },
};
