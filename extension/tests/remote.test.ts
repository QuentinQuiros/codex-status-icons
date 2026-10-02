import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile as write_file, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setImmediate as next_tick } from 'node:timers/promises';
import { create_remote_workspace, normalize_session_path } from '../src/workspace';
import { SessionStateProvider } from '../src/codex/session_state_provider';
import {
  RemoteStateProvider,
  parse_remote_reply,
  type RemoteRequest,
} from '../src/codex/remote_state_provider';
import type { StateSnapshot } from '../src/state';
const request: RemoteRequest = {
  version: 1,
  request_id: 'request',
  roots: ['/srv/A'],
  sessions_directory: '',
  stale_minutes: 60,
  pinned_session: undefined,
};
const reply = (input: RemoteRequest, state = 'working'): unknown => ({
  version: 1,
  request_id: input.request_id,
  roots: input.roots,
  snapshot: {
    state,
    reason: 'task_started',
    provider: 'session',
    session_id: input.pinned_session ?? 'remote',
    since: new Date().toISOString(),
  },
  sessions: [{ session_id: 'remote', cli_version: 'fixture' }],
  sessions_directory: '/home/user/.codex/sessions',
  platform: 'linux',
});
const wait_until = async (condition: () => boolean): Promise<void> => {
  const deadline = Date.now() + 1500;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('test_timeout');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

test('SSH workspace identity preserves authority and Linux case', () => {
  const first = create_remote_workspace('A', ['vscode-remote://ssh-remote+first/srv/A']);
  const second = create_remote_workspace('A', ['vscode-remote://ssh-remote+second/srv/A']);
  assert.notEqual(first.workspace_roots[0], second.workspace_roots[0]);
  assert.equal(first.workspace_roots[0], 'vscode-remote://ssh-remote+first/srv/A');
  assert.notEqual(
    normalize_session_path('/srv/A', 'posix'),
    normalize_session_path('/srv/a', 'posix'),
  );
  assert.equal(normalize_session_path('/srv/A/../A/', 'posix'), '/srv/A');
  assert.equal(normalize_session_path('/', 'posix'), '/');
});
test('remote reply requires the request and exact window roots and strips private fields', () => {
  const raw = reply(request) as Record<string, unknown>;
  raw.prompt = 'PRIVATE';
  (raw.snapshot as Record<string, unknown>).response = 'PRIVATE';
  assert.equal(parse_remote_reply({ ...raw, request_id: 'other' }, request), undefined);
  assert.equal(parse_remote_reply({ ...raw, roots: ['/srv/a'] }, request), undefined);
  assert.equal(parse_remote_reply({ ...raw, version: 2 }, request), undefined);
  assert.ok(!JSON.stringify(parse_remote_reply(raw, request)).includes('PRIVATE'));
  assert.equal(parse_remote_reply(raw, request)?.snapshot.state, 'working');
});
test('remote reply rejects unknown states and unbounded metadata', () => {
  const raw = reply(request) as Record<string, unknown>;
  assert.equal(
    parse_remote_reply({ ...raw, snapshot: { state: 'fake', reason: 'x' } }, request),
    undefined,
  );
  assert.equal(
    parse_remote_reply(
      { ...raw, snapshot: { state: 'working', reason: 'x', session_id: 'x'.repeat(101) } },
      request,
    ),
    undefined,
  );
  assert.equal(
    parse_remote_reply({ ...raw, sessions_directory: 'x'.repeat(2049) }, request),
    undefined,
  );
});
test('remote quota diagnostics preserve their source and strip account secrets', () => {
  const raw = reply(request, 'rate_limited') as Record<string, unknown>;
  (raw.snapshot as Record<string, unknown>).provider = 'app_server';
  raw.quota = {
    status: 'blocked',
    reason: 'account_quota_exhausted',
    checked_at: new Date().toISOString(),
    spend_control_reached: false,
    windows: [
      {
        remaining_percent: 72,
        window_minutes: 300,
        resets_at: Date.now() / 1000 + 3600,
        secret: 'PRIVATE',
      },
    ],
    email: 'PRIVATE',
    token: 'PRIVATE',
  };
  const parsed = parse_remote_reply(raw, request);
  assert.equal(parsed?.snapshot.provider, 'app_server');
  assert.equal(parsed?.quota?.status, 'blocked');
  assert.equal(parsed?.quota?.spend_control_reached, false);
  assert.equal(parsed?.quota?.windows?.[0]?.remaining_percent, 72);
  assert.ok(!JSON.stringify(parsed).includes('PRIVATE'));
  for (const quota of [
    { status: 'invalid' },
    { ...(raw.quota as object), checked_at: 'invalid' },
    { ...(raw.quota as object), spend_control_reached: 'false' },
    {
      ...(raw.quota as object),
      windows: [{ remaining_percent: 101, window_minutes: 300, resets_at: 1 }],
    },
    {
      ...(raw.quota as object),
      windows: [{ remaining_percent: '72', window_minutes: 300, resets_at: 1 }],
    },
  ])
    assert.equal(parse_remote_reply({ ...raw, quota }, request), undefined);
});

test('SSH percentages refresh while the unchanged session remains idle and disappear on a missing observation', async () => {
  let remaining = 80;
  let missing = false;
  let changes = 0;
  const provider = new RemoteStateProvider({
    roots: request.roots,
    sessions_directory: '',
    stale_minutes: 60,
    interval_ms: 60000,
    fetch_snapshot: async (input) => ({
      ...(reply(input, 'idle') as object),
      snapshot: {
        state: 'idle',
        reason: 'task_complete',
        provider: 'session',
        session_id: 'remote',
      },
      ...(missing
        ? {}
        : {
            quota: {
              status: 'available',
              reason: 'account_quota_available',
              checked_at: new Date().toISOString(),
              windows: [
                {
                  remaining_percent: remaining,
                  window_minutes: 300,
                  resets_at: Date.now() / 1000 + 3600,
                },
              ],
            },
          }),
    }),
  });
  try {
    await provider.start(() => {
      changes++;
    });
    await wait_until(() => provider.diagnostics()?.quota?.windows?.[0]?.remaining_percent === 80);
    await next_tick();
    const before = changes;
    remaining = 70;
    await provider.poll();
    assert.equal(provider.diagnostics()?.quota?.windows?.[0]?.remaining_percent, 70);
    assert.equal(changes, before + 1);
    await next_tick();
    missing = true;
    await provider.poll();
    assert.equal(provider.diagnostics()?.quota, undefined);
    assert.equal(changes, before + 2);
  } finally {
    provider.stop();
  }
});
test('POSIX provider compares exact Linux roots, excludes Desktop and supports remote paths', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'codex-status-posix-'));
  let snapshot: StateSnapshot | undefined;
  const provider = new SessionStateProvider(directory, ['/srv/A'], 60, 'posix');
  const record = (type: string, payload: unknown): string =>
    JSON.stringify({ timestamp: new Date().toISOString(), type, payload }) + '\n';
  try {
    for (const [id, cwd, originator, event] of [
      ['correct', '/srv/A', 'codex_vscode', 'task_complete'],
      ['case', '/srv/a', 'codex_vscode', 'task_started'],
      ['desktop', '/srv/A', 'Codex Desktop', 'task_started'],
    ]) {
      await write_file(
        path.join(directory, id + '.jsonl'),
        record('session_meta', { id, cwd, source: 'vscode', originator, cli_version: 'fixture' }) +
          record('event_msg', { type: event }),
      );
    }
    await provider.start((next) => {
      snapshot = next;
    });
    assert.equal(snapshot?.state, 'idle');
    assert.equal(snapshot?.session_id, 'correct');
  } finally {
    provider.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
test('remote disconnect becomes unknown and reconnect restores the confirmed state', async () => {
  let fail = false;
  let snapshot: StateSnapshot | undefined;
  const provider = new RemoteStateProvider({
    ...request,
    fetch_snapshot: async (input) => {
      if (fail) throw new Error('offline');
      return reply(input);
    },
    interval_ms: 60000,
  });
  try {
    await provider.start((next) => {
      snapshot = next;
    });
    await wait_until(() => snapshot?.state === 'working');
    fail = true;
    await provider.poll();
    await wait_until(() => snapshot?.state === 'unknown');
    assert.equal(snapshot?.reason, 'remote_unavailable');
    fail = false;
    await provider.poll();
    await wait_until(() => snapshot?.state === 'working');
    provider.set_ambiguous(true);
    assert.equal(snapshot?.reason, 'ambiguous_workspace_windows');
    provider.set_ambiguous(false);
    assert.equal(snapshot?.state, 'working');
  } finally {
    provider.stop();
  }
});
test('remote timeout keeps only one pending command and ignores results after stop', async () => {
  let calls = 0;
  let finish: ((value: unknown) => void) | undefined;
  let sent: RemoteRequest | undefined;
  let snapshot: StateSnapshot | undefined;
  const provider = new RemoteStateProvider({
    ...request,
    timeout_ms: 15,
    interval_ms: 60000,
    fetch_snapshot: async (input) => {
      calls++;
      sent = input;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  await provider.start((next) => {
    snapshot = next;
  });
  await wait_until(() => snapshot?.reason === 'remote_unavailable');
  await provider.poll();
  assert.equal(calls, 1);
  provider.stop();
  finish?.(reply(sent!));
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(snapshot?.state, 'unknown');
});
test('background SSH replies once per minute preserve and update the confirmed state', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let calls = 0;
  let finish: ((value: unknown) => void) | undefined;
  let sent: RemoteRequest | undefined;
  let snapshot: StateSnapshot | undefined;
  const provider = new RemoteStateProvider({
    ...request,
    fetch_snapshot: async (input) => {
      calls++;
      if (calls === 1) return reply(input);
      sent = input;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  try {
    await provider.start((next) => {
      snapshot = next;
    });
    await next_tick();
    assert.equal(snapshot?.state, 'working');
    context.mock.timers.tick(2000);
    await next_tick();
    context.mock.timers.tick(60000);
    await next_tick();
    assert.equal(snapshot?.state, 'working');
    assert.equal(calls, 2, 'background polling must not queue duplicate SSH commands');
    finish?.(reply(sent!, 'idle'));
    await next_tick();
    assert.equal(snapshot?.state, 'idle');
    context.mock.timers.tick(2000);
    await next_tick();
    assert.equal(calls, 3, 'polling must resume after the delayed reply');
    context.mock.timers.tick(75000);
    await next_tick();
    assert.equal(snapshot?.reason, 'remote_unavailable', 'a stalled reply must still expire');
  } finally {
    provider.stop();
    finish?.(reply(sent!));
    await next_tick();
  }
});
test('a valid late SSH reply restores the latest state immediately after a timeout', async () => {
  let finish: ((value: unknown) => void) | undefined;
  let sent: RemoteRequest | undefined;
  let snapshot: StateSnapshot | undefined;
  const provider = new RemoteStateProvider({
    ...request,
    timeout_ms: 15,
    interval_ms: 60000,
    fetch_snapshot: async (input) => {
      sent = input;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  try {
    await provider.start((next) => {
      snapshot = next;
    });
    await wait_until(() => snapshot?.reason === 'remote_unavailable');
    finish?.(reply(sent!, 'rate_limited'));
    await wait_until(() => snapshot?.state === 'rate_limited');
    assert.equal(snapshot?.session_id, 'remote');
    assert.equal(provider.diagnostics()?.platform, 'linux');
  } finally {
    provider.stop();
  }
});
test('a late SSH reply with a mismatched request cannot restore a color', async () => {
  let finish: ((value: unknown) => void) | undefined;
  let snapshot: StateSnapshot | undefined;
  const provider = new RemoteStateProvider({
    ...request,
    timeout_ms: 15,
    interval_ms: 60000,
    fetch_snapshot: async () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  try {
    await provider.start((next) => {
      snapshot = next;
    });
    await wait_until(() => snapshot?.reason === 'remote_unavailable');
    finish?.(reply(request, 'idle'));
    await wait_until(() => snapshot?.reason === 'remote_reply_mismatch');
    assert.equal(snapshot?.state, 'unknown');
  } finally {
    provider.stop();
  }
});
test('changing the selected SSH session twice invalidates the original pending reply', async () => {
  let finish: ((value: unknown) => void) | undefined;
  let sent: RemoteRequest | undefined;
  let calls = 0;
  const observed: StateSnapshot[] = [];
  const provider = new RemoteStateProvider({
    ...request,
    timeout_ms: 15,
    interval_ms: 60000,
    fetch_snapshot: async (input) => {
      calls++;
      if (calls > 1) return reply(input, 'idle');
      sent = input;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  try {
    await provider.start((next) => observed.push(next));
    await wait_until(() => observed.at(-1)?.reason === 'remote_unavailable');
    provider.pin_session('chosen');
    provider.pin_session(undefined);
    finish?.(reply(sent!, 'rate_limited'));
    await wait_until(() => observed.at(-1)?.state === 'idle');
    assert.equal(
      observed.some((snapshot) => snapshot.state === 'rate_limited'),
      false,
    );
    assert.equal(calls, 2);
  } finally {
    provider.stop();
  }
});
test('changing remote session discards an old reply before applying the selected session', async () => {
  let snapshot: StateSnapshot | undefined;
  let finish: ((value: unknown) => void) | undefined;
  let first_request: RemoteRequest | undefined;
  let calls = 0;
  const provider = new RemoteStateProvider({
    ...request,
    interval_ms: 60000,
    fetch_snapshot: async (input) => {
      calls++;
      if (calls === 1) {
        first_request = input;
        return new Promise((resolve) => {
          finish = resolve;
        });
      }
      return reply(input);
    },
  });
  try {
    await provider.start((next) => {
      snapshot = next;
    });
    await wait_until(() => Boolean(finish));
    provider.pin_session('chosen');
    finish?.(reply(first_request!));
    await wait_until(() => snapshot?.session_id === 'chosen');
    assert.equal(snapshot?.state, 'working');
    assert.equal(calls, 2);
  } finally {
    provider.stop();
  }
});
