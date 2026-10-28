import type { FastifyPluginAsync } from 'fastify';
import * as playback from '../services/playback.service';
import * as queue from '../services/queue.service';
import * as requests from '../services/requests.service';
import * as rooms from '../services/rooms.service';
import * as social from '../services/social.service';
import { codeParams, idempotencyKey, uuid } from './http';

type Code = { code: string };
type CodeItem = { code: string; itemId: string };

const codeItemParams = { type: 'object', required: ['code', 'itemId'], properties: { ...codeParams.properties, itemId: uuid } } as const;
const body = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', required, properties, additionalProperties: false }) as const;

export const roomRoutes: FastifyPluginAsync = async (app) => {
  // rooms
  app.post('/api/rooms', async (request, reply) => {
    const r = await rooms.createRoom(idempotencyKey(request));
    reply.status(r.status);
    return r.body;
  });

  app.get('/api/rooms/mine', async () => rooms.myRooms());

  app.post<{ Params: Code }>('/api/rooms/:code/join', { schema: { params: codeParams } }, async (request) => rooms.joinRoom(request.params.code));

  app.get<{ Params: Code }>('/api/rooms/:code', { schema: { params: codeParams } }, async (request) => rooms.roomState(request.params.code));

  app.delete<{ Params: Code }>('/api/rooms/:code', { schema: { params: codeParams } }, async (request, reply) => {
    await rooms.deleteRoom(request.params.code);
    reply.status(204);
  });

  // queue
  app.get<{ Params: Code }>('/api/rooms/:code/queue', { schema: { params: codeParams } }, async (request) => queue.upcoming(request.params.code));

  app.post<{ Params: Code; Body: { url: string } }>(
    '/api/rooms/:code/queue',
    { schema: { params: codeParams, body: body({ url: { type: 'string', minLength: 1, maxLength: 500 } }, ['url']) } },
    async (request, reply) => {
      const r = await queue.addTrack(request.params.code, request.body.url, idempotencyKey(request));
      reply.status(r.status);
      return r.body;
    },
  );

  app.delete<{ Params: CodeItem }>('/api/rooms/:code/queue/:itemId', { schema: { params: codeItemParams } }, async (request, reply) => {
    await queue.removeItem(request.params.code, request.params.itemId);
    reply.status(204);
  });

  app.post<{ Params: CodeItem; Body: { direction: 'up' | 'down' } }>(
    '/api/rooms/:code/queue/:itemId/move',
    { schema: { params: codeItemParams, body: body({ direction: { enum: ['up', 'down'] } }, ['direction']) } },
    async (request) => {
      await queue.moveItem(request.params.code, request.params.itemId, request.body.direction);
      return queue.upcoming(request.params.code);
    },
  );

  app.post<{ Params: CodeItem }>('/api/rooms/:code/queue/:itemId/play-next', { schema: { params: codeItemParams } }, async (request) => {
    await queue.playNext(request.params.code, request.params.itemId);
    return queue.upcoming(request.params.code);
  });

  // playback
  app.post<{ Params: Code; Body: { action: 'play' | 'pause' | 'seek'; positionSec?: number } }>(
    '/api/rooms/:code/playback',
    {
      schema: {
        params: codeParams,
        body: body({ action: { enum: ['play', 'pause', 'seek'] }, positionSec: { type: 'number', minimum: 0, maximum: 86400 } }, ['action']),
      },
    },
    async (request) => playback.control(request.params.code, request.body.action, request.body.positionSec),
  );

  app.post<{ Params: Code; Body: { expectedItemId: string | null } }>(
    '/api/rooms/:code/playback/next',
    { schema: { params: codeParams, body: body({ expectedItemId: { anyOf: [uuid, { type: 'null' }] } }, ['expectedItemId']) } },
    async (request) => playback.next(request.params.code, request.body.expectedItemId),
  );

  app.post<{ Params: Code; Body: { itemId: string } }>(
    '/api/rooms/:code/playback/ended',
    { schema: { params: codeParams, body: body({ itemId: uuid }, ['itemId']) } },
    async (request) => playback.ended(request.params.code, request.body.itemId),
  );

  // requests to the owner
  app.post<{ Params: Code; Body: { type: 'remove' | 'skip'; itemId: string } }>(
    '/api/rooms/:code/requests',
    { schema: { params: codeParams, body: body({ type: { enum: ['remove', 'skip'] }, itemId: uuid }, ['type', 'itemId']) } },
    async (request, reply) => {
      const r = await requests.createRequest(request.params.code, request.body.type, request.body.itemId);
      reply.status(r.status);
      return r.body;
    },
  );

  app.post<{ Params: Code & { requestId: string }; Body: { decision: 'approve' | 'reject' } }>(
    '/api/rooms/:code/requests/:requestId/decision',
    {
      schema: {
        params: { type: 'object', required: ['code', 'requestId'], properties: { ...codeParams.properties, requestId: uuid } },
        body: body({ decision: { enum: ['approve', 'reject'] } }, ['decision']),
      },
    },
    async (request) => requests.decide(request.params.code, request.params.requestId, request.body.decision),
  );

  // chat
  app.get<{ Params: Code; Querystring: { limit?: number } }>(
    '/api/rooms/:code/messages',
    { schema: { params: codeParams, querystring: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 200 } } } } },
    async (request) => social.messages(request.params.code, request.query.limit ?? 50),
  );

  app.post<{ Params: Code; Body: { text: string } }>(
    '/api/rooms/:code/messages',
    { schema: { params: codeParams, body: body({ text: { type: 'string', minLength: 1, maxLength: 2000 } }, ['text']) } },
    async (request, reply) => {
      const r = await social.sendMessage(request.params.code, request.body.text, idempotencyKey(request));
      reply.status(r.status);
      return r.body;
    },
  );
};
