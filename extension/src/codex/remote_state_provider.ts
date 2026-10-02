import { randomUUID as random_uuid } from 'node:crypto';
import { is_record, is_state } from '../ipc/protocol';
import { unknown_snapshot, type StateSnapshot } from '../state';
import type { CodexStateProvider } from './codex_state_provider';
import { valid_quota_windows, type QuotaObservation } from './account_quota';

export const remote_snapshot_command = '_codex_status_remote.snapshot';
// VS Code can batch renderer-routed SSH commands once per minute in the background.
// Leave room for that interval and a network round trip before declaring a lost reply.
const remote_response_timeout_ms = 75000;
export interface RemoteRequest {
  version: 1;
  request_id: string;
  roots: readonly string[];
  sessions_directory: string;
  stale_minutes: number;
  pinned_session: string | undefined;
}
export interface RemoteReply {
  version: 1;
  bridge_version?: string;
  request_id: string;
  roots: string[];
  snapshot: StateSnapshot;
  sessions: { session_id: string; cli_version: string }[];
  sessions_directory: string;
  platform: string;
  quota?: QuotaObservation;
}
function valid_text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max && !/[\x00-\x1f]/.test(value);
}
export function parse_remote_reply(
  value: unknown,
  request: RemoteRequest,
): RemoteReply | undefined {
  if (!is_record(value) || value.version !== 1 || value.request_id !== request.request_id) return;
  if (!Array.isArray(value.roots) || value.roots.length !== request.roots.length) return;
  if (!value.roots.every((root, index) => root === request.roots[index])) return;
  const raw = value.snapshot;
  if (!is_record(raw) || !is_state(raw.state) || !valid_text(raw.reason, 180)) return;
  if (!valid_text(value.sessions_directory, 2048) || !valid_text(value.platform, 30)) return;
  if (value.bridge_version !== undefined && !valid_text(value.bridge_version, 60)) return;
  // Copy only permitted fields; command replies must never forward arbitrary properties.
  const snapshot: StateSnapshot = {
    state: raw.state as StateSnapshot['state'],
    reason: raw.reason,
    provider: raw.provider === 'app_server' ? 'app_server' : 'session',
  };
  for (const key of ['session_id', 'cli_version', 'since'] as const) {
    if (raw[key] !== undefined && !valid_text(raw[key], 100)) return;
    if (typeof raw[key] === 'string') snapshot[key] = raw[key];
  }
  const sessions = Array.isArray(value.sessions)
    ? value.sessions
        .slice(0, 200)
        .flatMap((entry: unknown) =>
          is_record(entry) &&
          valid_text(entry.session_id, 100) &&
          valid_text(entry.cli_version, 100)
            ? [{ session_id: entry.session_id, cli_version: entry.cli_version }]
            : [],
        )
    : [];
  const quota = value.quota;
  if (
    quota !== undefined &&
    (!is_record(quota) ||
      typeof quota.status !== 'string' ||
      !['blocked', 'available', 'unknown'].includes(quota.status) ||
      !valid_text(quota.reason, 100) ||
      !valid_text(quota.checked_at, 40) ||
      !Number.isFinite(Date.parse(quota.checked_at)) ||
      (quota.spend_control_reached !== undefined &&
        typeof quota.spend_control_reached !== 'boolean') ||
      (quota.windows !== undefined && !valid_quota_windows(quota.windows)))
  )
    return;
  return {
    version: 1,
    ...(typeof value.bridge_version === 'string' ? { bridge_version: value.bridge_version } : {}),
    request_id: request.request_id,
    roots: [...request.roots],
    snapshot,
    sessions,
    sessions_directory: value.sessions_directory,
    platform: value.platform,
    ...(is_record(quota)
      ? {
          quota: {
            status: quota.status as QuotaObservation['status'],
            reason: quota.reason as string,
            checked_at: quota.checked_at as string,
            ...(valid_quota_windows(quota.windows)
              ? {
                  windows: quota.windows.map((window) => ({
                    remaining_percent: window.remaining_percent,
                    window_minutes: window.window_minutes,
                    resets_at: window.resets_at,
                  })),
                }
              : {}),
            ...(typeof quota.spend_control_reached === 'boolean'
              ? { spend_control_reached: quota.spend_control_reached }
              : {}),
          },
        }
      : {}),
  };
}
export interface RemoteOptions {
  roots: readonly string[];
  sessions_directory: string;
  stale_minutes: number;
  fetch_snapshot: (request: RemoteRequest) => Promise<unknown>;
  interval_ms?: number;
  timeout_ms?: number;
}
export class RemoteStateProvider implements CodexStateProvider {
  private stopped = true;
  private polling = false;
  private timer: NodeJS.Timeout | undefined;
  private on_change: ((snapshot: StateSnapshot) => void) | undefined;
  private pinned_session: string | undefined;
  private session_revision = 0;
  private ambiguous = false;
  private last_snapshot = '';
  private snapshot = unknown_snapshot('remote_connecting');
  private session_list: { session_id: string; cli_version: string }[] = [];
  private details:
    | {
        sessions_directory: string;
        platform: string;
        bridge_version?: string;
        quota?: QuotaObservation;
      }
    | undefined;
  constructor(private readonly options: RemoteOptions) {}
  async start(on_change: (snapshot: StateSnapshot) => void): Promise<void> {
    this.on_change = on_change;
    this.stopped = false;
    this.publish();
    this.timer = setInterval(() => {
      void this.poll();
    }, this.options.interval_ms ?? 2000);
    void this.poll();
  }
  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }
  set_ambiguous(ambiguous: boolean): void {
    this.ambiguous = ambiguous;
    this.publish();
  }
  pin_session(session_id: string | undefined): void {
    if (this.pinned_session === session_id) return;
    this.session_revision++;
    this.pinned_session = session_id;
    this.snapshot = unknown_snapshot('remote_session_changing');
    this.publish();
    void this.poll();
  }
  sessions(): readonly { session_id: string; cli_version: string }[] {
    return this.session_list;
  }
  diagnostics():
    Pick<RemoteReply, 'sessions_directory' | 'platform' | 'bridge_version' | 'quota'> | undefined {
    return this.details;
  }
  async poll(): Promise<void> {
    if (this.stopped || this.polling) return;
    this.polling = true;
    const requested_pin = this.pinned_session;
    const requested_revision = this.session_revision;
    const is_current = (): boolean => !this.stopped && requested_revision === this.session_revision;
    const request: RemoteRequest = {
      version: 1,
      request_id: random_uuid(),
      roots: this.options.roots,
      sessions_directory: this.options.sessions_directory,
      stale_minutes: this.options.stale_minutes,
      pinned_session: requested_pin,
    };
    let deadline: NodeJS.Timeout | undefined;
    const pending = Promise.resolve()
      .then(() => this.options.fetch_snapshot(request))
      .then((raw) => {
        // A command still completes after our deadline. Accept its validated reply,
        // including a quota block or completion, without waiting for another poll.
        if (!is_current()) return;
        const reply = parse_remote_reply(raw, request);
        this.snapshot = reply?.snapshot ?? unknown_snapshot('remote_reply_mismatch');
        this.session_list = reply?.sessions ?? [];
        this.details = reply
          ? {
              sessions_directory: reply.sessions_directory,
              platform: reply.platform,
              ...(reply.bridge_version ? { bridge_version: reply.bridge_version } : {}),
              ...(reply.quota ? { quota: reply.quota } : {}),
            }
          : undefined;
        this.publish();
      });
    // A timeout does not cancel a VS Code command. Keep it as the sole request in flight
    // until it finishes, so a stalled connection cannot accumulate background requests.
    const expired = new Promise<never>((_resolve, reject) => {
      deadline = setTimeout(
        () => reject(new Error('remote_timeout')),
        this.options.timeout_ms ?? remote_response_timeout_ms,
      );
    });
    try {
      await Promise.race([pending, expired]);
    } catch (error) {
      if (is_current()) {
        const reason =
          error instanceof Error &&
          ['remote_bridge_reload_required', 'remote_install_command_unavailable'].includes(
            error.message,
          )
            ? error.message
            : 'remote_unavailable';
        this.snapshot = unknown_snapshot(reason);
        this.publish();
      }
    } finally {
      if (deadline) clearTimeout(deadline);
      void pending
        .catch(() => undefined)
        .finally(() => {
          this.polling = false;
          if (!this.stopped && requested_revision !== this.session_revision) void this.poll();
        });
    }
  }
  private publish(): void {
    if (this.stopped) return;
    const snapshot = this.ambiguous
      ? {
          ...unknown_snapshot('ambiguous_workspace_windows'),
          ...(this.pinned_session ? { session_id: this.pinned_session } : {}),
        }
      : this.snapshot;
    const serialized = JSON.stringify({ snapshot, quota: this.details?.quota });
    if (serialized !== this.last_snapshot) {
      this.last_snapshot = serialized;
      this.on_change?.(snapshot);
    }
  }
}
