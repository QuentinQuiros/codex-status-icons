import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  writeFile as write_file,
  appendFile as append_file,
  rm,
  mkdir,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SessionStateProvider } from '../src/codex/session_state_provider';
import type { StateSnapshot } from '../src/state';
const record = (type: string, payload: unknown): string =>
  JSON.stringify({ timestamp: new Date().toISOString(), type, payload }) + '\n';
const session = (id: string, cwd: string): string =>
  record('session_meta', {
    id,
    cwd,
    originator: 'codex_vscode',
    source: 'vscode',
    cli_version: 'fixture',
  });
const wait_until = async (condition: () => boolean): Promise<void> => {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('watcher timeout');
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
};
test('larger replacement file resets session identity and state', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'codex-status-replace-'));
  const file = path.join(directory, 'a.jsonl');
  let snapshot: StateSnapshot | undefined;
  const provider = new SessionStateProvider(directory, ['C:/A']);
  try {
    await write_file(file, session('old', 'C:/A') + record('event_msg', { type: 'task_started' }));
    await provider.start((value) => {
      snapshot = value;
    });
    assert.equal(snapshot?.state, 'working');
    await write_file(
      file,
      session('new', 'C:/A') +
        record('response_item', { text: 'ignored'.repeat(100) }) +
        record('event_msg', { type: 'task_complete' }),
    );
    await provider.scan();
    assert.equal(snapshot?.session_id, 'new');
    assert.equal(snapshot?.state, 'idle');
  } finally {
    provider.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
test('filesystem watcher observes append without explicit polling', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'codex-status-watch-'));
  const file = path.join(directory, 'a.jsonl');
  let snapshot: StateSnapshot | undefined;
  const provider = new SessionStateProvider(directory, ['C:/A']);
  try {
    await write_file(file, session('a', 'C:/A') + record('event_msg', { type: 'task_complete' }));
    await provider.start((value) => {
      snapshot = value;
    });
    await append_file(file, record('event_msg', { type: 'task_started' }));
    await wait_until(() => snapshot?.state === 'working');
    assert.equal(snapshot?.session_id, 'a');
  } finally {
    provider.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
test('missing sessions directory recovers when created', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'codex-status-missing-'));
  const directory = path.join(root, 'sessions');
  let snapshot: StateSnapshot | undefined;
  const provider = new SessionStateProvider(directory, ['C:/A']);
  try {
    await provider.start((value) => {
      snapshot = value;
    });
    assert.equal(snapshot?.state, 'unknown');
    await mkdir(directory);
    await write_file(
      path.join(directory, 'a.jsonl'),
      session('a', 'C:/A') + record('event_msg', { type: 'task_complete' }),
    );
    await provider.scan();
    assert.equal(snapshot?.state, 'idle');
  } finally {
    provider.stop();
    await rm(root, { recursive: true, force: true });
  }
});
test('multi-root matches exact cwd and excludes a prefix sibling', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'codex-status-roots-'));
  let snapshot: StateSnapshot | undefined;
  const provider = new SessionStateProvider(directory, ['C:/A', 'D:/B']);
  try {
    await write_file(
      path.join(directory, 'b.jsonl'),
      session('b', 'd:/b/') + record('event_msg', { type: 'task_complete' }),
    );
    await write_file(
      path.join(directory, 'sibling.jsonl'),
      session('sibling', 'C:/A-other') + record('event_msg', { type: 'task_started' }),
    );
    await provider.start((value) => {
      snapshot = value;
    });
    assert.equal(snapshot?.state, 'idle');
    assert.equal(snapshot?.session_id, 'b');
  } finally {
    provider.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
test('empty workspace stays unknown until explicit pin, ambiguous pin stays grey', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'codex-status-pin-'));
  let snapshot: StateSnapshot | undefined;
  const provider = new SessionStateProvider(directory, []);
  try {
    await write_file(
      path.join(directory, 'a.jsonl'),
      session('a', 'C:/A') + record('event_msg', { type: 'task_started' }),
    );
    await provider.start((value) => {
      snapshot = value;
    });
    assert.equal(snapshot?.state, 'unknown');
    provider.pin_session('a');
    await wait_until(() => snapshot?.state === 'working');
    assert.equal(snapshot?.state, 'working');
    provider.set_ambiguous(true);
    assert.equal(snapshot?.state, 'unknown');
    assert.equal(snapshot?.session_id, 'a');
  } finally {
    provider.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
