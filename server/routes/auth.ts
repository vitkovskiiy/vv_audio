import type { FastifyPluginAsync } from 'fastify';
import * as auth from '../services/auth.service';
import { userDto } from '../services/dto';
import { me } from '../services/social.service';
import { clearSessionCookie, readCookie, SESSION_COOKIE, setSessionCookie } from './http';

const credentials = {
  type: 'object',
  required: ['username', 'password'],
  properties: {
    username: { type: 'string', minLength: 1, maxLength: 64 },
    password: { type: 'string', minLength: 1, maxLength: 128 },
  },
} as const;

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: { username: string; password: string } }>(
    '/api/auth/register',
    { schema: { body: credentials } },
    async (request, reply) => {
      const { user, session } = await auth.register(request.body.username, request.body.password);
      setSessionCookie(request, reply, session.token, session.maxAgeSec);
      reply.status(201);
      return { user: userDto(user) };
    },
  );

  app.post<{ Body: { username: string; password: string } }>(
    '/api/auth/login',
    { schema: { body: credentials } },
    async (request, reply) => {
      const { user, session } = await auth.login(request.body.username, request.body.password, request.ip);
      setSessionCookie(request, reply, session.token, session.maxAgeSec);
      return { user: userDto(user) };
    },
  );

  app.post('/api/auth/logout', async (request, reply) => {
    await auth.logout(readCookie(request, SESSION_COOKIE));
    clearSessionCookie(reply);
    reply.status(204);
  });

  app.get('/api/me', async () => me());
};
