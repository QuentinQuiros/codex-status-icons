import { build } from 'esbuild';
await build({ entryPoints: ['extension/src/extension.ts'], bundle: true, platform: 'node', target: 'node20', external: ['vscode'], outfile: 'extension/out/extension.js', format: 'cjs' });
await build({ entryPoints: ['extension/src/remote_extension.ts'], bundle: true, platform: 'node', target: 'node20', external: ['vscode'], outfile: 'remote-extension/out/remote.js', format: 'cjs' });
