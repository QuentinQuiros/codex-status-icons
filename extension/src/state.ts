export const codex_states = ['idle', 'working', 'rate_limited', 'unknown'] as const;
export type CodexState = (typeof codex_states)[number];
export interface StateSnapshot {
  state: CodexState;
  reason: string;
  provider: 'session' | 'app_server' | 'none';
  session_id?: string;
  cli_version?: string;
  since?: string;
}
export const unknown_snapshot = (reason: string): StateSnapshot => ({
  state: 'unknown',
  reason,
  provider: 'none',
});
export function aggregate_states(snapshots: readonly StateSnapshot[]): StateSnapshot {
  for (const state of ['working', 'rate_limited', 'unknown', 'idle']) {
    const match = snapshots.find((snapshot) => snapshot.state === state);
    if (match) return match;
  }
  return unknown_snapshot('no_matching_session');
}
