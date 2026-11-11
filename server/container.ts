import type { Repositories } from './repositories/ports';
import type { MetadataSource } from './services/metadata';
import type { SearchProvider } from './services/search.service';

/** pushes "something changed in this room" to connected clients; a no-op where there are none (tests, scripts) */
export interface RoomEvents {
  roomChanged(code: string, reason: string): void;
  roomDeleted(code: string): void;
}

/**
 * Process-wide resources, initialised once at startup.
 * Request-scoped data (bpId, user, logger) lives in the AsyncLocalStorage context instead.
 */
export interface Deps {
  repos: Repositories;
  metadata: MetadataSource;
  searchProviders: SearchProvider[];
  events: RoomEvents;
}

let current: Deps | undefined;

export function setDeps(d: Deps) {
  current = d;
}

export function deps(): Deps {
  if (!current) throw new Error('dependencies are not initialised: call setDeps() at startup');
  return current;
}

export const noEvents: RoomEvents = { roomChanged() {}, roomDeleted() {} };
