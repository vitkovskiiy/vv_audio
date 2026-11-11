import pino, { type DestinationStream, type Logger } from 'pino';

let root: Logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

/** replace the process-wide logger, e.g. to capture output in tests */
export function configureLogger(destination?: DestinationStream, level = process.env.LOG_LEVEL ?? 'info'): Logger {
  root = destination ? pino({ level }, destination) : pino({ level });
  return root;
}

export function rootLogger(): Logger {
  return root;
}
