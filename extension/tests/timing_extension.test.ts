import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync as read_file_sync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire as create_require } from 'node:module';
import vm from 'node:vm';
import type { ClientMessage, ServerMessage } from '../src/ipc/protocol';

test('extension acknowledges a persisted menu setting before reconfiguring its transport', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'codex-timing-'));
  const values: Record<string, unknown> = {
    sessions_directory: directory,
    exit_grace_seconds: 5,
    workspace_label: 'T'.repeat(400),
  };
  const frames: ClientMessage[] = [];
  const writes: unknown[] = [];
  const peers: Array<{ receive: (message: ServerMessage) => void }> = [];
  let configuration_listener:
    ((event: { affectsConfiguration: () => boolean }) => void) | undefined;
  let fail_write = false;
  const commands = new Map<string, () => Promise<unknown>>();
  let quick_pick: { items: { label: string }[]; options: { title: string } } | undefined;
  const disposable = { dispose: (): void => {} };
  const fake_vscode = {
    ConfigurationTarget: { Global: 1, Workspace: 2 },
    workspace: {
      isTrusted: true,
      name: 'Timing fixture',
      workspaceFolders: [{ uri: { scheme: 'file', fsPath: directory } }],
      getConfiguration: () => ({
        get: (key: string) => values[key],
        inspect: (key: string) => ({ globalValue: values[key], workspaceValue: values[key] }),
        update: async (key: string, value: number | string | boolean, target: number) => {
          if (fail_write) throw new Error('Settings are read-only');
          values[key] = value;
          writes.push([key, value, target]);
          // VS Code can emit the event before its write promise resolves.
          configuration_listener?.({ affectsConfiguration: () => true });
        },
      }),
      onDidChangeConfiguration: (listener: typeof configuration_listener) => {
        configuration_listener = listener;
        return disposable;
      },
      onDidChangeWorkspaceFolders: () => disposable,
    },
    window: {
      state: { focused: false },
      createOutputChannel: () => ({ ...disposable, appendLine: () => {}, show: () => {} }),
      onDidChangeWindowState: () => disposable,
      showQuickPick: async (items: { label: string }[], options: { title: string }) => {
        quick_pick = { items, options };
        return undefined;
      },
    },
    env: {},
    extensions: { getExtension: () => ({}), onDidChange: () => disposable },
    commands: {
      registerCommand: (id: string, handler: () => Promise<unknown>) => {
        commands.set(id, handler);
        return disposable;
      },
    },
  };
  class FakeClient {
    constructor(
      private options: {
        on_message: (message: ServerMessage) => void;
        make_message: (type: 'hello' | 'update' | 'heartbeat') => ClientMessage;
      },
    ) {
      peers.push({ receive: options.on_message });
    }
    start(): void {
      this.send(this.options.make_message('hello'));
    }
    stop(): void {}
    send(message: ClientMessage): void {
      frames.push(message);
    }
    send_update(): void {
      this.send(this.options.make_message('update'));
    }
  }
  const filename = path.resolve('extension/out/src/extension.js');
  const original_require = create_require(filename);
  const module = {
    exports: {} as { activate: (context: unknown) => Promise<unknown>; deactivate: () => void },
  };
  const load = vm.runInNewContext(
    `(function(require, module, exports) { ${read_file_sync(filename, 'utf8')}\n})`,
    { process, Buffer, setTimeout, clearTimeout },
  ) as (require: (id: string) => unknown, module: unknown, exports: unknown) => void;
  load(
    (id) =>
      id === './codex/vscode_quota_provider'
        ? { with_account_quota: (provider: unknown) => provider }
        : id === './remote_bridge'
          ? { create_remote_fetch: () => () => undefined }
          : id === 'vscode'
            ? fake_vscode
            : id === './ipc/client'
              ? { IpcClient: FakeClient }
              : original_require(id),
    module,
    module.exports,
  );
  const wait_for = async (check: () => boolean): Promise<void> => {
    const until = Date.now() + 2000;
    while (!check()) {
      assert.ok(Date.now() < until, 'Configuration response timed out');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  try {
    await module.exports.activate({
      subscriptions: [],
      extensionPath: directory,
      extension: { packageJSON: { version: 'fixture' } },
    });
    const initial = frames.find((frame) => frame.type === 'hello');
    assert.ok(initial && 'settings' in initial && initial.settings?.exit_grace_seconds === 15);
    assert.ok(initial && 'settings' in initial && initial.settings?.workspace_label === 'T');
    for (const [key, value, target] of [['stale_working_minutes', 90, 2]] as const) {
      const before = frames.length;
      peers.at(-1)!.receive({ version: 1, type: 'configure', request_id: key, key, value });
      await wait_for(() =>
        frames.slice(before).some((frame) => frame.type === 'configuration_result'),
      );
      const sent = frames.slice(before);
      const ack = sent.findIndex((frame) => frame.type === 'configuration_result');
      const disconnect = sent.findIndex((frame) => frame.type === 'disconnect');
      assert.ok(ack >= 0 && disconnect > ack, 'Transport closed before acknowledgement');
      assert.equal((sent[ack] as { success: boolean }).success, true);
      assert.deepEqual(writes.at(-1), [key, value, target]);
      await wait_for(() => frames.slice(before).some((frame) => frame.type === 'hello'));
      const hello = frames.slice(before).find((frame) => frame.type === 'hello');
      assert.ok(hello && 'settings' in hello && hello.settings?.[key] === value);
    }
    const batch_before = frames.length;
    const writes_before = writes.length;
    peers.at(-1)!.receive({
      version: 1,
      type: 'configure_settings',
      request_id: 'both',
      changes: {
        stale_working_minutes: 600,
        language: 'en',
        workspace_label: 'Q',
        notifications_enabled: false,
        notification_sound: 'custom',
        notification_sound_file: 'C:/Fixtures/chime.wav',
      },
    });
    await wait_for(() => frames.slice(batch_before).some((frame) => frame.type === 'hello'));
    const batch = frames.slice(batch_before);
    const response_index = batch.findIndex((frame) => frame.type === 'configuration_result');
    assert.equal((batch[response_index] as { success: boolean }).success, true);
    assert.ok(batch.findIndex((frame) => frame.type === 'disconnect') > response_index);
    assert.equal(batch.filter((frame) => frame.type === 'hello').length, 1);
    assert.deepEqual(writes.slice(writes_before), [
      ['stale_working_minutes', 600, 2],
      ['language', 'en', 1],
      ['workspace_label', 'Q', 2],
      ['notifications_enabled', false, 1],
      ['notification_sound', 'custom', 1],
      ['notification_sound_file', 'C:/Fixtures/chime.wav', 1],
    ]);
    const batch_hello = batch.find((frame) => frame.type === 'hello');
    assert.ok(
      batch_hello &&
        'settings' in batch_hello &&
        batch_hello.settings?.stale_working_minutes === 600 &&
        batch_hello.settings.configuration_version === 7,
    );
    assert.ok(batch_hello && 'settings' in batch_hello && batch_hello.settings?.language === 'en');
    assert.ok(
      batch_hello &&
        'settings' in batch_hello &&
        batch_hello.settings?.notifications_enabled === false,
    );
    assert.ok(
      batch_hello &&
        'settings' in batch_hello &&
        batch_hello.settings?.notification_sound === 'custom' &&
        batch_hello.settings.notification_sound_file === 'C:/Fixtures/chime.wav',
    );
    assert.ok(batch_hello && 'workspace' in batch_hello && batch_hello.workspace.label === 'Q');
    assert.ok(
      batch_hello &&
        'extension_version' in batch_hello &&
        batch_hello.extension_version === 'fixture' &&
        batch_hello.location === 'local',
    );
    const reset_before = frames.length;
    peers.at(-1)!.receive({
      version: 1,
      type: 'configure_settings',
      request_id: 'automatic',
      changes: { workspace_label: '' },
    });
    await wait_for(() => frames.slice(reset_before).some((frame) => frame.type === 'hello'));
    const automatic = frames.slice(reset_before).find((frame) => frame.type === 'hello');
    assert.ok(
      automatic &&
        'workspace' in automatic &&
        automatic.workspace.label === 'T' &&
        automatic.settings?.workspace_label === '',
    );
    peers.at(-1)!.receive({ version: 1, type: 'welcome', server_pid: 1, language: 'fr' });
    await commands.get('codex_status.pin_session')!();
    assert.equal(quick_pick?.items[0]?.label, 'Automatic association');
    assert.equal(quick_pick?.options.title, 'Codex session for this window (technical IDs only)');
    fail_write = true;
    const before = frames.length;
    peers.at(-1)!.receive({
      version: 1,
      type: 'configure',
      request_id: 'failure',
      key: 'stale_working_minutes',
      value: 120,
    });
    await wait_for(() =>
      frames.slice(before).some((frame) => frame.type === 'configuration_result'),
    );
    assert.equal((frames.at(-1) as { success: boolean }).success, false);
    assert.equal(values.stale_working_minutes, 600);
    assert.equal(
      frames.slice(before).some((frame) => frame.type === 'disconnect'),
      false,
    );
  } finally {
    module.exports.deactivate();
    await rm(directory, { recursive: true, force: true });
  }
});
