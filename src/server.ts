import { buildApp } from './app';
import { env } from './config/env';
import { startFirmsPoller } from './jobs/firms-poller';

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
