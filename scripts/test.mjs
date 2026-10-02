import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { run_dotnet } from './dotnet.mjs';
function run_node(args) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
run_node(['node_modules/typescript/bin/tsc', '-p', 'extension']);
// Discover emitted tests only after compilation, including on a clean checkout.
run_node(['--test', ...readdirSync('extension/out/tests').filter(name => name.endsWith('.test.js')).map(name => 'extension/out/tests/' + name)]);
run_dotnet(['run', '--project', 'tray/tests/CodexStatusTray.Tests.csproj', '-c', 'Release']);
