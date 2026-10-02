import { is_record } from '../ipc/protocol';
import type { RemoteRequest } from './remote_state_provider';

export function create_versioned_remote_fetch(options: {
  version: string;
  query(request: RemoteRequest): Promise<unknown>;
  install(): Promise<unknown>;
  now?: () => number;
}): (request: RemoteRequest) => Promise<unknown> {
  let installation: Promise<unknown> | undefined;
  let last_attempt: number | undefined;
  let awaiting_reload = false;
  const is_current = (reply: unknown): boolean =>
    is_record(reply) && reply.bridge_version === options.version;
  return async (request) => {
    let reply: unknown;
    try {
      reply = await options.query(request);
    } catch {
      /* install missing bridge below */
    }
    if (is_current(reply)) {
      awaiting_reload = false;
      return reply;
    }
    if (awaiting_reload && is_record(reply)) throw new Error('remote_bridge_reload_required');
    const now = options.now?.() ?? Date.now();
    if (!installation && (last_attempt === undefined || now - last_attempt >= 60000)) {
      last_attempt = now;
      installation = Promise.resolve().then(options.install);
    }
    if (!installation) throw new Error('remote_bridge_unavailable');
    const pending = installation;
    try {
      await pending;
      awaiting_reload = true;
    } finally {
      if (installation === pending) installation = undefined;
    }
    reply = await options.query(request);
    if (!is_current(reply)) throw new Error('remote_bridge_reload_required');
    awaiting_reload = false;
    return reply;
  };
}
