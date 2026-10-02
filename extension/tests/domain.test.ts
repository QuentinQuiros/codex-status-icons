import test from 'node:test';
import assert from 'node:assert/strict';
import { create_workspace, normalize_path, workspace_label } from '../src/workspace';
import {
  apply_timing_setting,
  apply_timing_changes,
  apply_settings_changes,
  read_config,
} from '../src/config';
import { aggregate_states, codex_states, unknown_snapshot } from '../src/state';
import { FrameDecoder, parse_server_message, serialize_message } from '../src/ipc/protocol';
import { SafeLogger } from '../src/log';
import { resolve_language, translate } from '../src/i18n';

test('window IDs differ even for the same workspace', () => {
  const first = create_workspace('Pascale', ['C:\\Projects\\Pascale']);
  const second = create_workspace('Pascale', ['C:\\Projects\\Pascale']);
  assert.notEqual(first.workspace_id, second.workspace_id);
  assert.equal(first.label, 'P');
});
test('path normalization preserves exact root equality', () => {
  assert.equal(normalize_path('C:/Projects/Pascale/'), 'c:\\projects\\pascale');
  assert.notEqual(normalize_path('C:/Pascale'), normalize_path('C:/Pascale-Admin'));
});
test('empty window gets distinct ID and explicit empty roots', () => {
  const empty = create_workspace(undefined, []);
  assert.equal(
    empty.workspace_name,
    translate(
      resolve_language('auto', Intl.DateTimeFormat().resolvedOptions().locale),
      'workspace.empty',
    ),
  );
  assert.deepEqual(empty.workspace_roots, []);
});
test('multi-root name and paths, same names on different paths', () => {
  const workspace = create_workspace('Projet partagé', ['C:/A', 'D:/B', 'c:/a/']);
  assert.deepEqual(workspace.workspace_roots, ['c:\\a', 'd:\\b']);
  assert.notEqual(
    create_workspace('Admin', ['C:/A']).workspace_path,
    create_workspace('Admin', ['D:/A']).workspace_path,
  );
});
test('workspace labels strip accents, skip punctuation and accept override', () => {
  assert.equal(workspace_label('École'), 'E');
  assert.equal(workspace_label('🧩 Admin'), 'A');
  assert.equal(workspace_label('Pascale', ' W '), 'W');
  assert.equal(workspace_label('🧩'), '?');
});
test('config validates types, finite numbers and bounds', () => {
  const values: Record<string, unknown> = {
    enabled: false,
    exit_grace_seconds: -2,
    stale_working_minutes: Number.NaN,
    workspace_label: ' X ',
    log_level: 'unsafe',
  };
  const config = read_config((key) => values[key]);
  assert.equal(config.enabled, false);
  assert.equal('exit_grace_seconds' in config, false);
  assert.equal(config.stale_working_minutes, 60);
  assert.equal(config.workspace_label, 'X');
  assert.equal(config.log_level, 'off');
  assert.equal(config.start_tray_automatically, true);
});
test('aggregation prioritizes independent activity among the four supported states', () => {
  const working = {
    state: 'working' as const,
    reason: 'turn_started',
    provider: 'session' as const,
  };
  assert.deepEqual(codex_states, ['idle', 'working', 'rate_limited', 'unknown']);
  assert.equal(aggregate_states([unknown_snapshot('x'), working]).state, 'working');
  assert.equal(aggregate_states([working, { ...working, state: 'rate_limited' }]).state, 'working');
  assert.equal(aggregate_states([]).state, 'unknown');
});
test('freshness writes to the workspace or globally in an empty window', async () => {
  const writes: unknown[] = [];
  const write = async (...args: unknown[]): Promise<void> => {
    writes.push(args);
  };
  assert.equal(await apply_timing_setting('stale_working_minutes', 90, true, write), true);
  assert.equal(await apply_timing_setting('stale_working_minutes', 30, false, write), true);
  assert.deepEqual(writes, [
    ['stale_working_minutes', 90, 'workspace'],
    ['stale_working_minutes', 30, 'global'],
  ]);
});
test('failed and invalid menu settings never report a successful save', async () => {
  let writes = 0;
  const write = async (): Promise<void> => {
    writes++;
    throw new Error('read-only settings');
  };
  assert.equal(await apply_timing_setting('stale_working_minutes', 45, true, write), false);
  assert.equal(await apply_timing_setting('stale_working_minutes', 1441, true, write), false);
  assert.equal(await apply_timing_setting('stale_working_minutes', Number.NaN, true, write), false);
  assert.equal(writes, 1);
});
test('IPC timing requests reject arbitrary settings, bad numbers and missing correlation IDs', () => {
  const frame = {
    version: 1,
    type: 'configure',
    request_id: 'a',
    key: 'stale_working_minutes',
    value: 5,
  };
  assert.equal(parse_server_message(JSON.stringify(frame))?.type, 'configure');
  assert.equal(
    parse_server_message(JSON.stringify({ ...frame, key: 'stale_working_minutes', value: 1440 }))
      ?.type,
    'configure',
  );
  for (const extra of [
    { key: 'sessions_directory' },
    { value: 4 },
    { key: 'exit_grace_seconds', value: 15 },
    { value: '60' },
    { value: null },
    { request_id: '' },
    { request_id: 'a'.repeat(100) },
    { key: 'stale_working_minutes', value: 1441 },
  ])
    assert.equal(parse_server_message(JSON.stringify({ ...frame, ...extra })), undefined);
});
test('one settings request saves language and freshness with their separate scopes', async () => {
  const writes: unknown[] = [];
  assert.equal(
    await apply_settings_changes(
      { language: 'en', stale_working_minutes: 600 },
      true,
      () => undefined,
      async (...args) => {
        writes.push(args);
      },
    ),
    true,
  );
  assert.deepEqual(writes, [
    ['language', 'en', 'global'],
    ['stale_working_minutes', 600, 'workspace'],
  ]);
});

test('a failed second write restores exact overrides including an absent global value', async () => {
  const stored: Record<string, number | string | boolean | undefined> = {
    language: undefined,
    stale_working_minutes: 600,
  };
  let fail_once = true;
  assert.equal(
    await apply_settings_changes(
      { language: 'en', stale_working_minutes: 90 },
      true,
      (key) => stored[key],
      async (key, value) => {
        if (key === 'stale_working_minutes' && fail_once) {
          fail_once = false;
          throw new Error('read only');
        }
        stored[key] = value;
      },
    ),
    false,
  );
  assert.deepEqual(stored, { language: undefined, stale_working_minutes: 600 });
});

test('settings batches validate every value before any write and reject arbitrary keys', async () => {
  let writes = 0;
  const frame = {
    version: 1,
    type: 'configure_settings',
    request_id: 'batch',
    changes: { language: 'en', stale_working_minutes: 600 },
  };
  assert.equal(parse_server_message(JSON.stringify(frame))?.type, 'configure_settings');
  for (const changes of [
    {},
    { stale_working_minutes: 1441 },
    { exit_grace_seconds: 15 },
    { sessions_directory: 60 },
    { exit_grace_seconds: 30, stale_working_minutes: null },
  ])
    assert.equal(parse_server_message(JSON.stringify({ ...frame, changes })), undefined);
  assert.equal(parse_server_message(JSON.stringify({ ...frame, request_id: '' })), undefined);
  assert.equal(
    await apply_timing_changes(
      { stale_working_minutes: 1441 },
      true,
      () => 60,
      async () => {
        writes++;
      },
    ),
    false,
  );
  assert.equal(writes, 0);
});

test('protocol fragments unicode, batches lines and rejects excess', () => {
  const decoder = new FrameDecoder();
  const bytes = Buffer.from(serialize_message({ version: 1, type: 'focus', request_id: 'été' }));
  assert.deepEqual(decoder.push(bytes.subarray(0, bytes.length - 3)), []);
  const frames = decoder.push(bytes.subarray(bytes.length - 3));
  assert.equal(parse_server_message(frames[0]!)?.type, 'focus');
  assert.equal(decoder.push(Buffer.from('a\nb\n')).length, 2);
  assert.throws(() => decoder.push(Buffer.alloc(16385)), /frame_too_large/);
});
test('protocol ignores unsupported versions and malformed messages', () => {
  for (const line of [
    '{',
    '{}',
    '{"version":2,"type":"welcome","server_pid":1}',
    '{"version":1,"type":"association","ambiguous":"yes"}',
  ])
    assert.equal(parse_server_message(line), undefined);
});
test('logs are opt-in and whitelist only technical fields', () => {
  const lines: string[] = [];
  new SafeLogger('off', (line) => lines.push(line)).write('state_changed', { reason: 'x' });
  assert.equal(lines.length, 0);
  const fields = {
    state: 'working',
    reason: 'turn_started',
    prompt: 'PRIVATE_CONTENT',
    token: 'SECRET_TOKEN',
  };
  new SafeLogger('debug', (line) => lines.push(line)).write('state_changed', fields);
  assert.ok(lines[0]?.includes('state=working'));
  assert.ok(!lines[0]?.includes('PRIVATE_CONTENT'));
  assert.ok(!lines[0]?.includes('SECRET_TOKEN'));
});
