import * as vscode from 'vscode';
import path from 'node:path';
import { homedir } from 'node:os';
import { SessionStateProvider } from './codex/session_state_provider';
import {
  remote_snapshot_command,
  type RemoteRequest,
  type RemoteReply,
} from './codex/remote_state_provider';
import { unknown_snapshot, type StateSnapshot } from './state';
import { is_record } from './ipc/protocol';
import type { CodexStateProvider } from './codex/codex_state_provider';
import { with_account_quota } from './codex/vscode_quota_provider';
import { AccountQuotaStateProvider } from './codex/account_quota_provider';

export function activate(context: vscode.ExtensionContext): void {
  let provider: CodexStateProvider | undefined;
  let signature = '';
  let snapshot: StateSnapshot = unknown_snapshot('remote_initializing');
  let generation = 0;
  let current_directory = '';
  const stop = (): void => {
    generation++;
    provider?.stop();
    provider = undefined;
    signature = '';
  };
  const run_snapshot = async (raw: unknown): Promise<RemoteReply> => {
    if (
      !is_record(raw) ||
      raw.version !== 1 ||
      typeof raw.request_id !== 'string' ||
      raw.request_id.length > 100
    )
      throw new Error('invalid_request');
    const folders = vscode.workspace.workspaceFolders ?? [];
    const roots = folders.map((folder) => folder.uri.path);
    if (!Array.isArray(raw.roots) || JSON.stringify(raw.roots) !== JSON.stringify(roots))
      throw new Error('remote_workspace_mismatch');
    if (typeof raw.sessions_directory !== 'string' || raw.sessions_directory.length > 2048)
      throw new Error('invalid_directory');
    if (typeof raw.stale_minutes !== 'number' || raw.stale_minutes < 5 || raw.stale_minutes > 1440)
      throw new Error('invalid_freshness');
    if (
      raw.pinned_session !== undefined &&
      (typeof raw.pinned_session !== 'string' || raw.pinned_session.length > 100)
    )
      throw new Error('invalid_pin');
    const request = raw as unknown as RemoteRequest;
    if (!vscode.workspace.isTrusted) throw new Error('workspace_untrusted');
    const directory =
      request.sessions_directory ||
      path.join(process.env.CODEX_HOME || path.join(homedir(), '.codex'), 'sessions');
    const next_signature = JSON.stringify([roots, directory, request.stale_minutes]);
    if (!provider || next_signature !== signature) {
      stop();
      signature = next_signature;
      snapshot = unknown_snapshot('remote_initializing');
      current_directory = directory;
      const active_generation = generation;
      provider = with_account_quota(
        new SessionStateProvider(
          directory,
          folders.map((folder) => folder.uri.fsPath),
          request.stale_minutes,
          process.platform === 'win32' ? 'windows' : 'posix',
        ),
        directory,
      );
      await provider.start((next_snapshot) => {
        if (generation === active_generation) snapshot = next_snapshot;
      });
    }
    provider.pin_session(request.pinned_session);
    await provider.scan?.();
    return {
      version: 1,
      bridge_version: String(context.extension.packageJSON.version),
      request_id: request.request_id,
      roots,
      snapshot: vscode.extensions.getExtension('openai.chatgpt')
        ? snapshot
        : unknown_snapshot('remote_codex_extension_absent'),
      sessions: [...provider.sessions()],
      sessions_directory: current_directory,
      platform: process.platform,
      ...(provider instanceof AccountQuotaStateProvider
        ? { quota: provider.quota_diagnostics() }
        : {}),
    };
  };
  // Serialize requests: two callers/configuration changes must not replace each other's reader.
  let queue: Promise<unknown> = Promise.resolve();
  context.subscriptions.push(
    vscode.commands.registerCommand(remote_snapshot_command, (raw: unknown) => {
      const next = queue.catch(() => undefined).then(() => run_snapshot(raw));
      queue = next;
      return next;
    }),
  );
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(stop));
  context.subscriptions.push({ dispose: stop });
}
