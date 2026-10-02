import { is_record } from '../ipc/protocol';
import type { StateSnapshot } from '../state';
export function quota_error(error: unknown): boolean {
  if (!is_record(error)) return false;
  const code = error.codexErrorInfo ?? error.codex_error_info ?? error.code;
  return (
    typeof code === 'string' &&
    [
      'usageLimitExceeded',
      'usage_limit_exceeded',
      'rateLimitExceeded',
      'rate_limit_exceeded',
    ].includes(code)
  );
}
// Decoder only: the official extension does not expose its private stdio transport.
export function adapt_protocol_event(value: unknown): StateSnapshot | undefined {
  if (!is_record(value) || typeof value.method !== 'string' || !is_record(value.params)) return;
  const params = value.params;
  const session_id = typeof params.threadId === 'string' ? params.threadId : undefined;
  if (!session_id) return;
  const snapshot = (state: StateSnapshot['state'], reason: string): StateSnapshot => ({
    state,
    reason,
    provider: 'app_server',
    session_id,
  });
  if (value.method === 'turn/started') return snapshot('working', 'turn_started');
  if (value.method === 'turn/completed' && is_record(params.turn))
    return snapshot(
      quota_error(params.turn.error)
        ? 'rate_limited'
        : params.turn.status === 'completed' || params.turn.status === 'interrupted'
          ? 'idle'
          : 'unknown',
      'turn_completed',
    );
  if (value.method === 'error' && quota_error(params.error))
    return snapshot('rate_limited', 'confirmed_quota_error');
  if (value.method === 'thread/status/changed' && is_record(params.status)) {
    const status = params.status;
    if (status.type === 'idle') return snapshot('idle', 'thread_idle');
    if (status.type === 'active') return snapshot('working', 'thread_active');
    return snapshot('unknown', 'thread_unavailable');
  }
}
