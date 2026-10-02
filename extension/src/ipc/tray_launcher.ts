import { createReadStream as create_read_stream } from 'node:fs';
import {
  mkdir,
  copyFile as copy_file,
  readFile as read_file,
  writeFile as write_file,
  open,
  stat,
  rename,
  unlink,
} from 'node:fs/promises';
import { createHash as create_hash, randomUUID as random_uuid } from 'node:crypto';
import path from 'node:path';
async function file_hash(filename: string): Promise<string> {
  const hash = create_hash('sha256');
  for await (const chunk of create_read_stream(filename)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}
interface InstalledBinary {
  version: string;
  digest: string;
}
function version_parts(version: string): number[] {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('invalid_tray_version');
  return version.split('.').map(Number);
}
function newer_version(installed: string, requested: string): boolean {
  const first = version_parts(installed);
  const second = version_parts(requested);
  for (let index = 0; index < 3; index++) {
    if (first[index] !== second[index]) return first[index]! > second[index]!;
  }
  return false;
}
async function acquire_lock(filename: string): Promise<() => Promise<void>> {
  const deadline = Date.now() + 10000;
  while (true) {
    try {
      const handle = await open(filename, 'wx');
      try {
        await handle.writeFile(String(process.pid));
      } catch (error) {
        await handle.close();
        await unlink(filename).catch(() => undefined);
        throw error;
      }
      await handle.close();
      return () => unlink(filename);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    try {
      const owner = Number(await read_file(filename, 'utf8'));
      let abandoned = false;
      if (Number.isInteger(owner) && owner > 0) {
        try {
          process.kill(owner, 0);
        } catch (error) {
          abandoned = (error as NodeJS.ErrnoException).code === 'ESRCH';
        }
      } else abandoned = Date.now() - (await stat(filename)).mtimeMs > 60000;
      if (abandoned) {
        await unlink(filename).catch(() => undefined);
        continue;
      }
    } catch {
      // The other updater may have released its lock between two reads.
    }
    if (Date.now() >= deadline) throw new Error('tray_update_busy');
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}
// The filename and directory must remain stable: Windows stores icon preferences
// against the executable path. A running Windows executable cannot be replaced;
// leave it intact and retry after the companion has exited, without a new path.
export async function prepare_tray(
  source_path: string,
  cache_root: string,
  version = '0.0.0',
): Promise<string> {
  version_parts(version);
  const directory = path.join(cache_root, 'stable');
  const cached_path = path.join(directory, 'Codex Status Icons.exe');
  const manifest_path = path.join(directory, 'installed.json');
  await mkdir(directory, { recursive: true });
  const release = await acquire_lock(path.join(directory, 'update.lock'));
  const temporary_path = path.join(directory, random_uuid() + '.tmp');
  const temporary_manifest = temporary_path + '.json';
  try {
    const digest = await file_hash(source_path);
    try {
      const installed: InstalledBinary = JSON.parse(await read_file(manifest_path, 'utf8'));
      const existing_digest = await file_hash(cached_path);
      if (
        existing_digest === installed.digest &&
        (existing_digest === digest || newer_version(installed.version, version))
      )
        return cached_path;
    } catch {
      // Missing or corrupt cache/metadata: rebuild it from the verified source.
    }
    await copy_file(source_path, temporary_path);
    if ((await file_hash(temporary_path)) !== digest) throw new Error('binary_changed_during_copy');
    await write_file(temporary_manifest, JSON.stringify({ version, digest }));
    await rename(temporary_path, cached_path);
    await rename(temporary_manifest, manifest_path);
    return cached_path;
  } finally {
    await unlink(temporary_path).catch(() => undefined);
    await unlink(temporary_manifest).catch(() => undefined);
    await release();
  }
}
