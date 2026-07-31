import type { INestApplication } from '@nestjs/common';
import { Logger } from 'nestjs-pino';


export const useObservabilityLogger = (app: INestApplication): void => {
  app.useLogger(app.get(Logger));
  app.flushLogs();
};
