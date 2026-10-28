import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger as Logger } from 'fastify';
import { rootLogger } from './logger';

export interface AuthUser {
  id: string;
  username: string;
}

/**
 * Everything a business operation needs that is not one of its own arguments.
 * Set once at the edge (HTTP request, socket event, startup) and read from any layer.
 */
export interface RequestContext {
  /** business-process ID: ties together every log line of one operation */
  bpId: string;
  /** logger already bound to bpId */
  log: Logger;
  user?: AuthUser;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runInContext<T>(ctx: Omit<RequestContext, 'log'> & { log?: Logger }, fn: () => T): T {
  const log = ctx.log ?? rootLogger().child({ bpId: ctx.bpId });
  return storage.run({ ...ctx, log }, fn);
}

/** for work that starts outside a request: startup, timers */
export function runInNewContext<T>(fn: () => T): T {
  return runInContext({ bpId: newBpId() }, fn);
}

export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

export function newBpId(): string {
  return randomUUID();
}

/** the logger of the current operation; falls back to the root logger outside any context */
export function log(): Logger {
  return storage.getStore()?.log ?? rootLogger();
}

export function setUser(user: AuthUser | undefined) {
  const ctx = storage.getStore();
  if (!ctx) throw new Error('setUser called outside a request context');
  ctx.user = user;
}
