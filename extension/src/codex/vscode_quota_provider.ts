import * as vscode from 'vscode';
import path from 'node:path';
import { homedir } from 'node:os';
import { AccountQuotaStateProvider } from './account_quota_provider';
import { read_account_quota } from './account_quota';
import type { CodexStateProvider } from './codex_state_provider';

export function with_account_quota(
  session: CodexStateProvider,
  sessions_directory: string,
): CodexStateProvider {
  const default_directory = path.join(
    process.env.CODEX_HOME || path.join(homedir(), '.codex'),
    'sessions',
  );
  const extension = vscode.extensions.getExtension('openai.chatgpt');
  // A custom session store can belong to a different login. Never apply the
  // current account's quota to that store or to another SSH host.
  if (!extension || path.resolve(sessions_directory) !== path.resolve(default_directory))
    return session;
  const platform =
    process.platform === 'win32' ? 'windows' : process.platform === 'linux' ? 'linux' : undefined;
  const arch = process.arch === 'x64' ? 'x86_64' : process.arch === 'arm64' ? 'aarch64' : undefined;
  if (!platform || !arch) return session;
  const configuration = vscode.workspace.getConfiguration('chatgpt');
  if (
    process.platform === 'win32' &&
    configuration.get('runCodexInWindowsSubsystemForLinux') === true
  )
    return session;
  const configured = configuration.get<unknown>('cliExecutable');
  const executable =
    typeof configured === 'string' && path.isAbsolute(configured)
      ? configured
      : path.join(
          extension.extensionPath,
          'bin',
          `${platform}-${arch}`,
          process.platform === 'win32' ? 'codex.exe' : 'codex',
        );
  return new AccountQuotaStateProvider(session, (signal) =>
    read_account_quota(
      executable,
      signal,
      12000,
      ['app-server'],
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    ),
  );
}
