import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = path.resolve('.local/vscode-test');
const version = JSON.parse(await fs.readFile('extension/package.json', 'utf8')).version;
const code_root = process.env.CODEX_STATUS_CODE_ROOT || path.resolve('.local/vscode-portable');
let cli_path = path.join(code_root, 'resources/app/out/cli.js');
try { await fs.access(cli_path); } catch {
  for (const entry of await fs.readdir(code_root, { withFileTypes: true })) { if (!entry.isDirectory()) continue; const candidate = path.join(code_root, entry.name, 'resources/app/out/cli.js'); try { await fs.access(candidate); cli_path = candidate; break; } catch {} }
}
const result = spawnSync(path.join(code_root, 'Code.exe'), [cli_path, '--user-data-dir', path.join(root, 'user'), '--extensions-dir', path.join(root, 'extensions'), '--install-extension', path.resolve(`dist/codex-status-${version}.vsix`), '--force'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, encoding: 'utf8', timeout: 60000 });
console.log(result.stdout); if (result.status !== 0) throw new Error(result.stderr || 'VSIX update failed');
await fs.copyFile('scripts/vscode-test-runner.cjs', path.join(root, 'extensions/test.codex-status-test-harness-0.0.1/runner.cjs'));
for (const name of ['Admin', 'Pascale', 'ENT']) await fs.writeFile(path.join(root, `action-${name}.json`), JSON.stringify({ type: 'reload' }));
