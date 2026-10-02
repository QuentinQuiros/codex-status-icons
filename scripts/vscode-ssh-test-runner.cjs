const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
exports.run = async function (vscode, context) {
  assert.equal(context.extensionMode, vscode.ExtensionMode.Development, 'development window required');
  const result_path = path.resolve(__dirname, '../.local/ssh-actual/results.json');
  const results = [];
  let fixture;
  let reloading = false;
  await fs.mkdir(path.dirname(result_path), { recursive: true });
  const save = async extra => fs.writeFile(result_path, JSON.stringify({ passed: results.length, results, ...extra }, null, 2));
  if (!vscode.env.remoteName) {
    await save({ stage: 'remote_window_required' });
    return;
  }
  const deadline = Date.now() + 90000;
  try {
    const extension = vscode.extensions.getExtension('local-codex-tools.codex-status');
    if (!extension) throw new Error('UI extension missing');
    await extension.activate();
    let diagnostics;
    while (true) {
      diagnostics = await vscode.commands.executeCommand('codex_status.diagnostics');
      await save({ stage: 'waiting_remote', diagnostics });
      if (diagnostics?.snapshot?.reason === 'remote_bridge_reload_required') {
        const marker = path.join(path.dirname(result_path), 'reload-' + vscode.workspace.workspaceFolders[0].uri.authority.replace(/[^a-zA-Z0-9_.-]/g, '_') + '-' + extension.packageJSON.version);
        let already_reloaded = false;
        try { await fs.access(marker); already_reloaded = true; } catch {}
        if (!already_reloaded) {
          await fs.writeFile(marker, 'development window only');
          reloading = true;
          await save({ stage: 'reloading_development_window_for_bridge_update' });
          await vscode.commands.executeCommand('workbench.action.reloadWindow');
          return;
        }
      }
      if (diagnostics?.remote?.platform === 'linux' && diagnostics?.tray?.icon_visible) break;
      if (Date.now() > deadline) throw new Error('remote bridge or icon unavailable');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert.ok(vscode.Uri.parse(diagnostics.workspace.workspace_path).authority.startsWith('ssh-remote+'));
    assert.equal(diagnostics.extension_version, extension.packageJSON.version);
    assert.equal(diagnostics.remote.bridge_version, extension.packageJSON.codexStatusRemoteVersion ?? extension.packageJSON.version);
    results.push('real SSH workspace reaches the Windows tray with a native icon');
    const focus = await extension.exports.request_focus();
    assert.equal(focus?.focus_succeeded, true);
    results.push('focus of the existing SSH Code window is confirmed');
    const roots = vscode.workspace.workspaceFolders.map(folder => folder.uri.path);
    const command = '_codex_status_remote.snapshot';
    await assert.rejects(() => vscode.commands.executeCommand(command, { version: 1, request_id: randomUUID(), roots: ['/WRONG_WORKSPACE'], sessions_directory: '', stale_minutes: 60 }));
    results.push('remote bridge rejects another workspace scope');
    fixture = vscode.workspace.workspaceFolders[0].uri.with({ path: '/tmp/codex-status-fixture-' + randomUUID() });
    await vscode.workspace.fs.createDirectory(fixture);
    const file = vscode.Uri.joinPath(fixture, 'session.jsonl');
    const line = (type, payload) => JSON.stringify({ timestamp: new Date().toISOString(), type, payload }) + '\n';
    let contents = line('session_meta', { id: 'ssh-fixture', cwd: roots[0], source: 'vscode', originator: 'codex_vscode', cli_version: 'test_fixture' }) + line('event_msg', { type: 'task_started' });
    await vscode.workspace.fs.writeFile(file, Buffer.from(contents));
    const query = () => vscode.commands.executeCommand(command, { version: 1, request_id: randomUUID(), roots, sessions_directory: fixture.path, stale_minutes: 60 });
    assert.equal((await query()).snapshot.state, 'working');
    contents += line('event_msg', { type: 'task_complete' }); await vscode.workspace.fs.writeFile(file, Buffer.from(contents));
    assert.equal((await query()).snapshot.state, 'idle');
    results.push('technical start and completion on the Linux host cross the VS Code command bridge');
    contents += line('event_msg', { type: 'error', codex_error_info: 'usage_limit_exceeded' }); await vscode.workspace.fs.writeFile(file, Buffer.from(contents));
    assert.equal((await query()).snapshot.state, 'rate_limited');
    results.push('structured quota fixture is recognized on the Linux host');
    await save({ stage: 'passed', diagnostics, note: 'Real SSH host and Code window; technical fixtures only, no Codex prompt submitted.' });
  } catch (error) {
    await save({ stage: 'failed', error: error.message });
    throw error;
  } finally {
    if (!reloading) {
    if (fixture) {
      await vscode.workspace.fs.delete(fixture, { recursive: true });
      await assert.rejects(() => vscode.workspace.fs.stat(fixture));
      if (results.length === 5) {
        const previous = JSON.parse(await fs.readFile(result_path, 'utf8'));
        await save({ ...previous, fixture_cleanup_verified: true });
      }
    }
    // Restore the real reader after the synthetic requests, then close only this development window.
    await vscode.commands.executeCommand('codex_status.diagnostics').catch(() => undefined);
    await new Promise(resolve => setTimeout(resolve, 2500));
    await vscode.commands.executeCommand('workbench.action.closeWindow');
    }
  }
};
