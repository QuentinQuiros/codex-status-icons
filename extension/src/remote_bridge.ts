import * as vscode from 'vscode';
import path from 'node:path';
import { remote_snapshot_command, type RemoteRequest } from './codex/remote_state_provider';
import { create_versioned_remote_fetch } from './codex/remote_bridge_transport';

export function create_remote_fetch(
  context: vscode.ExtensionContext,
): (request: RemoteRequest) => Promise<unknown> {
  return create_versioned_remote_fetch({
    // Appearance-only UI releases can reuse the already installed remote reader.
    version: String(
      context.extension.packageJSON.codexStatusRemoteVersion ??
        context.extension.packageJSON.version,
    ),
    query: (request) =>
      Promise.resolve(vscode.commands.executeCommand(remote_snapshot_command, request)),
    install: async () => {
      // VS Code selects the SSH extension host for the bundled workspace component.
      const commands = await vscode.commands.getCommands(true);
      if (!commands.includes('workbench.extensions.installExtension'))
        throw new Error('remote_install_command_unavailable');
      await vscode.commands.executeCommand(
        'workbench.extensions.installExtension',
        vscode.Uri.file(path.join(context.extensionPath, 'remote', 'codex-status-remote.vsix')),
      );
    },
  });
}
