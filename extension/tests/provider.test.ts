import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  writeFile as write_file,
  appendFile as append_file,
  rm,
  utimes,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SessionStateProvider } from '../src/codex/session_state_provider';
import type { StateSnapshot } from '../src/state';
const event_line = (payload: unknown, timestamp = new Date().toISOString()): string =>
  JSON.stringify({ timestamp, type: 'event_msg', payload }) + '\n';
const metadata = (id: string, cwd: string, originator = 'codex_vscode'): string =>
  JSON.stringify({
    timestamp: new Date().toISOString(),
    type: 'session_meta',
    payload: { id, cwd, source: 'vscode', originator, cli_version: 'fixture' },
  }) + '\n';

test('real files: independent roots, append, partial, truncate, remove and ambiguity', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'codex-status-test-'));
  const first_file = path.join(directory, 'a.jsonl');
  const second_file = path.join(directory, 'b.jsonl');
  let first: StateSnapshot | undefined;
  let second: StateSnapshot | undefined;
  const first_provider = new SessionStateProvider(directory, ['C:/A']);
  const second_provider = new SessionStateProvider(directory, ['C:/B']);
  try {
    await write_file(first_file, metadata('a', 'C:/A') + event_line({ type: 'task_complete' }));
    await write_file(second_file, metadata('b', 'C:/B') + event_line({ type: 'task_started' }));
    await first_provider.start((value) => {
      first = value;
    });
    await second_provider.start((value) => {
      second = value;
    });
    assert.equal(first?.state, 'idle');
    assert.equal(second?.state, 'working');
    const started = event_line({ type: 'task_started' });
    await append_file(first_file, started.slice(0, -2));
    await first_provider.scan();
    assert.equal(first?.state, 'idle');
    await append_file(first_file, started.slice(-2));
    await first_provider.scan();
    assert.equal(first?.state, 'working');
    assert.equal(second?.state, 'working');
    first_provider.set_ambiguous(true);
    assert.equal(first?.reason, 'ambiguous_workspace_windows');
    first_provider.pin_session('a');
    first_provider.set_ambiguous(false);
    await first_provider.scan();
    assert.equal(first?.state, 'working');
    await write_file(first_file, metadata('new', 'C:/A') + event_line({ type: 'task_complete' }));
    first_provider.pin_session(undefined);
    first_provider.set_ambiguous(false);
    await first_provider.scan();
    assert.equal(first?.session_id, 'new');
    await rm(first_file);
    await first_provider.scan();
    assert.equal(first?.state, 'unknown');
    assert.equal(second?.state, 'working');
  } finally {
    first_provider.stop();
    second_provider.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
test('Desktop is excluded and ambiguous same-path attribution is grey', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'codex-status-test-'));
  let snapshot: StateSnapshot | undefined;
  const provider = new SessionStateProvider(directory, ['C:/A']);
  try {
    await write_file(
      path.join(directory, 'desktop.jsonl'),
      metadata('desktop', 'C:/A', 'Codex Desktop') + event_line({ type: 'task_started' }),
    );
    await provider.start((value) => {
      snapshot = value;
    });
    assert.equal(snapshot?.state, 'unknown');
    assert.equal(provider.sessions().length, 0);
  } finally {
    provider.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
test('oversized prompt is skipped and tail recovers technical end', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'codex-status-test-'));
  let snapshot: StateSnapshot | undefined;
  const provider = new SessionStateProvider(directory, ['C:/A']);
  try {
    await write_file(
      path.join(directory, 'large.jsonl'),
      metadata('a', 'C:/A') +
        event_line({ type: 'task_started' }) +
        JSON.stringify({
          timestamp: new Date().toISOString(),
          type: 'response_item',
          payload: { text: 'PRIVATE'.repeat(250000) },
        }) +
        '\n' +
        event_line({ type: 'task_complete' }),
    );
    await provider.start((value) => {
      snapshot = value;
    });
    assert.equal(snapshot?.state, 'idle');
    assert.ok(!JSON.stringify(snapshot).includes('PRIVATE'));
  } finally {
    provider.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
test('stale running session becomes unknown, without false idle', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'codex-status-test-'));
  const file = path.join(directory, 'a.jsonl');
  let snapshot: StateSnapshot | undefined;
  const provider = new SessionStateProvider(directory, ['C:/A'], 5);
  try {
    await write_file(file, metadata('a', 'C:/A') + event_line({ type: 'task_started' }));
    const old = new Date(Date.now() - 600000);
    await utimes(file, old, old);
    await provider.start((value) => {
      snapshot = value;
    });
    assert.equal(snapshot?.state, 'unknown');
    assert.equal(snapshot?.reason, 'stale_session');
  } finally {
    provider.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test('SSH session state follows appended events even when the file timestamp is unchanged', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'codex-status-settings-'));
  const file = path.join(directory, 'health-workspace.jsonl');
  const root = '/var/www/vhosts/health.example';
  const past = new Date(Date.now() - 23 * 24 * 60 * 60 * 1000).toISOString();
  const modified = new Date(Math.floor(Date.now() / 1000) * 1000);
  let snapshot: StateSnapshot | undefined;
  const provider = new SessionStateProvider(directory, [root], 60, 'posix');
  try {
    await write_file(
      file,
      metadata('health-workspace', root) +
        event_line({ type: 'task_started' }, past) +
        event_line({ type: 'task_complete' }, past) +
        event_line({ type: 'thread_settings_applied' }),
    );
    await utimes(file, modified, modified);
    await provider.start((value) => {
      snapshot = value;
    });
    assert.equal(snapshot?.state, 'unknown');
    assert.equal(snapshot?.reason, 'stale_session');
    assert.equal(snapshot?.since, past);
    await append_file(file, event_line({ type: 'thread_settings_applied' }));
    await utimes(file, modified, modified);
    await provider.scan();
    assert.equal(snapshot?.state, 'unknown');
    await append_file(file, event_line({ type: 'task_started' }));
    await utimes(file, modified, modified);
    await provider.scan();
    assert.equal(snapshot?.state, 'working');
    await append_file(
      file,
      event_line({ type: 'error', codex_error_info: 'usage_limit_exceeded' }),
    );
    await utimes(file, modified, modified);
    await provider.scan();
    assert.equal(snapshot?.state, 'rate_limited');
    await append_file(file, event_line({ type: 'task_started' }));
    await utimes(file, modified, modified);
    await provider.scan();
    assert.equal(snapshot?.state, 'working');
    await append_file(file, event_line({ type: 'task_complete' }));
    await utimes(file, modified, modified);
    await provider.scan();
    assert.equal(snapshot?.state, 'idle');
  } finally {
    provider.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test('technical progress keeps a long task fresh without resetting its duration', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'codex-status-progress-'));
  const file = path.join(directory, 'a.jsonl');
  const past = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  let snapshot: StateSnapshot | undefined;
  const provider = new SessionStateProvider(directory, ['/srv/A'], 5, 'posix');
  try {
    await write_file(file, metadata('a', '/srv/A') + event_line({ type: 'task_started' }, past));
    await provider.start((value) => {
      snapshot = value;
    });
    assert.equal(snapshot?.state, 'unknown');
    for (const type of ['token_count', 'item_completed']) {
      await append_file(file, event_line({ type }));
      await provider.scan();
      assert.equal(snapshot?.state, 'working');
      assert.equal(snapshot?.since, past);
    }
    await append_file(file, event_line({ type: 'task_complete' }));
    await provider.scan();
    assert.equal(snapshot?.state, 'idle');
  } finally {
    provider.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test('settings and token snapshots cannot revive an expired idle or quota state', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'codex-status-expired-evidence-'));
  const file = path.join(directory, 'a.jsonl');
  const past = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  let snapshot: StateSnapshot | undefined;
  const provider = new SessionStateProvider(directory, ['/srv/A'], 60, 'posix');
  try {
    await provider.start((value) => {
      snapshot = value;
    });
    for (const payload of [
      { type: 'task_complete' },
      { type: 'error', codex_error_info: 'usage_limit_exceeded' },
    ]) {
      await write_file(
        file,
        metadata(payload.type, '/srv/A') +
          event_line(payload, past) +
          event_line({ type: 'thread_settings_applied' }) +
          event_line({ type: 'token_count', rate_limits: { primary: { used_percent: 100 } } }),
      );
      await provider.scan();
      assert.equal(snapshot?.state, 'unknown');
      assert.equal(snapshot?.reason, 'stale_session');
      assert.equal(snapshot?.since, past);
    }
  } finally {
    provider.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
test('recent sessions take precedence over expired history while current unfinished work stays visible', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'codex-status-history-'));
  const old_file = path.join(directory, 'old.jsonl');
  const current_file = path.join(directory, 'current.jsonl');
  const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
  let snapshot: StateSnapshot | undefined;
  const provider = new SessionStateProvider(directory, ['/srv/A'], 60, 'posix');
  try {
    await write_file(old_file, metadata('old', '/srv/A') + event_line({ type: 'task_complete' }));
    await utimes(old_file, past, past);
    await write_file(
      current_file,
      metadata('current', '/srv/A') + event_line({ type: 'task_complete' }),
    );
    await provider.start((value) => {
      snapshot = value;
    });
    assert.equal(snapshot?.state, 'idle');
    assert.equal(snapshot?.session_id, 'current');
    await append_file(current_file, event_line({ type: 'task_started' }));
    await provider.scan();
    assert.equal(snapshot?.state, 'working');
    await append_file(current_file, event_line({ type: 'task_complete' }));
    await provider.scan();
    assert.equal(snapshot?.state, 'idle');
    await utimes(current_file, past, past);
    await provider.scan();
    assert.equal(snapshot?.reason, 'stale_session');
    await append_file(current_file, event_line({ type: 'task_complete' }));
    const unclosed_file = path.join(directory, 'unclosed.jsonl');
    await write_file(
      unclosed_file,
      metadata('unclosed', '/srv/A') + event_line({ type: 'task_started' }),
    );
    await utimes(unclosed_file, past, past);
    await provider.scan();
    assert.equal(snapshot?.state, 'idle');
    assert.equal(snapshot?.session_id, 'current');
    await utimes(unclosed_file, new Date(), new Date());
    await provider.scan();
    assert.equal(snapshot?.state, 'working');
    assert.equal(snapshot?.session_id, 'unclosed');
    provider.pin_session('current');
    await provider.scan();
    assert.equal(snapshot?.state, 'idle');
    await utimes(unclosed_file, past, past);
    provider.pin_session('unclosed');
    await provider.scan();
    assert.equal(snapshot?.reason, 'stale_session');
    assert.equal(snapshot?.session_id, 'unclosed');
  } finally {
    provider.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test('expired errors and unsupported history cannot hide a recent confirmed completion', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'codex-status-old-errors-'));
  const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
  let snapshot: StateSnapshot | undefined;
  const provider = new SessionStateProvider(directory, ['/srv/A'], 60, 'posix');
  try {
    for (const [id, payload] of [
      ['quota', { type: 'error', codex_error_info: 'usage_limit_exceeded' }],
      ['error', { type: 'error' }],
      ['unsupported', { type: 'unrecognized_event' }],
    ] as const) {
      const file = path.join(directory, `${id}.jsonl`);
      await write_file(file, metadata(id, '/srv/A') + event_line(payload));
      await utimes(file, past, past);
    }
    await provider.start((value) => {
      snapshot = value;
    });
    assert.equal(snapshot?.state, 'unknown');
    assert.equal(snapshot?.reason, 'stale_session');
    await write_file(
      path.join(directory, 'current.jsonl'),
      metadata('current', '/srv/A') + event_line({ type: 'task_complete' }),
    );
    await provider.scan();
    assert.equal(snapshot?.state, 'idle');
    assert.equal(snapshot?.session_id, 'current');
    const quota_file = path.join(directory, 'quota.jsonl');
    await utimes(quota_file, new Date(), new Date());
    await provider.scan();
    assert.equal(snapshot?.state, 'rate_limited');
    assert.equal(snapshot?.session_id, 'quota');
  } finally {
    provider.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test('a recent unknown session remains unknown alongside a recent completed session', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'codex-status-current-unknown-'));
  let snapshot: StateSnapshot | undefined;
  const provider = new SessionStateProvider(directory, ['/srv/A'], 60, 'posix');
  try {
    await write_file(
      path.join(directory, 'complete.jsonl'),
      metadata('complete', '/srv/A') + event_line({ type: 'task_complete' }),
    );
    await write_file(
      path.join(directory, 'unknown.jsonl'),
      metadata('unknown', '/srv/A') + event_line({ type: 'error' }),
    );
    await provider.start((value) => {
      snapshot = value;
    });
    assert.equal(snapshot?.state, 'unknown');
    assert.equal(snapshot?.reason, 'technical_error');
    assert.equal(snapshot?.session_id, 'unknown');
  } finally {
    provider.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test('structured quota persists through completion until next start', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'codex-status-test-'));
  const file = path.join(directory, 'a.jsonl');
  let snapshot: StateSnapshot | undefined;
  const provider = new SessionStateProvider(directory, ['C:/A']);
  try {
    await write_file(
      file,
      metadata('a', 'C:/A') +
        event_line({ type: 'error', codex_error_info: 'usage_limit_exceeded' }) +
        event_line({ type: 'task_complete' }),
    );
    await provider.start((value) => {
      snapshot = value;
    });
    assert.equal(snapshot?.state, 'rate_limited');
    await append_file(file, event_line({ type: 'task_started' }));
    await provider.scan();
    assert.equal(snapshot?.state, 'working');
  } finally {
    provider.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
