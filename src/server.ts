import Fastify, { FastifyInstance } from "fastify";
import { env } from "./config/env";
import firesRoutes from "./routes/fires";
import activeRoutes from "./routes/active";
import riskRoutes from "./routes/risk";

const buildApp = (): FastifyInstance => {
  const app: FastifyInstance = Fastify({ logger: true });

  app.register(import("@fastify/cors"), { origin: true });

  app.register(firesRoutes, { prefix: "/fires" });
  app.register(activeRoutes, { prefix: "/active" });
  app.register(riskRoutes, { prefix: "/risk" });

  return app;
};

const start = async (): Promise<void> => {
  const app = buildApp();

  try {
    await app.listen({ port: env.port, host: "0.0.0.0" });
    app.log.info(`Server running on http://localhost:${env.port}`);
  } catch (error: unknown) {
    app.log.error(error);
    process.exit(1);
  }
};

void start();
