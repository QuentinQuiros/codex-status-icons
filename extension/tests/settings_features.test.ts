import test from 'node:test';
import assert from 'node:assert/strict';
import {
  apply_settings_changes,
  valid_settings_changes,
  valid_workspace_label,
  read_config,
  valid_sound_file,
} from '../src/config';
import { parse_server_message } from '../src/ipc/protocol';
import { create_remote_workspace, workspace_label } from '../src/workspace';

test('sound modes default to ChatGPT and retain Windows and validated local WAV choices globally', async () => {
  assert.equal(read_config(() => undefined).notification_sound, 'chatgpt');
  assert.equal(read_config(() => undefined).notification_sound_file, '');
  assert.equal(
    read_config((key) => (key === 'notification_sound' ? 'invalid' : undefined)).notification_sound,
    'chatgpt',
  );
  for (const mode of ['chatgpt', 'windows', 'silent', 'custom'])
    assert.equal(valid_settings_changes({ notification_sound: mode }), true);
  for (const invalid of ['invalid', false, 0, null])
    assert.equal(valid_settings_changes({ notification_sound: invalid }), false);
  for (const invalid of [
    'relative.wav',
    '\\\\server\\sound.wav',
    'https://example/sound.wav',
    'C:/sound.mp3',
    'C:/sound.wav\n',
  ])
    assert.equal(valid_sound_file(invalid), false);
  const changes = {
    notification_sound: 'custom',
    notification_sound_file: 'C:/Fixtures/chime.wav',
  } as const;
  assert.equal(
    parse_server_message(
      JSON.stringify({ version: 1, type: 'configure_settings', request_id: 'sound', changes }),
    )?.type,
    'configure_settings',
  );
  const writes: unknown[] = [];
  assert.equal(
    await apply_settings_changes(
      changes,
      true,
      () => undefined,
      async (...args) => {
        writes.push(args);
      },
    ),
    true,
  );
  assert.deepEqual(writes, [
    ['notification_sound', 'custom', 'global'],
    ['notification_sound_file', 'C:/Fixtures/chime.wav', 'global'],
  ]);
  const built_in_writes: unknown[] = [];
  assert.equal(
    await apply_settings_changes(
      { notification_sound: 'chatgpt' },
      true,
      () => undefined,
      async (...args) => {
        built_in_writes.push(args);
      },
    ),
    true,
  );
  assert.deepEqual(built_in_writes, [['notification_sound', 'chatgpt', 'global']]);
});

test('failed custom sound saves restore both prior global overrides', async () => {
  const stored: Record<string, string | number | boolean | undefined> = {
    notification_sound: 'silent',
    notification_sound_file: undefined,
  };
  let fail = true;
  assert.equal(
    await apply_settings_changes(
      { notification_sound: 'custom', notification_sound_file: 'C:/Fixtures/chime.wav' },
      true,
      (key) => stored[key],
      async (key, value) => {
        if (key === 'notification_sound_file' && fail) {
          fail = false;
          throw new Error('read-only');
        }
        stored[key] = value;
      },
    ),
    false,
  );
  assert.deepEqual(stored, { notification_sound: 'silent', notification_sound_file: undefined });
});

test('custom icon letters accept one Unicode letter or digit and an empty automatic choice', () => {
  for (const value of ['', 'Q', '7', 'é', 'e\u0301', '𝔄'])
    assert.equal(valid_workspace_label(value), true, value);
  for (const value of ['QQ', ' ', '?', '🧩', 'Q\n', '\u0301', 'PRIVATE_PROMPT', 7, null])
    assert.equal(valid_workspace_label(value), false);
  assert.equal(workspace_label('Pascale', 'é'), 'E');
  assert.equal(workspace_label('Pascale', ''), 'P');
  const frame = {
    version: 1,
    type: 'configure_settings',
    request_id: 'letter',
    changes: { workspace_label: '' },
  };
  assert.equal(parse_server_message(JSON.stringify(frame))?.type, 'configure_settings');
  assert.equal(
    parse_server_message(JSON.stringify({ ...frame, changes: { workspace_label: 'QQ' } })),
    undefined,
  );
});

test('notifications default on, accept only booleans and save globally for SSH workspaces', async () => {
  assert.equal(read_config(() => undefined).notifications_enabled, true);
  assert.equal(
    read_config((key) => (key === 'notifications_enabled' ? false : undefined))
      .notifications_enabled,
    false,
  );
  const frame = {
    version: 1,
    type: 'configure_settings',
    request_id: 'notifications',
    changes: { notifications_enabled: false },
  };
  assert.equal(parse_server_message(JSON.stringify(frame))?.type, 'configure_settings');
  for (const invalid of ['false', 0, null, {}, undefined]) {
    assert.equal(valid_settings_changes({ notifications_enabled: invalid }), false);
    assert.equal(
      parse_server_message(
        JSON.stringify({ ...frame, changes: { notifications_enabled: invalid } }),
      ),
      undefined,
    );
  }
  const writes: unknown[] = [];
  assert.equal(
    await apply_settings_changes(
      { notifications_enabled: false },
      true,
      () => undefined,
      async (...args) => {
        writes.push(args);
      },
    ),
    true,
  );
  assert.deepEqual(writes, [['notifications_enabled', false, 'global']]);
});

test('a failed four-field save restores the original notification preference and workspace overrides', async () => {
  const stored: Record<string, string | number | boolean | undefined> = {
    notifications_enabled: undefined,
    language: 'fr',
    workspace_label: 'P',
    stale_working_minutes: 60,
  };
  let fail = true;
  assert.equal(
    await apply_settings_changes(
      {
        notifications_enabled: false,
        language: 'en',
        workspace_label: 'Q',
        stale_working_minutes: 600,
      },
      true,
      (key) => stored[key],
      async (key, value) => {
        if (key === 'stale_working_minutes' && fail) {
          fail = false;
          throw new Error('read-only');
        }
        stored[key] = value;
      },
    ),
    false,
  );
  assert.deepEqual(stored, {
    notifications_enabled: undefined,
    language: 'fr',
    workspace_label: 'P',
    stale_working_minutes: 60,
  });
});

test('saving a letter is scoped to its SSH workspace and preserves that window identity', async () => {
  const writes: unknown[] = [];
  assert.equal(
    await apply_settings_changes(
      { workspace_label: 'Q' },
      true,
      () => undefined,
      async (...args) => {
        writes.push(args);
      },
    ),
    true,
  );
  assert.equal(
    await apply_settings_changes(
      { workspace_label: '' },
      false,
      () => 'Q',
      async (...args) => {
        writes.push(args);
      },
    ),
    true,
  );
  assert.deepEqual(writes, [
    ['workspace_label', 'Q', 'workspace'],
    ['workspace_label', '', 'global'],
  ]);
  const root = 'vscode-remote://ssh-remote+fixture/srv/project';
  const automatic = create_remote_workspace('Project', [root], '', 'same-window');
  const custom = create_remote_workspace('Project', [root], 'Q', 'same-window');
  assert.equal(custom.label, 'Q');
  assert.equal(automatic.label, 'P');
  assert.equal(custom.workspace_id, automatic.workspace_id);
  assert.deepEqual(custom.workspace_roots, automatic.workspace_roots);
});

test('three-field settings saves roll back exact overrides on failure and reject invalid letters before writes', async () => {
  const stored: Record<string, string | number | boolean | undefined> = {
    language: 'fr',
    workspace_label: undefined,
    stale_working_minutes: 60,
  };
  let failure = true;
  assert.equal(
    await apply_settings_changes(
      { workspace_label: 'Q', language: 'en', stale_working_minutes: 90 },
      true,
      (key) => stored[key],
      async (key, value) => {
        if (key === 'stale_working_minutes' && failure) {
          failure = false;
          throw new Error('read-only');
        }
        stored[key] = value;
      },
    ),
    false,
  );
  assert.deepEqual(stored, {
    language: 'fr',
    workspace_label: undefined,
    stale_working_minutes: 60,
  });
  let writes = 0;
  assert.equal(
    await apply_settings_changes(
      { workspace_label: 'QQ', language: 'en' },
      true,
      () => undefined,
      async () => {
        writes++;
      },
    ),
    false,
  );
  assert.equal(writes, 0);
  assert.equal(
    valid_settings_changes({ workspace_label: 'Q', language: 'en', stale_working_minutes: 90 }),
    true,
  );
});
