import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import firesRoutes from './routes/fires';
import activeRoutes from './routes/active';
import riskRoutes from './routes/risk';

export const buildApp = (): FastifyInstance => {
  const app = Fastify({ logger: false });

  app.register(cors, {
    origin: [
      'https://wildfire-explorer-web.vercel.app',
      'http://localhost:5173',
    ],
  });

  app.register(firesRoutes, { prefix: '/api/fires' });
  app.register(activeRoutes, { prefix: '/api/active' });
  app.register(riskRoutes, { prefix: '/api/risk' });

  return app;
};
