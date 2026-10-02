import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve('.local/vscode-test');
const results = [];
const status = async name => JSON.parse(await fs.readFile(path.join(root, 'status', name + '.json'), 'utf8'));
const wait_until = async (condition, ms = 15000) => { const end = Date.now() + ms; while (!(await condition())) { if (Date.now() > end) throw new Error('VS Code validation timeout'); await new Promise(resolve => setTimeout(resolve, 150)); } };
const action = async (name, type) => fs.writeFile(path.join(root, 'action-' + name + '.json'), JSON.stringify({ type }));
const check = async (name, run) => { await run(); results.push(name); console.log('PASS ' + name); };
const names = ['Pascale', 'Admin', 'ENT'];
await wait_until(async () => (await Promise.all(names.map(status))).every(snapshot => snapshot.tray?.connected_count === 3 && snapshot.tray.icon_visible) && (await status('Admin')).snapshot.state === 'working');
await check('VSIX installed and activated in three real VS Code windows', async () => {
  const snapshots = await Promise.all(names.map(status)); assert.equal(new Set(snapshots.map(snapshot => snapshot.workspace.workspace_id)).size, 3); assert.deepEqual(snapshots.map(snapshot => snapshot.snapshot.state), ['idle', 'working', 'idle']);
  for (const snapshot of snapshots) assert.ok(snapshot.extension_path.includes('extensions'));
});
await check('filesystem turn affects only Admin in real extension hosts', async () => {
  const event = { timestamp: new Date().toISOString(), type: 'event_msg', payload: { type: 'task_complete' } };
  await fs.appendFile(path.join(root, 'sessions/Admin.jsonl'), JSON.stringify(event) + '\n');
  await wait_until(async () => (await status('Admin')).snapshot.state === 'idle'); assert.deepEqual((await Promise.all(names.map(status))).map(snapshot => snapshot.snapshot.state), ['idle', 'idle', 'idle']);
});
await check('restart tray retains three clients and states', async () => {
  await action('Admin', 'restart_tray'); await new Promise(resolve => setTimeout(resolve, 2500));
  await wait_until(async () => (await Promise.all(names.map(status))).every(snapshot => snapshot.tray?.connected_count === 3 && snapshot.tray.icon_visible));
});
await check('native focus reaches the three existing Code windows', async () => {
  for (const name of names) {
    const focus_file = path.join(root, 'status', name + '-focus.json'); try { await fs.unlink(focus_file); } catch {}
    await action(name, 'request_focus'); await wait_until(async () => { try { await fs.access(focus_file); return true; } catch { return false; } });
    const snapshot = JSON.parse(await fs.readFile(focus_file, 'utf8')); assert.notEqual(snapshot.tray.window_handle, '0'); assert.equal(snapshot.tray.focus_succeeded, true); // Success now requires a correlated acknowledgement from vscode.window.state.focused.
  }
});
await check('extension reload replaces only its own window identity', async () => {
  const previous = await status('Admin'); const other_id = (await status('Pascale')).workspace.workspace_id;
  await action('Admin', 'reload'); await wait_until(async () => (await status('Admin')).workspace.workspace_id !== previous.workspace.workspace_id);
  await wait_until(async () => (await status('Admin')).tray?.connected_count === 3); assert.equal((await status('Pascale')).workspace.workspace_id, other_id);
});
await check('closing one Code window removes only its icon', async () => {
  await action('ENT', 'close'); await wait_until(async () => (await status('Admin')).tray?.connected_count === 2); assert.equal((await status('Pascale')).tray.icon_visible, true);
});
await fs.writeFile(path.join(root, 'results.json'), JSON.stringify({ passed: results.length, results, note: 'Real VS Code windows with synthetic technical session fixtures; no real Codex prompt submitted.' }, null, 2));
console.log(`PASS: ${results.length} real VS Code host scenarios`);
