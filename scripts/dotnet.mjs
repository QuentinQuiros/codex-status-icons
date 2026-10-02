import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const local_dotnet = path.join(process.env.LOCALAPPDATA || '', 'codex-status-build', 'dotnet', 'dotnet.exe');
export const dotnet_path = process.env.CODEX_STATUS_DOTNET || (fs.existsSync(local_dotnet) ? local_dotnet : 'dotnet');
export function run_dotnet(args) {
  const result = spawnSync(dotnet_path, args, { stdio: 'inherit', env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' } });
  if (result.status !== 0) throw new Error(`dotnet failed: ${result.error?.message || result.status}`);
}
if (process.argv[1]?.endsWith('dotnet.mjs')) run_dotnet(process.argv.slice(2));
