import { spawn } from 'node:child_process';
import { randomUUID as random_uuid } from 'node:crypto';
import { is_record } from '../ipc/protocol';

export interface QuotaObservation {
  status: 'blocked' | 'available' | 'unknown';
  reason: string;
  checked_at: string;
  spend_control_reached?: boolean;
  windows?: QuotaWindow[];
}
export interface QuotaWindow {
  remaining_percent: number;
  window_minutes: number;
  resets_at: number;
}
export function valid_quota_windows(value: unknown): value is QuotaWindow[] {
  return (
    Array.isArray(value) &&
    value.length <= 2 &&
    value.every(
      (window: unknown) =>
        is_record(window) &&
        typeof window.remaining_percent === 'number' &&
        Number.isFinite(window.remaining_percent) &&
        window.remaining_percent >= 0 &&
        window.remaining_percent <= 100 &&
        typeof window.window_minutes === 'number' &&
        Number.isFinite(window.window_minutes) &&
        window.window_minutes > 0 &&
        window.window_minutes <= 10000000 &&
        typeof window.resets_at === 'number' &&
        Number.isFinite(window.resets_at) &&
        window.resets_at > 0 &&
        window.resets_at < 253402300799,
    )
  );
}
const reached_types = new Set([
  'rate_limit_reached',
  'workspace_owner_credits_depleted',
  'workspace_member_credits_depleted',
  'workspace_owner_usage_limit_reached',
  'workspace_member_usage_limit_reached',
]);
export function decode_account_quota(value: unknown, now = Date.now()): QuotaObservation {
  let spend_control_reached: boolean | undefined;
  let quota_windows: QuotaWindow[] = [];
  const observation = (status: QuotaObservation['status'], reason: string): QuotaObservation => ({
    status,
    reason,
    checked_at: new Date(now).toISOString(),
    ...(spend_control_reached !== undefined ? { spend_control_reached } : {}),
    ...(quota_windows.length ? { windows: quota_windows } : {}),
  });
  if (!is_record(value)) return observation('unknown', 'quota_reply_invalid');
  const buckets = value.rateLimitsByLimitId;
  const limits = is_record(buckets) && 'codex' in buckets ? buckets.codex : value.rateLimits;
  if (!is_record(limits) || (limits.limitId != null && limits.limitId !== 'codex'))
    return observation('unknown', 'quota_bucket_unavailable');
  quota_windows = [limits.primary, limits.secondary].flatMap((window: unknown) => {
    if (
      !is_record(window) ||
      typeof window.usedPercent !== 'number' ||
      !Number.isFinite(window.usedPercent) ||
      window.usedPercent < 0 ||
      window.usedPercent > 100
    )
      return [];
    const candidates: unknown = [
      {
        remaining_percent: 100 - window.usedPercent,
        window_minutes: window.windowDurationMins,
        resets_at: window.resetsAt,
      },
    ];
    return valid_quota_windows(candidates) && candidates[0] && candidates[0].resets_at > now / 1000
      ? candidates
      : [];
  });
  if (typeof limits.spendControlReached === 'boolean')
    spend_control_reached = limits.spendControlReached;
  if (
    typeof limits.rateLimitReachedType === 'string' &&
    reached_types.has(limits.rateLimitReachedType)
  )
    return observation('blocked', 'account_' + limits.rateLimitReachedType);
  if (limits.rateLimitReachedType != null)
    return observation('unknown', 'quota_classification_unknown');
  if (limits.spendControlReached === true)
    return observation('blocked', 'account_spend_control_reached');
  const credits = limits.credits;
  const has_credit =
    is_record(credits) &&
    (credits.unlimited === true ||
      (credits.hasCredits === true &&
        typeof credits.balance === 'string' &&
        Number.isFinite(Number(credits.balance)) &&
        Number(credits.balance) > 0));
  const no_credit =
    is_record(credits) && credits.unlimited === false && credits.hasCredits === false;
  const windows = [limits.primary, limits.secondary].filter((window) => window != null);
  const valid_window = (
    window: unknown,
  ): window is { usedPercent: number; windowDurationMins: number; resetsAt: number } =>
    is_record(window) &&
    typeof window.usedPercent === 'number' &&
    Number.isFinite(window.usedPercent) &&
    window.usedPercent >= 0 &&
    window.usedPercent <= 100 &&
    typeof window.windowDurationMins === 'number' &&
    Number.isFinite(window.windowDurationMins) &&
    window.windowDurationMins > 0 &&
    typeof window.resetsAt === 'number' &&
    Number.isFinite(window.resetsAt) &&
    window.resetsAt > now / 1000;
  if (windows.some((window) => valid_window(window) && window.usedPercent >= 100) && no_credit)
    return observation('blocked', 'account_quota_exhausted');
  if (
    has_credit ||
    (windows.length > 0 &&
      windows.every((window) => valid_window(window) && window.usedPercent < 100))
  )
    return observation('available', 'account_quota_available');
  return observation('unknown', 'quota_evidence_incomplete');
}

// An independent stdio client reads account limits using Codex's existing login.
// It never starts/resumes a thread, sends a prompt, reads auth.json, or opens a port.
export async function read_account_quota(
  executable: string,
  signal: AbortSignal,
  timeout_ms = 12000,
  args: readonly string[] = ['app-server'],
  cwd?: string,
): Promise<QuotaObservation> {
  if (signal.aborted) throw new Error('quota_reader_stopped');
  const child = spawn(executable, [...args], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'ignore'],
    ...(cwd ? { cwd } : {}),
  });
  const requests = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  let buffer = Buffer.alloc(0);
  let failure: Error | undefined;
  const fail = (reason: string): void => {
    failure ??= new Error(reason);
    for (const request of requests.values()) request.reject(failure);
    requests.clear();
  };
  const abort = (): void => {
    fail('quota_reader_stopped');
    child.kill();
  };
  const deadline = setTimeout(() => {
    fail('quota_request_timeout');
    child.kill();
  }, timeout_ms);
  signal.addEventListener('abort', abort, { once: true });
  child.on('error', () => fail('quota_binary_unavailable'));
  child.on('exit', () => fail('quota_server_closed'));
  child.stdin.on('error', () => fail('quota_pipe_closed'));
  const send = (message: unknown): void => {
    if (failure) throw failure;
    child.stdin.write(JSON.stringify(message) + '\n');
  };
  child.stdout.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > 1024 * 1024) {
      fail('quota_reply_oversized');
      child.kill();
      return;
    }
    let end: number;
    while ((end = buffer.indexOf(10)) >= 0) {
      const line = buffer.subarray(0, end).toString('utf8');
      buffer = buffer.subarray(end + 1);
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        continue;
      }
      if (!is_record(value)) continue;
      if (value.id !== undefined && typeof value.method === 'string') {
        // Refuse server-initiated requests; this client only reads account metadata.
        if (!failure) send({ id: value.id, error: { code: -32601, message: 'Read-only client' } });
        continue;
      }
      if (typeof value.id !== 'string') continue;
      const request = requests.get(value.id);
      if (!request) continue;
      requests.delete(value.id);
      if (value.error !== undefined) request.reject(new Error('quota_rpc_rejected'));
      else request.resolve(value.result);
    }
  });
  const call = (method: string, params: unknown): Promise<unknown> =>
    new Promise((resolve, reject) => {
      if (failure) {
        reject(failure);
        return;
      }
      const id = random_uuid();
      requests.set(id, { resolve, reject });
      try {
        send({ id, method, params });
      } catch {
        requests.delete(id);
        reject(failure ?? new Error('quota_pipe_closed'));
      }
    });
  try {
    await call('initialize', {
      clientInfo: {
        name: 'codex_status_quota_reader',
        title: 'Codex Status quota reader',
        version: '0.3.2',
      },
    });
    send({ method: 'initialized', params: {} });
    const account = await call('account/read', { refreshToken: false });
    if (!is_record(account) || !is_record(account.account) || account.account.type !== 'chatgpt')
      return {
        status: 'unknown',
        reason: 'quota_chatgpt_account_unavailable',
        checked_at: new Date().toISOString(),
      };
    return decode_account_quota(await call('account/rateLimits/read', {}));
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener('abort', abort);
    fail('quota_reader_closed');
    child.stdin.end();
    const cleanup = setTimeout(() => {
      if (child.exitCode === null) child.kill();
    }, 500);
    child.once('exit', () => clearTimeout(cleanup));
    cleanup.unref();
  }
}
