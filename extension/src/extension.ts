import * as vscode from 'vscode';
import path from 'node:path';
import { homedir, userInfo as user_info } from 'node:os';
import { spawn } from 'node:child_process';
import { createHash as create_hash } from 'node:crypto';
import { randomUUID as random_uuid } from 'node:crypto';
import { access } from 'node:fs/promises';
import {
  apply_timing_setting,
  apply_settings_changes,
  companion_exit_delay_seconds,
  read_config,
  valid_workspace_label,
} from './config';
import { resolve_language, translate, type TextKey } from './i18n';
import { create_workspace, create_remote_workspace } from './workspace';
import { unknown_snapshot, type StateSnapshot } from './state';
import { with_account_quota } from './codex/vscode_quota_provider';
import { AccountQuotaStateProvider } from './codex/account_quota_provider';
import { SessionStateProvider } from './codex/session_state_provider';
import { RemoteStateProvider } from './codex/remote_state_provider';
import type { CodexStateProvider } from './codex/codex_state_provider';
import { create_remote_fetch } from './remote_bridge';
import { IpcClient } from './ipc/client';
import { prepare_tray } from './ipc/tray_launcher';
import type { ClientMessage, ServerMessage } from './ipc/protocol';
import { SafeLogger } from './log';

let stop_active: (() => void) | undefined;
export interface CodexStatusExtensionApi {
  request_focus(): Promise<Extract<ServerMessage, { type: 'diagnostics' }> | undefined>;
  get_tray_status(): unknown;
}
export async function activate(
  context: vscode.ExtensionContext,
): Promise<CodexStatusExtensionApi | undefined> {
  if (process.platform !== 'win32' || !vscode.workspace.isTrusted) return;
  const output = vscode.window.createOutputChannel('Codex Status Icons');
  context.subscriptions.push(output);
  let provider: CodexStateProvider | undefined;
  let client: IpcClient | undefined;
  let snapshot: StateSnapshot = unknown_snapshot('initializing');
  let pinned_session: string | undefined;
  let tray_diagnostics: unknown;
  const focus_waiters = new Map<
    string,
    (message: Extract<ServerMessage, { type: 'diagnostics' }>) => void
  >();
  const query_tray = (
    type: 'diagnostics' | 'request_focus',
  ): Promise<Extract<ServerMessage, { type: 'diagnostics' }> | undefined> => {
    const request_id = random_uuid();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        focus_waiters.delete(request_id);
        resolve(undefined);
      }, 4000);
      focus_waiters.set(request_id, (message) => {
        clearTimeout(timer);
        focus_waiters.delete(request_id);
        resolve(message);
      });
      client?.send({ version: 1, type, workspace_id: identity_id, request_id });
    });
  };
  const identity_id = create_workspace(undefined, []).workspace_id;
  let generation = 0;
  let writing_configuration = false;
  let configuration_changed = false;
  let language = resolve_language('auto', vscode.env.language ?? 'en');
  const text = (key: TextKey): string =>
    translate(
      resolve_language(
        read_config((key) => vscode.workspace.getConfiguration('codex_status').get(key)).language,
        language,
      ),
      key,
    );
  let current_identity = create_workspace(undefined, [], '', identity_id);
  const remote_fetch = create_remote_fetch(context);
  const teardown = (): void => {
    generation++;
    client?.send({ version: 1, type: 'disconnect', workspace_id: identity_id });
    client?.stop();
    provider?.stop();
    client = undefined;
    provider = undefined;
  };
  stop_active = teardown;
  const configure = async (): Promise<void> => {
    teardown();
    const current_generation = generation;
    const config = read_config((key) => vscode.workspace.getConfiguration('codex_status').get(key));
    if (!config.enabled) return;
    const folders = vscode.workspace.workspaceFolders ?? [];
    const is_remote = Boolean(vscode.env.remoteName);
    const roots = folders
      .filter((folder) => folder.uri.scheme === 'file')
      .map((folder) => folder.uri.fsPath);
    const identity = (): typeof current_identity =>
      is_remote
        ? create_remote_workspace(
            vscode.workspace.name,
            folders.map((folder) => folder.uri.toString()),
            config.workspace_label,
            identity_id,
            text('workspace.remote'),
          )
        : create_workspace(
            vscode.workspace.name,
            roots,
            config.workspace_label,
            identity_id,
            text('workspace.empty'),
          );
    current_identity = identity();
    const logger = new SafeLogger(config.log_level, (line) => output.appendLine(line));
    const sessions_directory =
      config.sessions_directory ||
      path.join(process.env.CODEX_HOME || path.join(homedir(), '.codex'), 'sessions');
    const next_provider = is_remote
      ? new RemoteStateProvider({
          roots: folders.map((folder) => folder.uri.path),
          sessions_directory: config.remote_sessions_directory,
          stale_minutes: config.stale_working_minutes,
          fetch_snapshot: remote_fetch,
        })
      : with_account_quota(
          new SessionStateProvider(sessions_directory, roots, config.stale_working_minutes),
          sessions_directory,
        );
    provider = next_provider;
    if (pinned_session) next_provider.pin_session(pinned_session);
    const pipe_name = `codex_status_v1_${create_hash('sha256').update(user_info().username.toLowerCase()).digest('hex').slice(0, 20)}`;
    const tray_path = path.join(
      context.extensionPath,
      'bin',
      process.arch === 'arm64' ? 'win-arm64' : 'win-x64',
      'codex_status_tray.exe',
    );
    let last_launch = 0;
    let cached_tray: Promise<string> | undefined;
    const start_tray = async (): Promise<void> => {
      if (
        !config.start_tray_automatically ||
        Date.now() - last_launch < 5000 ||
        current_generation !== generation
      )
        return;
      last_launch = Date.now();
      try {
        await access(tray_path);
        cached_tray ??= prepare_tray(
          tray_path,
          path.join(
            process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local'),
            'codex-status',
            'bin',
          ),
          String(context.extension.packageJSON.version),
        );
        const executable_path = await cached_tray;
        const child = spawn(
          executable_path,
          ['--pipe', pipe_name, ...(config.exit_when_no_windows ? [] : ['--keep-alive'])],
          { detached: true, stdio: 'ignore', windowsHide: true },
        );
        child.on('error', () =>
          logger.write('tray_launch_failed', { reason: 'spawn_error' }, true),
        );
        child.unref();
      } catch {
        cached_tray = undefined;
        logger.write('tray_launch_failed', { reason: 'missing_binary' }, true);
      }
    };
    const make_message = (type: 'hello' | 'heartbeat' | 'update'): ClientMessage => ({
      version: 1,
      type,
      timestamp: new Date().toISOString(),
      workspace: current_identity,
      snapshot,
      quota: (() => {
        const quota =
          next_provider instanceof RemoteStateProvider
            ? next_provider.diagnostics()?.quota
            : next_provider instanceof AccountQuotaStateProvider
              ? next_provider.quota_diagnostics()
              : undefined;
        return quota?.windows
          ? { checked_at: quota.checked_at, windows: quota.windows }
          : undefined;
      })(),
      window_focused: vscode.window.state.focused,
      show_working_duration: config.show_working_duration,
      pinned_session: Boolean(pinned_session),
      extension_version: String(context.extension.packageJSON.version),
      location: vscode.env.remoteName ?? 'local',
      bridge_version:
        next_provider instanceof RemoteStateProvider
          ? next_provider.diagnostics()?.bridge_version
          : undefined,
      settings: {
        exit_grace_seconds: companion_exit_delay_seconds,
        stale_working_minutes: config.stale_working_minutes,
        exit_when_no_windows: config.exit_when_no_windows,
        configuration_version: 7,
        notifications_enabled: config.notifications_enabled,
        notification_sound: config.notification_sound,
        notification_sound_file: config.notification_sound_file,
        language: config.language,
        workspace_label: valid_workspace_label(config.workspace_label)
          ? config.workspace_label
          : current_identity.label,
      },
    });
    const next_client = new IpcClient({
      pipe_path: `\\\\.\\pipe\\${pipe_name}`,
      make_message,
      start_tray,
      on_message: (message) => {
        if (message.type === 'association') next_provider.set_ambiguous(message.ambiguous);
        if (message.type === 'configure' || message.type === 'configure_settings') {
          void (async () => {
            let success = false;
            if (!writing_configuration && current_generation === generation) {
              writing_configuration = true;
              try {
                const has_workspace = Boolean(vscode.workspace.workspaceFolders?.length);
                const store = vscode.workspace.getConfiguration('codex_status');
                const target = (scope: 'workspace' | 'global') =>
                  scope === 'workspace'
                    ? vscode.ConfigurationTarget.Workspace
                    : vscode.ConfigurationTarget.Global;
                success =
                  message.type === 'configure_settings'
                    ? await apply_settings_changes(
                        message.changes,
                        has_workspace,
                        (key, scope) => {
                          const stored = store.inspect<number | string | boolean>(key);
                          return scope === 'workspace'
                            ? stored?.workspaceValue
                            : stored?.globalValue;
                        },
                        (key, value, scope) => store.update(key, value, target(scope)),
                      )
                    : await apply_timing_setting(
                        message.key,
                        message.value,
                        has_workspace,
                        (key, value, scope) =>
                          vscode.workspace
                            .getConfiguration('codex_status')
                            .update(
                              key,
                              value,
                              scope === 'workspace'
                                ? vscode.ConfigurationTarget.Workspace
                                : vscode.ConfigurationTarget.Global,
                            ),
                      );
              } catch {
                success = false;
              } finally {
                writing_configuration = false;
              }
            }
            next_client.send({
              version: 1,
              type: 'configuration_result',
              request_id: message.request_id,
              workspace_id: identity_id,
              success,
            });
            // Send the acknowledgement before replacing this transport/provider.
            if (configuration_changed) {
              configuration_changed = false;
              void configure();
            }
          })();
        }
        if (message.type === 'focus') {
          void (async () => {
            // Verified in VS Code 1.139.1: this command focuses this existing window.
            // Probe availability instead of assuming an undocumented ID survives updates.
            try {
              if (
                !vscode.window.state.focused &&
                (await vscode.commands.getCommands(true)).includes('workbench.action.focusWindow')
              )
                await vscode.commands.executeCommand('workbench.action.focusWindow');
            } catch {
              /* report the actual focus state below */
            }
            if (!vscode.window.state.focused)
              await new Promise<void>((resolve) => {
                const subscription = vscode.window.onDidChangeWindowState((state) => {
                  if (state.focused) {
                    clearTimeout(timer);
                    subscription.dispose();
                    resolve();
                  }
                });
                const timer = setTimeout(() => {
                  subscription.dispose();
                  resolve();
                }, 750);
              });
            next_client.send({
              version: 1,
              type: 'focus_result',
              request_id: message.request_id,
              workspace_id: identity_id,
              focused: vscode.window.state.focused,
            });
          })();
        }
        if (message.type === 'welcome') {
          if (message.language && message.language !== language) {
            language = message.language;
            current_identity = identity();
            next_client.send_update();
          }
          logger.write('ipc_connected', { workspace_id: identity_id });
        }
        if (message.type === 'diagnostics') {
          tray_diagnostics = message;
          focus_waiters.get(message.request_id)?.(message);
        }
        if (message.type === 'shutdown') logger.write('ipc_shutdown', { reason: message.reason });
      },
    });
    client = next_client;
    snapshot = unknown_snapshot(
      is_remote || vscode.extensions.getExtension('openai.chatgpt')
        ? 'no_matching_session'
        : 'codex_extension_absent',
    );
    next_client.start();
    await next_provider.start((next_snapshot) => {
      if (current_generation !== generation) return;
      snapshot =
        is_remote || vscode.extensions.getExtension('openai.chatgpt')
          ? next_snapshot
          : unknown_snapshot('codex_extension_absent');
      logger.write('state_changed', { workspace_id: identity_id, ...snapshot });
      next_client.send_update();
    });
    if (current_generation !== generation) next_provider.stop();
  };
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      pinned_session = undefined;
      void configure();
    }),
  );
  context.subscriptions.push(
    vscode.extensions.onDidChange(() => {
      void configure();
    }),
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('codex_status')) return;
      if (writing_configuration) configuration_changed = true;
      else void configure();
    }),
  );
  context.subscriptions.push(vscode.window.onDidChangeWindowState(() => client?.send_update()));
  context.subscriptions.push(
    vscode.commands.registerCommand('codex_status.restart_tray', () => {
      client?.send({
        version: 1,
        type: 'restart_tray',
        workspace_id: identity_id,
        request_id: random_uuid(),
      });
      client?.restart();
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('codex_status.diagnostics', async () => {
      const current_tray = await query_tray('diagnostics');
      const diagnostics = {
        extension_version: String(context.extension.packageJSON.version),
        workspace: current_identity,
        snapshot,
        pinned_session: pinned_session ?? null,
        tray: current_tray ?? null,
        freshness_minutes: read_config((key) =>
          vscode.workspace.getConfiguration('codex_status').get(key),
        ).stale_working_minutes,
        provider: snapshot.provider,
        location: vscode.env.remoteName ?? 'local',
        remote: provider instanceof RemoteStateProvider ? provider.diagnostics() : undefined,
        quota:
          provider instanceof AccountQuotaStateProvider ? provider.quota_diagnostics() : undefined,
        limitation: text('extension.limitation'),
      };
      output.appendLine(JSON.stringify(diagnostics));
      output.show(true);
      return diagnostics;
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('codex_status.pin_session', async () => {
      const selected = await vscode.window.showQuickPick(
        [
          { label: text('extension.auto_association'), session_id: undefined },
          ...(provider?.sessions() ?? []).map((session) => ({
            label: session.session_id,
            description: session.cli_version,
            session_id: session.session_id,
          })),
        ],
        { title: text('extension.pin_title') },
      );
      if (!selected) return;
      pinned_session = selected.session_id;
      provider?.pin_session(pinned_session);
      client?.send_update();
    }),
  );
  context.subscriptions.push({ dispose: teardown });
  await configure();
  return {
    request_focus: () => query_tray('request_focus'),
    get_tray_status: () => tray_diagnostics,
  };
}
export function deactivate(): void {
  stop_active?.();
}
