const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
exports.run = async function () {
  const root = process.env.CODEX_STATUS_TEST_ROOT;
  if (!root) throw new Error('Missing test root');
  const name = vscode.workspace.name;
  const extension = vscode.extensions.getExtension('local-codex-tools.codex-status');
  if (!extension) throw new Error('Packaged extension missing');
  await extension.activate();
  while (true) {
    try { await fs.access(path.join(root, 'stop')); await vscode.commands.executeCommand('workbench.action.closeWindow'); return; } catch {}
    const snapshot = await vscode.commands.executeCommand('codex_status.diagnostics');
    await fs.writeFile(path.join(root, 'status', name + '.json'), JSON.stringify({ ...snapshot, extension_path: extension.extensionPath, extension_host_pid: process.pid, window_focused: vscode.window.state.focused }, null, 2));
    try {
      const action_path = path.join(root, 'action-' + name + '.json');
      const action = JSON.parse(await fs.readFile(action_path, 'utf8')); await fs.unlink(action_path);
      if (action.type === 'restart_tray') await vscode.commands.executeCommand('codex_status.restart_tray');
      if (action.type === 'request_focus') {
        const focus_response = await extension.exports.request_focus();
        await fs.writeFile(path.join(root, 'status', name + '-focus.json'), JSON.stringify({ tray: focus_response ?? null, window_focused: vscode.window.state.focused }, null, 2));
      }
      if (action.type === 'reload') await vscode.commands.executeCommand('workbench.action.reloadWindow');
      if (action.type === 'close') await vscode.commands.executeCommand('workbench.action.closeWindow');
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
};
