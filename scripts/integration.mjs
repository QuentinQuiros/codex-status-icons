import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { IpcClient } = require('../extension/out/src/ipc/client.js');
const { create_workspace } = require('../extension/out/src/workspace.js');
const exe = path.resolve('extension/bin/win-x64/codex_status_tray.exe');
await fs.access(exe);
const expected_version = JSON.parse(await fs.readFile('extension/package.json', 'utf8')).version;
const pipe_name = `codex_status_test_${randomUUID().replaceAll('-', '')}`;
const pipe_path = `\\\\.\\pipe\\${pipe_name}`;
const test_arguments = ['--pipe', pipe_name, '--test-instance', '--appearance-file', path.resolve('.local', pipe_name + '-appearance.json')];
const processes = [];
const results = [];
let original_icon_guids;
const wait_until = async (condition, ms = 20000) => { const end = Date.now() + ms; while (!condition()) { if (Date.now() > end) throw new Error('integration timeout'); await new Promise(resolve => setTimeout(resolve, 40)); } };
const launch = async () => { const child = spawn(exe, [...test_arguments, '--exit-grace', '300'], { windowsHide: true, stdio: 'ignore' }); processes.push(child); child.on('error', () => {}); };
const clients = ['Pascale', 'Admin', 'ENT', 'WordPress'].map((name, index) => {
  const workspace = create_workspace(name, [`C:/CodexStatusFixture/${name}`]);
  let state = ['idle', 'working', 'unknown', 'rate_limited'][index];
  let settings = { exit_grace_seconds: 5, stale_working_minutes: 60, exit_when_no_windows: true, configuration_version: 7, language: 'auto', workspace_label: '', notifications_enabled: false, notification_sound: 'silent', notification_sound_file: '' };
  let quota;
  let provider = 'session'; let reason = 'integration_fixture';
  let server_pid;
  const pending = new Map();
  const client = new IpcClient({ pipe_path, heartbeat_ms: 500, reconnect_ms: 100, start_tray: launch, make_message: type => ({ version: 1, type, workspace, snapshot: { state, reason, provider, since: new Date().toISOString() }, timestamp: new Date().toISOString(), window_focused: false, show_working_duration: true, pinned_session: false, extension_version: expected_version, location: 'local', settings, quota }), on_message: message => {
    if (message.type === 'welcome') server_pid = message.server_pid;
    if (message.type === 'diagnostics') pending.get(message.request_id)?.(message);
  } });
  return { client, workspace, get server_pid() { return server_pid; }, set_quota(value) { quota = value; client.send_update(); }, configure(changes) { settings = { ...settings, ...changes }; if (Object.hasOwn(changes, 'workspace_label')) workspace.label = create_workspace(name, workspace.workspace_roots, changes.workspace_label, workspace.workspace_id).label; client.send_update(); }, update(next, next_provider = 'session', next_reason = 'integration_fixture') { state = next; provider = next_provider; reason = next_reason; client.send_update(); }, async query(type = 'diagnostics') {
    const request_id = randomUUID();
    return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(request_id); reject(new Error('query timeout')); }, 5000); pending.set(request_id, value => { clearTimeout(timer); pending.delete(request_id); resolve(value); }); client.send({ version: 1, type, workspace_id: workspace.workspace_id, request_id }); });
  } };
});
const check = async (name, run) => { await run(); results.push(name); console.log(`PASS ${name}`); };
try {
  await launch(); for (const fixture of clients) fixture.client.start();
  await wait_until(() => clients.every(client => client.server_pid));
  await check('four native independent NotifyIcons', async () => {
    const snapshots = await Promise.all(clients.map(client => client.query()));
    assert.deepEqual(snapshots.map(snapshot => snapshot.state), ['idle', 'working', 'unknown', 'rate_limited']);
    for (const snapshot of snapshots) { assert.equal(snapshot.connected_count, 4); assert.equal(snapshot.icon_visible, true); assert.equal(snapshot.icon_style, 'flat'); assert.equal(snapshot.icon_size, 'small'); assert.equal(snapshot.tray_version, expected_version); assert.equal(snapshot.exit_grace_seconds, 15); }
    original_icon_guids = snapshots.map(snapshot => snapshot.icon_guid);
    assert.equal(new Set(original_icon_guids).size, 4);
    assert.ok(original_icon_guids.every(guid => /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(guid)));
    assert.ok(snapshots.every(snapshot => snapshot.executable_path.toLowerCase() === exe.toLowerCase()));
  });
  await check('60 changes preserve other workspaces', async () => {
    for (let index = 0; index < 60; index++) clients[1].update(index % 2 ? 'idle' : 'working');
    const snapshots = await Promise.all(clients.map(client => client.query()));
    assert.deepEqual(snapshots.map(snapshot => snapshot.state), ['idle', 'idle', 'unknown', 'rate_limited']);
  });
  await check('account quota block and recovery cross IPC without affecting other workspaces', async () => {
    clients[0].update('rate_limited', 'app_server', 'account_workspace_member_credits_depleted');
    const blocked = await Promise.all(clients.map(client => client.query()));
    assert.deepEqual(blocked.map(snapshot => snapshot.state), ['rate_limited', 'idle', 'unknown', 'rate_limited']);
    assert.equal(blocked[0].icon_visible, true);
    clients[0].update('idle');
    assert.equal((await clients[0].query()).state, 'idle');
  });
  await check('quota tooltip percentages cross the packaged IPC and vanish for missing stale or unavailable data', async () => {
    const observation = { checked_at: new Date().toISOString(), windows: [{ remaining_percent: 72, window_minutes: 300, resets_at: Date.now() / 1000 + 3600 }, { remaining_percent: 84, window_minutes: 10080, resets_at: Date.now() / 1000 + 7200 }] };
    clients[0].set_quota(observation);
    const available = await clients[0].query();
    assert.ok(available.tooltip.split('\n').length === 3);
    assert.match(available.tooltip.split('\n').at(-1), /^\[5h : 72% \| 7[jd] : 84%\]$/);
    clients[0].set_quota({ ...observation, checked_at: new Date(Date.now() - 180000).toISOString() });
    assert.equal((await clients[0].query()).tooltip.split('\n').length, 2);
    clients[0].set_quota(observation); clients[0].update('unknown', 'none', 'remote_unavailable');
    assert.equal((await clients[0].query()).tooltip.split('\n').length, 2);
    clients[0].set_quota(undefined); clients[0].update('idle');
    assert.equal((await clients[0].query()).tooltip.split('\n').length, 2);
    assert.ok((await clients[1].query()).tooltip.split('\n').length === 2);
  });
  await check('bundled ChatGPT and Windows sound choices cross IPC without a custom file or changing icon identities', async () => {
    for (const mode of ['chatgpt', 'windows', 'silent']) {
      for (const fixture of clients) fixture.configure({ notification_sound: mode, notification_sound_file: '' });
      const snapshots = await Promise.all(clients.map(client => client.query()));
      assert.ok(snapshots.every(snapshot => snapshot.notification_sound === mode && snapshot.notifications_enabled === false));
      assert.deepEqual(snapshots.map(snapshot => snapshot.icon_guid), original_icon_guids);
    }
  });
  await check('legacy exit overrides are ignored while freshness changes apply live', async () => {
    for (const fixture of clients) fixture.configure({ exit_grace_seconds: 25 });
    clients[0].configure({ stale_working_minutes: 90 });
    const snapshots = await Promise.all(clients.map(client => client.query()));
    assert.ok(snapshots.every(snapshot => snapshot.exit_grace_seconds === 15));
    assert.deepEqual(snapshots.map(snapshot => snapshot.stale_working_minutes), [90, 60, 60, 60]);
    for (const fixture of clients) fixture.configure({ exit_grace_seconds: 5 });
  });
  await check('language switches all icons and auto restores the Windows display language', async () => {
    const automatic = (await clients[0].query()).language;
    assert.ok(automatic === 'fr' || automatic === 'en');
    for (const language of ['en', 'fr', 'auto']) {
      for (const fixture of clients) fixture.configure({ language });
      const snapshots = await Promise.all(clients.map(client => client.query()));
      assert.ok(snapshots.every(snapshot => snapshot.language === (language === 'auto' ? automatic : language)));
      assert.ok(snapshots.every(snapshot => snapshot.language_preference === language));
    }
  });
  await check('custom letters and grey explanations update without changing icon identity or other windows', async () => {
    clients[0].configure({ workspace_label: 'Q' });
    const custom = await Promise.all(clients.map(client => client.query()));
    assert.equal(custom[0].label, 'Q'); assert.equal(custom[0].icon_guid, original_icon_guids[0]);
    assert.deepEqual(custom.slice(1).map(snapshot => snapshot.label), ['A', 'E', 'W']);
    assert.ok(custom.every(snapshot => snapshot.extension_version === expected_version));
    clients[0].configure({ workspace_label: '' }); assert.equal((await clients[0].query()).label, 'P');
    clients[2].update('unknown', 'none', 'remote_unavailable');
    clients[2].configure({ language: 'en' });
    const disconnected = await clients[2].query(); assert.equal(disconnected.status_text, 'SSH connection unavailable'); assert.ok(disconnected.tooltip.includes('\nSSH connection unavailable'));
    clients[2].update('unknown', 'session', 'stale_session');
    const expired = await clients[2].query(); assert.equal(expired.status_text, 'Status expired'); assert.equal(expired.icon_guid, original_icon_guids[2]);
    clients[2].update('unknown'); for (const fixture of clients) fixture.configure({ language: 'auto' });
  });
  await check('removed intervention state is rejected without disturbing registered windows', async () => {
    await new Promise((resolve, reject) => {
      const socket = net.createConnection(pipe_path);
      const deadline = setTimeout(() => { socket.destroy(); reject(new Error('invalid state timeout')); }, 5000);
      socket.on('connect', () => socket.write(JSON.stringify({ version: 1, type: 'hello', workspace: create_workspace('Legacy', ['C:/CodexStatusFixture/Legacy']), snapshot: { state: 'waiting_for_user', reason: 'unsupported', provider: 'session' } }) + '\n'));
      socket.on('error', () => {}); socket.on('close', () => { clearTimeout(deadline); resolve(); });
    });
    assert.equal((await clients[0].query()).connected_count, 4);
  });
  await check('native completion and quota notifications submit once, stay scoped and obey the global switch', async () => {
    clients[0].workspace.workspace_name = 'Test notification : fin de tâche';
    clients[1].workspace.workspace_name = 'Test notification : quota épuisé';
    for (const fixture of clients) fixture.configure({ notifications_enabled: true });
    const baseline = await Promise.all(clients.map(client => client.query()));
    assert.ok(baseline.every(snapshot => snapshot.notifications_enabled && snapshot.notifications_sent === 0));
    assert.ok(baseline.every(snapshot => snapshot.notification_sound === 'silent'));
    clients[0].update('working', 'session', 'task_started');
    assert.equal((await clients[0].query()).state, 'working');
    clients[0].update('idle', 'session', 'task_complete');
    const completed = await clients[0].query();
    assert.equal(completed.notifications_sent, 1, 'Windows Shell did not accept the completion notification');
    clients[0].update('idle', 'session', 'task_complete');
    assert.equal((await clients[0].query()).notifications_sent, 1, 'duplicate completion notification');
    clients[1].update('working', 'session', 'task_started');
    assert.equal((await clients[1].query()).state, 'working');
    clients[1].update('rate_limited', 'app_server', 'account_rate_limit_reached');
    const blocked = await Promise.all(clients.map(client => client.query()));
    assert.deepEqual(blocked.map(snapshot => snapshot.notifications_sent), [1, 1, 0, 0]);
    for (const fixture of clients) fixture.configure({ notifications_enabled: false });
    assert.ok((await clients[0].query()).notifications_enabled === false);
    clients[0].update('working', 'session', 'task_started');
    assert.equal((await clients[0].query()).state, 'working');
    clients[0].update('idle', 'session', 'task_complete');
    assert.equal((await clients[0].query()).notifications_sent, 1, 'disabled notifications still submitted');
    clients[1].update('idle');
    clients[0].workspace.workspace_name = 'Pascale'; clients[1].workspace.workspace_name = 'Admin';
  });
  await check('second packaged process exits as singleton', async () => {
    const second = spawnSync(exe, test_arguments, { windowsHide: true, timeout: 5000 }); assert.equal(second.status, 0); assert.equal((await clients[0].query()).connected_count, 4);
  });
  await check('oversized malicious peer isolated', async () => {
    await new Promise((resolve, reject) => { const socket = net.createConnection(pipe_path); const deadline = setTimeout(() => { socket.destroy(); reject(new Error('bad peer timeout')); }, 5000); socket.on('connect', () => socket.write(Buffer.alloc(17000))); socket.on('error', () => {}); socket.on('close', () => { clearTimeout(deadline); resolve(); }); });
    assert.equal((await clients[0].query()).connected_count, 4);
  });
  await check('workspace disconnect removes its icon', async () => {
    clients[3].client.send({ version: 1, type: 'disconnect', workspace_id: clients[3].workspace.workspace_id }); clients[3].client.stop();
    await new Promise(resolve => setTimeout(resolve, 200)); assert.equal((await clients[0].query()).connected_count, 3);
  });
  await check('crash relaunch and reconnect restore independent states', async () => {
    await fs.mkdir('.local', { recursive: true });
    await fs.writeFile(test_arguments[4], JSON.stringify({ version: 1, style: 'rounded', size: 'large' }));
    const before = clients[0].server_pid; const process = processes.find(child => child.pid === before); assert.ok(process); process.kill();
    await wait_until(() => clients.slice(0, 3).every(client => client.server_pid && client.server_pid !== before));
    const restored = await Promise.all(clients.slice(0, 3).map(client => client.query()));
    assert.deepEqual(restored.map(snapshot => snapshot.state), ['idle', 'idle', 'unknown']);
    assert.deepEqual(restored.map(snapshot => snapshot.stale_working_minutes), [90, 60, 60]);
    assert.ok(restored.every(snapshot => snapshot.icon_style === 'rounded' && snapshot.icon_size === 'large'));
    assert.deepEqual(restored.map(snapshot => snapshot.icon_guid), original_icon_guids.slice(0, 3));
  });
  await check('requested tray restart reconnects all clients', async () => {
    const before = clients[0].server_pid; clients[0].client.send({ version: 1, type: 'restart_tray', workspace_id: clients[0].workspace.workspace_id, request_id: randomUUID() });
    await wait_until(() => clients.slice(0, 3).every(client => client.server_pid && client.server_pid !== before));
    const restored = await Promise.all(clients.slice(0, 3).map(client => client.query()));
    assert.ok(restored.every(snapshot => snapshot.connected_count === 3 && snapshot.icon_style === 'rounded' && snapshot.icon_size === 'large'));
    assert.deepEqual(restored.map(snapshot => snapshot.icon_guid), original_icon_guids.slice(0, 3));
  });
  await check('last disconnect exits after the fixed 15-second delay', async () => {
    const pid = clients[0].server_pid;
    const disconnected_at = Date.now();
    for (const fixture of clients) { fixture.client.send({ version: 1, type: 'disconnect', workspace_id: fixture.workspace.workspace_id }); fixture.client.stop(); }
    const process = processes.find(child => child.pid === pid); assert.ok(process); await wait_until(() => process.exitCode !== null, 20000);
    assert.ok(Date.now() - disconnected_at >= 15000, 'legacy five-second delay still used');
  });
  await fs.mkdir('.local', { recursive: true }); await fs.writeFile('.local/integration-results.json', JSON.stringify({ version: expected_version, passed: results.length, results }, null, 2));
  console.log(`PASS: ${results.length} packaged Windows integration tests`);
} finally { for (const fixture of clients) fixture.client.stop(); for (const child of processes) if (child.exitCode === null) child.kill(); await fs.unlink(test_arguments[4]).catch(() => {}); }
