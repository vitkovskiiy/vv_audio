import Fastify, { LogController, type FastifyError } from 'fastify';
import { log, newBpId, runInContext } from './context';
import { AppError, NotFoundError } from './errors';
import { rootLogger } from './logger';
import { systemRoutes } from './routes/system';

export interface ErrorBody {
  error: { code: string; message: string; bpId: string; details?: unknown };
}

export type App = ReturnType<typeof buildApp>;

export function buildApp() {
  const app = Fastify({
    loggerInstance: rootLogger(),
    // the request ID is the business-process ID; Fastify binds it to request.log under this label
    genReqId: () => newBpId(),
    logController: new LogController({ requestIdLogLabel: 'bpId' }),
  });

  // every hook and handler after this runs inside the request's context
  app.addHook('onRequest', (request, reply, done) => {
    reply.header('x-bp-id', request.id);
    runInContext({ bpId: request.id, log: request.log }, done);
  });

  // the one place where errors become HTTP responses
  app.setErrorHandler((err: FastifyError | AppError, request, reply) => {
    let status: number;
    let code: string;
    let message: string;
    let details: unknown;

    if (err instanceof AppError) {
      ({ status, code, message, details } = err);
    } else if ((err as FastifyError).validation) {
      status = 400;
      code = 'VALIDATION_ERROR';
      message = 'Некоректні дані запиту';
      details = (err as FastifyError).validation;
    } else if ((err as FastifyError).statusCode && (err as FastifyError).statusCode! < 500) {
      // Fastify's own client errors: malformed JSON, body too large, wrong content type
      status = (err as FastifyError).statusCode!;
      code = (err as FastifyError).code ?? 'BAD_REQUEST';
      message = err.message;
    } else {
      status = 500;
      code = 'INTERNAL';
      message = 'Внутрішня помилка сервера';
    }

    if (status >= 500) log().error({ err }, 'request failed');
    else log().info({ code, status }, err.message);

    const body: ErrorBody = { error: { code, message, bpId: request.id, ...(details ? { details } : {}) } };
    reply.status(status).send(body);
  });

  app.setNotFoundHandler(() => {
    throw new NotFoundError('Такого маршруту немає');
  });

  app.register(systemRoutes);
  return app;
}
