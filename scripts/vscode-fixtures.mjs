import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { createVSIX } from '@vscode/vsce';
const root = path.resolve('.local/vscode-test');
const version = JSON.parse(await fs.readFile('extension/package.json', 'utf8')).version;
await fs.mkdir(root, { recursive: true });
try { await fs.unlink(path.join(root, 'stop')); } catch {}
const code_root = process.env.CODEX_STATUS_CODE_ROOT || path.join(process.env.LOCALAPPDATA, 'Programs/Microsoft VS Code');
const code_exe = path.join(code_root, 'Code.exe');
const entries = await fs.readdir(code_root, { withFileTypes: true });
let cli_path;
try { const direct = path.join(code_root, 'resources/app/out/cli.js'); await fs.access(direct); cli_path = direct; } catch {}
for (const entry of entries.filter(entry => entry.isDirectory())) { const candidate = path.join(code_root, entry.name, 'resources/app/out/cli.js'); try { await fs.access(candidate); cli_path = candidate; break; } catch {} }
if (!cli_path) throw new Error('VS Code CLI not found');
const user_data = path.join(root, 'user'); const extensions = path.join(root, 'extensions');
await fs.mkdir(path.join(user_data, 'User'), { recursive: true }); await fs.mkdir(extensions, { recursive: true });
await fs.mkdir(path.join(root, 'sessions'), { recursive: true }); await fs.mkdir(path.join(root, 'status'), { recursive: true });
for (const name of ['Pascale', 'Admin', 'ENT']) { for (const filename of [path.join(root, 'status', name + '.json'), path.join(root, 'status', name + '-focus.json'), path.join(root, 'action-' + name + '.json')]) { try { await fs.unlink(filename); } catch {} } }
const harness_path = path.join(extensions, 'test.codex-status-test-harness-0.0.1');
await fs.mkdir(harness_path, { recursive: true });
await fs.copyFile('scripts/vscode-harness/package.json', path.join(harness_path, 'package.json'));
await fs.copyFile('scripts/vscode-test-runner.cjs', path.join(harness_path, 'runner.cjs'));
await fs.writeFile(path.join(harness_path, 'index.cjs'), "exports.activate = () => { require('./runner.cjs').run().catch(error => console.error('fixture_runner_failed', error.message)); }; exports.deactivate = () => {};\n");
await fs.copyFile('LICENSE', path.join(harness_path, 'LICENSE'));
await fs.writeFile(path.join(harness_path, 'README.md'), '# Isolated Codex Status test harness\nSynthetic sessions only.');
await createVSIX({ cwd: harness_path, packagePath: path.join(root, 'harness.vsix'), dependencies: false, allowMissingRepository: true, rewriteRelativeLinks: false });
await fs.writeFile(path.join(user_data, 'User/settings.json'), JSON.stringify({ 'codex_status.sessions_directory': path.join(root, 'sessions'), 'codex_status.log_level': 'off', 'workbench.startupEditor': 'none', 'security.workspace.trust.enabled': false, 'telemetry.telemetryLevel': 'off', 'update.mode': 'none', 'extensions.autoUpdate': false, 'chatgpt.openOnStartup': false }, null, 2));
const official_root = path.join(process.env.USERPROFILE, '.vscode/extensions');
const official = (await fs.readdir(official_root)).find(name => name.startsWith('openai.chatgpt-') && name.includes('win32-x64'));
if (!official) throw new Error('Official Codex extension not found');
try { await fs.symlink(path.join(official_root, official), path.join(extensions, official), 'junction'); } catch (error) { if (error.code !== 'EEXIST') throw error; }
const common = ['--user-data-dir', user_data, '--extensions-dir', extensions];
const installed = spawnSync(code_exe, [cli_path, ...common, '--install-extension', path.resolve(`dist/codex-status-${version}.vsix`), '--force'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', windowsHide: true, timeout: 60000 });
console.log(installed.stdout); if (installed.status !== 0) throw new Error(installed.stderr || 'VSIX install failed');
const harness_install = spawnSync(code_exe, [cli_path, ...common, '--install-extension', path.join(root, 'harness.vsix'), '--force'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', windowsHide: true, timeout: 60000 });
if (harness_install.status !== 0) throw new Error(harness_install.stderr || 'Harness install failed');
for (const [name, event] of [['Pascale', 'task_complete'], ['Admin', 'task_started'], ['ENT', 'task_complete']]) {
  const cwd = path.join(root, 'workspaces', name); await fs.mkdir(cwd, { recursive: true });
  const record = (type, payload) => JSON.stringify({ timestamp: new Date().toISOString(), type, payload }) + '\n';
  await fs.writeFile(path.join(root, 'sessions', name + '.jsonl'), record('session_meta', { id: name, cwd, source: 'vscode', originator: 'codex_vscode', cli_version: 'test_fixture' }) + record('event_msg', { type: event }));
  await fs.writeFile(path.join(cwd, 'README.txt'), 'Workspace de validation Codex Status. Aucun prompt envoyé.');
  const app_env = { ...process.env, CODEX_STATUS_TEST_ROOT: root }; delete app_env.ELECTRON_RUN_AS_NODE; delete app_env.VSCODE_IPC_HOOK_CLI;
  const child = spawn(code_exe, [...common, '--new-window', cwd], { env: app_env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false, detached: true });
  child.stdout.on('data', chunk => console.log('Code launch:', chunk.toString())); child.stderr.on('data', chunk => console.log('Code error:', chunk.toString())); child.on('exit', status => console.log('Code launcher exit:', name, status)); child.unref();
  const deadline = Date.now() + 45000;
  while (true) { try { await fs.access(path.join(root, 'status', name + '.json')); break; } catch {} if (Date.now() > deadline) throw new Error('VS Code window startup timed out: ' + name); await new Promise(resolve => setTimeout(resolve, 250)); }
}
console.log('Three isolated VS Code test windows launched. Safe metadata: ' + path.join(root, 'status'));
if (process.argv.includes('--hold')) {
  while (true) { try { await fs.access(path.join(root, 'stop')); break; } catch {} await new Promise(resolve => setTimeout(resolve, 1000)); }
}
