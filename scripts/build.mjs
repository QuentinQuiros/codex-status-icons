import { spawnSync } from 'node:child_process';
import { run_dotnet } from './dotnet.mjs';
const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'extension'], { stdio: 'inherit' });
if (result.status) process.exit(result.status);
await import('./bundle.mjs');
run_dotnet(['build', 'tray/src/CodexStatusTray.csproj', '-c', 'Release']);
