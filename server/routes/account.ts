import type { FastifyPluginAsync } from 'fastify';
import type { Plan } from '../domain/types';
import { search, searchSources } from '../services/search.service';
import * as social from '../services/social.service';
import { uuid } from './http';

const trackParams = { type: 'object', required: ['trackId'], properties: { trackId: uuid } } as const;

export const accountRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/favorites', async () => social.listFavorites());

  app.put<{ Params: { trackId: string } }>('/api/favorites/:trackId', { schema: { params: trackParams } }, async (request, reply) => {
    await social.addFavorite(request.params.trackId);
    reply.status(204);
  });

  app.delete<{ Params: { trackId: string } }>('/api/favorites/:trackId', { schema: { params: trackParams } }, async (request, reply) => {
    await social.removeFavorite(request.params.trackId);
    reply.status(204);
  });

  app.get('/api/search/sources', async () => searchSources());

  app.get<{ Querystring: { q: string } }>(
    '/api/search',
    { schema: { querystring: { type: 'object', required: ['q'], properties: { q: { type: 'string', maxLength: 200 } } } } },
    async (request) => search(request.query.q),
  );

  app.put<{ Params: { username: string }; Body: { plan: Plan } }>(
    '/api/admin/users/:username/plan',
    {
      schema: {
        params: { type: 'object', required: ['username'], properties: { username: { type: 'string', maxLength: 64 } } },
        body: { type: 'object', required: ['plan'], properties: { plan: { enum: ['free', 'premium'] } }, additionalProperties: false },
      },
    },
    async (request) => social.setPlan(request.params.username, request.body.plan),
  );
};
