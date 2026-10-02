import type { CodexStateProvider } from './codex_state_provider';
import type { QuotaObservation } from './account_quota';
import { unknown_snapshot, type StateSnapshot } from '../state';

export class AccountQuotaStateProvider implements CodexStateProvider {
  private snapshot: StateSnapshot = unknown_snapshot('initializing');
  private quota: QuotaObservation = {
    status: 'unknown',
    reason: 'quota_initializing',
    checked_at: new Date().toISOString(),
  };
  private on_change: ((snapshot: StateSnapshot) => void) | undefined;
  private controller: AbortController | undefined;
  private timer: NodeJS.Timeout | undefined;
  private stopped = true;
  private polling = false;
  private last_snapshot = '';
  private verified = false;
  private spend_blocked = false;
  constructor(
    private readonly session: CodexStateProvider,
    private readonly fetch_quota: (signal: AbortSignal) => Promise<QuotaObservation>,
    private readonly interval_ms = 30000,
  ) {}
  async start(on_change: (snapshot: StateSnapshot) => void): Promise<void> {
    this.on_change = on_change;
    this.stopped = false;
    await this.session.start((snapshot) => {
      this.snapshot = snapshot;
      this.publish();
    });
    if (this.stopped) return;
    this.timer = setInterval(() => {
      void this.poll();
    }, this.interval_ms);
    void this.poll();
  }
  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.controller?.abort();
    this.session.stop();
  }
  set_ambiguous(value: boolean): void {
    this.session.set_ambiguous(value);
  }
  pin_session(value: string | undefined): void {
    this.session.pin_session(value);
  }
  sessions(): ReturnType<CodexStateProvider['sessions']> {
    return this.session.sessions();
  }
  quota_diagnostics(): QuotaObservation {
    return { ...this.quota };
  }
  async scan(): Promise<void> {
    await this.session.scan?.();
  }
  async poll(): Promise<void> {
    if (this.stopped || this.polling) return;
    this.polling = true;
    const controller = new AbortController();
    this.controller = controller;
    try {
      let quota = await this.fetch_quota(controller.signal);
      if (this.stopped || controller.signal.aborted) return;
      if (quota.spend_control_reached === false) this.spend_blocked = false;
      if (quota.reason === 'account_spend_control_reached' && quota.status === 'blocked')
        this.spend_blocked = true;
      if (this.spend_blocked && quota.status === 'available')
        quota = {
          status: 'unknown',
          reason: 'quota_spend_control_unavailable',
          checked_at: quota.checked_at,
        };
      this.quota = quota;
      this.verified ||= quota.status !== 'unknown';
    } catch (error) {
      if (this.stopped) return;
      this.quota = {
        status: 'unknown',
        reason:
          error instanceof Error && /^quota_[a-z_]+$/.test(error.message)
            ? error.message
            : 'quota_unavailable',
        checked_at: new Date().toISOString(),
      };
    } finally {
      this.polling = false;
      if (!this.stopped) this.publish();
    }
  }
  private publish(): void {
    if (this.stopped) return;
    const snapshot: StateSnapshot =
      this.quota.status === 'blocked'
        ? {
            ...this.snapshot,
            state: 'rate_limited',
            reason: this.quota.reason,
            provider: 'app_server',
            since: this.quota.checked_at,
          }
        : this.quota.status === 'unknown' && this.verified && this.snapshot.state === 'idle'
          ? {
              ...this.snapshot,
              state: 'unknown',
              reason: 'account_quota_unavailable',
              provider: 'app_server',
            }
          : this.snapshot;
    const serialized = JSON.stringify({ snapshot, quota: this.quota });
    if (serialized !== this.last_snapshot) {
      this.last_snapshot = serialized;
      this.on_change?.(snapshot);
    }
  }
}
