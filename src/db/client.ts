import { Pool } from "pg";
import { env } from "../config/env";

export const db: Pool = new Pool({
  host: env.db.host,
  port: env.db.port,
  database: env.db.database,
  user: env.db.user,
  password: env.db.password,
});
