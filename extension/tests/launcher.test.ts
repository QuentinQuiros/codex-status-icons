import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile as write_file,
  readFile as read_file,
  readdir,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { prepare_tray } from '../src/ipc/tray_launcher';
test('concurrent launcher copies agree on a verified binary outside extension', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'codex-status-launch-'));
  const source = path.join(root, 'source.exe');
  try {
    await write_file(source, 'synthetic executable fixture');
    const [first, second] = await Promise.all([
      prepare_tray(source, path.join(root, 'cache')),
      prepare_tray(source, path.join(root, 'cache')),
    ]);
    assert.equal(first, second);
    assert.notEqual(first, source);
    assert.equal((await read_file(first)).toString(), 'synthetic executable fixture');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('a companion upgrade retains the executable path and its Windows-facing name', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'codex-status-launch-'));
  const source = path.join(root, 'source.exe');
  try {
    await write_file(source, 'version1');
    const first = await prepare_tray(source, path.join(root, 'cache'), '0.6.3');
    await write_file(source, 'version2');
    const second = await prepare_tray(source, path.join(root, 'cache'), '0.6.4');
    assert.equal(first, second);
    assert.equal(path.basename(second), 'Codex Status Icons.exe');
    assert.equal((await read_file(second)).toString(), 'version2');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('an older VS Code window cannot replace the installed newer companion', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'codex-status-launch-'));
  try {
    const newer = path.join(root, 'newer.exe');
    const older = path.join(root, 'older.exe');
    await write_file(newer, 'new companion');
    await write_file(older, 'old companion');
    const cache = path.join(root, 'cache');
    const filename = await prepare_tray(newer, cache, '0.6.10');
    await Promise.all(Array.from({ length: 4 }, () => prepare_tray(older, cache, '0.6.9')));
    assert.equal(await read_file(filename, 'utf8'), 'new companion');
    assert.equal(
      JSON.parse(await read_file(path.join(cache, 'stable', 'installed.json'), 'utf8')).version,
      '0.6.10',
    );
    assert.deepEqual((await readdir(path.dirname(filename))).sort(), [
      'Codex Status Icons.exe',
      'installed.json',
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('a damaged cache is repaired and a failed replacement leaves no update lock or staging file', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'codex-status-launch-'));
  try {
    const source = path.join(root, 'source.exe');
    const cache = path.join(root, 'cache');
    await write_file(source, 'verified fixture');
    const filename = await prepare_tray(source, cache, '0.6.3');
    await write_file(filename, 'damaged');
    await prepare_tray(source, cache, '0.6.3');
    assert.equal(await read_file(filename, 'utf8'), 'verified fixture');
    await rm(filename);
    await mkdir(filename);
    await assert.rejects(prepare_tray(source, cache, '0.6.4'));
    assert.deepEqual((await readdir(path.dirname(filename))).sort(), [
      'Codex Status Icons.exe',
      'installed.json',
    ]);
    assert.equal(
      JSON.parse(await read_file(path.join(cache, 'stable', 'installed.json'), 'utf8')).version,
      '0.6.3',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test(
  'a running Windows executable is left intact until it exits, then upgrades at the same path',
  { skip: process.platform !== 'win32' },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codex-status-locked-'));
    let child: ChildProcess | undefined;
    try {
      const cache = path.join(root, 'cache');
      const filename = await prepare_tray(process.execPath, cache, '0.6.3');
      child = spawn(
        filename,
        ['-e', "process.stdout.write('ready'); setTimeout(() => {}, 30000)"],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
      );
      await Promise.race([
        once(child.stdout!, 'data'),
        once(child, 'error').then(([error]) => {
          throw error;
        }),
      ]);
      const source = path.join(root, 'next.exe');
      await write_file(source, 'next companion fixture');
      await assert.rejects(prepare_tray(source, cache, '0.6.4'));
      assert.equal(
        JSON.parse(await read_file(path.join(cache, 'stable', 'installed.json'), 'utf8')).version,
        '0.6.3',
      );
      assert.deepEqual((await readdir(path.dirname(filename))).sort(), [
        'Codex Status Icons.exe',
        'installed.json',
      ]);
      const exited = once(child, 'exit');
      child.kill();
      await exited;
      assert.equal(await prepare_tray(source, cache, '0.6.4'), filename);
      assert.equal(await read_file(filename, 'utf8'), 'next companion fixture');
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        child.kill();
        await exited;
      }
      await rm(root, { recursive: true, force: true });
    }
  },
);
