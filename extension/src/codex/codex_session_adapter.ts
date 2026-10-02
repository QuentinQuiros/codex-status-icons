import { is_record } from '../ipc/protocol';
import type { StateSnapshot } from '../state';
import { quota_error } from './codex_protocol_adapter';
export interface SessionMetadata {
  session_id: string;
  cwd: string;
  cli_version: string;
  eligible: boolean;
}
export type SessionRecord =
  { metadata: SessionMetadata } | { event: StateSnapshot } | { activity: string };
export function adapt_session_line(line: string): SessionRecord | undefined {
  // Reject conversational records before parsing; never extract user/assistant text.
  if (
    !/^\s*\{\s*"timestamp"\s*:/.test(line) ||
    !/"type"\s*:\s*"(?:session_meta|event_msg)"/.test(line)
  )
    return;
  try {
    const value: unknown = JSON.parse(line);
    if (!is_record(value) || !is_record(value.payload)) return;
    const payload = value.payload;
    if (
      value.type === 'session_meta' &&
      typeof payload.id === 'string' &&
      typeof payload.cwd === 'string'
    ) {
      return {
        metadata: {
          session_id: payload.id,
          cwd: payload.cwd,
          cli_version: typeof payload.cli_version === 'string' ? payload.cli_version : 'unknown',
          eligible: payload.source === 'vscode' && payload.originator === 'codex_vscode',
        },
      };
    }
    if (value.type !== 'event_msg' || typeof payload.type !== 'string') return;
    const since =
      typeof value.timestamp === 'string' && Number.isFinite(Date.parse(value.timestamp))
        ? value.timestamp
        : new Date().toISOString();
    const event = (state: StateSnapshot['state'], reason: string): SessionRecord => ({
      event: { state, reason, provider: 'session', since },
    });
    // Technical progress can keep an existing task fresh. It never establishes
    // a state or quota by itself, and settings/conversation records are ignored.
    if (payload.type === 'token_count' || payload.type === 'item_completed')
      return { activity: since };
    if (payload.type === 'task_started') return event('working', 'task_started');
    if (payload.type === 'task_complete') return event('idle', 'task_complete');
    if (payload.type === 'turn_aborted')
      return event(
        quota_error(payload.error) ? 'rate_limited' : is_record(payload.error) ? 'unknown' : 'idle',
        'turn_aborted',
      );
    if (payload.type === 'error')
      return event(
        quota_error(payload) || quota_error(payload.error) ? 'rate_limited' : 'unknown',
        'technical_error',
      );
    // token_count percentages, arbitrary response strings and tool arguments are ignored.
  } catch {
    /* unrecognized or truncated JSONL record */
  }
}
