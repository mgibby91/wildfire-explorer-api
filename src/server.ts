import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { env } from './config/env';
import firesRoutes from './routes/fires';
import activeRoutes from './routes/active';
import riskRoutes from './routes/risk';
import { startFirmsPoller } from './jobs/firms-poller';

const buildApp = (): FastifyInstance => {
  const app: FastifyInstance = Fastify({ logger: true });

  app.register(cors, { origin: 'https://wildfire-explorer-web.vercel.app' });

  app.register(firesRoutes, { prefix: '/api/fires' });
  app.register(activeRoutes, { prefix: '/api/active' });
  app.register(riskRoutes, { prefix: '/api/risk' });

  return app;
};

const start = async (): Promise<void> => {
  const app = buildApp();

  try {
    await app.listen({ port: env.port, host: '0.0.0.0' });
    app.log.info(`Server running on http://localhost:${env.port}`);
    startFirmsPoller();
  } catch (error: unknown) {
    app.log.error(error);
    process.exit(1);
  }
};

void start();
