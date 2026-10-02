import { watch, type FSWatcher } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { aggregate_states, unknown_snapshot, type StateSnapshot } from '../state';
import { normalize_session_path } from '../workspace';
import type { CodexStateProvider } from './codex_state_provider';
import { adapt_session_line, type SessionMetadata } from './codex_session_adapter';

interface FileCursor {
  offset: number;
  pending: Buffer;
  skip_line: boolean;
  metadata?: SessionMetadata;
  snapshot: StateSnapshot;
  last_activity?: number;
  modified: number;
}
const max_line_bytes = 1024 * 1024;
const bootstrap_tail_bytes = 512 * 1024;
export class SessionStateProvider implements CodexStateProvider {
  private readonly cursors = new Map<string, FileCursor>();
  private watcher: FSWatcher | undefined;
  private timer: NodeJS.Timeout | undefined;
  private debounce: NodeJS.Timeout | undefined;
  private on_change: ((snapshot: StateSnapshot) => void) | undefined;
  private stopped = true;
  private scanning = false;
  private rescan_needed = false;
  private readonly scan_waiters: (() => void)[] = [];
  private ambiguous = false;
  private pinned_session: string | undefined;
  private last_snapshot = '';
  constructor(
    private readonly sessions_directory: string,
    private readonly roots: readonly string[],
    private readonly stale_minutes = 60,
    private readonly path_flavor: 'windows' | 'posix' = 'windows',
  ) {}
  async start(on_change: (snapshot: StateSnapshot) => void): Promise<void> {
    this.on_change = on_change;
    this.stopped = false;
    await this.scan();
    this.timer = setInterval(() => {
      void this.scan();
    }, 30000);
    this.ensure_watcher();
  }
  private ensure_watcher(): void {
    if (this.watcher || this.stopped) return;
    try {
      this.watcher = watch(this.sessions_directory, { recursive: true }, () => {
        if (this.debounce) clearTimeout(this.debounce);
        this.debounce = setTimeout(() => {
          void this.scan();
        }, 180);
      });
      this.watcher.on('error', () => {
        this.watcher?.close();
        this.watcher = undefined;
      });
    } catch {
      /* sessions directory can appear later */
    }
  }
  stop(): void {
    this.stopped = true;
    this.watcher?.close();
    this.watcher = undefined;
    if (this.timer) clearInterval(this.timer);
    if (this.debounce) clearTimeout(this.debounce);
    this.cursors.clear();
  }
  set_ambiguous(ambiguous: boolean): void {
    this.ambiguous = ambiguous;
    this.publish();
  }
  pin_session(session_id: string | undefined): void {
    const changed = this.pinned_session !== session_id;
    this.pinned_session = session_id;
    if (changed) {
      for (const cursor of this.cursors.values()) {
        cursor.offset = 0;
        cursor.modified = 0;
        cursor.pending = Buffer.alloc(0);
        cursor.skip_line = false;
      }
      void this.scan();
    }
    this.publish();
  }
  sessions(): readonly { session_id: string; cli_version: string }[] {
    return [...this.cursors.values()].flatMap((cursor) =>
      cursor.metadata?.eligible
        ? [{ session_id: cursor.metadata.session_id, cli_version: cursor.metadata.cli_version }]
        : [],
    );
  }
  async scan(): Promise<void> {
    if (this.stopped) return;
    if (this.scanning) {
      this.rescan_needed = true;
      return new Promise<void>((resolve) => {
        this.scan_waiters.push(resolve);
      });
    }
    this.scanning = true;
    try {
      const files: { filename: string; modified: number }[] = [];
      const walk = async (directory: string, depth = 0): Promise<void> => {
        if (depth > 5) return;
        const entries = await readdir(directory, { withFileTypes: true });
        for (const entry of entries) {
          const filename = path.join(directory, entry.name);
          if (entry.isDirectory()) await walk(filename, depth + 1);
          else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
            try {
              files.push({ filename, modified: (await stat(filename)).mtimeMs });
            } catch {
              /* file vanished */
            }
          }
        }
      };
      try {
        await walk(this.sessions_directory);
      } catch {
        this.cursors.clear();
      }
      files.sort((left, right) => right.modified - left.modified);
      const selected = files.slice(0, 200);
      const selected_names = new Set(selected.map((file) => file.filename));
      for (const filename of this.cursors.keys())
        if (!selected_names.has(filename)) this.cursors.delete(filename);
      for (const file of selected) {
        try {
          await this.read_file(file.filename, file.modified);
        } catch {
          this.cursors.delete(file.filename);
        }
      }
      if (!this.stopped) {
        this.ensure_watcher();
        this.publish();
      }
    } finally {
      this.scanning = false;
      if (this.rescan_needed && !this.stopped) {
        this.rescan_needed = false;
        await this.scan();
      }
      for (const resolve of this.scan_waiters.splice(0)) resolve();
    }
  }
  private consume(cursor: FileCursor, chunk: Buffer): void {
    let start = 0;
    for (let end = chunk.indexOf(10); end >= 0; end = chunk.indexOf(10, start)) {
      const segment = chunk.subarray(start, end);
      if (!cursor.skip_line && cursor.pending.length + segment.length <= max_line_bytes) {
        const record = adapt_session_line(
          Buffer.concat([cursor.pending, segment]).toString('utf8'),
        );
        if (record && 'metadata' in record && !cursor.metadata) cursor.metadata = record.metadata;
        if (record && 'event' in record && cursor.metadata?.eligible) {
          const previous = cursor.snapshot;
          // A task_complete after a structured error must not erase the confirmed block.
          if (!(previous.state === 'rate_limited' && record.event.reason === 'task_complete')) {
            cursor.last_activity = Date.parse(record.event.since!);
            cursor.snapshot = {
              ...record.event,
              session_id: cursor.metadata.session_id,
              cli_version: cursor.metadata.cli_version,
            };
            if (previous.state === 'working' && record.event.state === 'working' && previous.since)
              cursor.snapshot.since = previous.since;
          }
        }
        if (
          record &&
          'activity' in record &&
          cursor.metadata?.eligible &&
          cursor.snapshot.state === 'working'
        )
          cursor.last_activity = Date.parse(record.activity);
      }
      cursor.pending = Buffer.alloc(0);
      cursor.skip_line = false;
      start = end + 1;
    }
    const remainder = chunk.subarray(start);
    if (cursor.pending.length + remainder.length > max_line_bytes) {
      cursor.skip_line = true;
      cursor.pending = Buffer.alloc(0);
    } else if (!cursor.skip_line) cursor.pending = Buffer.concat([cursor.pending, remainder]);
  }
  private async read_file(filename: string, modified: number): Promise<void> {
    let cursor = this.cursors.get(filename);
    const file = await open(filename, 'r');
    try {
      const size = (await file.stat()).size;
      // Rapid appends can retain the same filesystem timestamp. Skip only when
      // both the timestamp and the amount of data already consumed are unchanged.
      if (cursor?.modified === modified && cursor.offset === size) return;
      // Check the metadata header on each changed file: replacement can be larger
      // than the old file, so a length-only truncation check is insufficient.
      const pieces: Buffer[] = [];
      let header_size = 0;
      let first_end = -1;
      while (header_size < Math.min(max_line_bytes, size)) {
        const piece = Buffer.alloc(
          Math.min(4096, size - header_size, max_line_bytes - header_size),
        );
        const read = await file.read(piece, 0, piece.length, header_size);
        if (!read.bytesRead) break;
        const end = piece.subarray(0, read.bytesRead).indexOf(10);
        pieces.push(piece.subarray(0, end >= 0 ? end : read.bytesRead));
        if (end >= 0) {
          first_end = header_size + end;
          break;
        }
        header_size += read.bytesRead;
      }
      const first_record =
        first_end >= 0 ? adapt_session_line(Buffer.concat(pieces).toString('utf8')) : undefined;
      const header_metadata =
        first_record && 'metadata' in first_record ? first_record.metadata : undefined;
      if (
        !cursor ||
        size < cursor.offset ||
        (first_end >= 0 &&
          (header_metadata?.session_id !== cursor.metadata?.session_id ||
            header_metadata?.eligible !== cursor.metadata?.eligible ||
            header_metadata?.cwd !== cursor.metadata?.cwd))
      ) {
        cursor = {
          offset: 0,
          pending: Buffer.alloc(0),
          skip_line: false,
          snapshot: unknown_snapshot('no_turn_event'),
          modified: 0,
        };
        this.cursors.set(filename, cursor);
        if (header_metadata) {
          cursor.metadata = header_metadata;
          cursor.offset = first_end + 1;
        }
        if (size > bootstrap_tail_bytes) {
          cursor.offset = size - bootstrap_tail_bytes;
          cursor.pending = Buffer.alloc(0);
          cursor.skip_line = true;
        }
      }
      // Once a session is excluded, never read its conversation tail.
      const metadata = cursor.metadata;
      const relevant =
        metadata?.eligible &&
        (this.pinned_session
          ? metadata.session_id === this.pinned_session
          : this.roots.some(
              (root) =>
                normalize_session_path(root, this.path_flavor) ===
                normalize_session_path(metadata.cwd, this.path_flavor),
            ));
      if (cursor.metadata && !relevant) {
        cursor.offset = size;
        cursor.modified = modified;
        cursor.pending = Buffer.alloc(0);
        cursor.snapshot = unknown_snapshot('session_not_associated');
        return;
      }
      const chunk = Buffer.alloc(65536);
      // Bound catch-up work per scan; huge growing files must not starve other workspaces.
      const read_until = Math.min(size, cursor.offset + 4 * 1024 * 1024);
      while (!this.stopped && cursor.offset < read_until) {
        const read = await file.read(
          chunk,
          0,
          Math.min(chunk.length, read_until - cursor.offset),
          cursor.offset,
        );
        if (!read.bytesRead) break;
        this.consume(cursor, chunk.subarray(0, read.bytesRead));
        cursor.offset += read.bytesRead;
      }
      cursor.modified = cursor.offset >= size ? modified : 0;
    } finally {
      await file.close();
    }
  }
  private publish(): void {
    if (this.stopped) return;
    let snapshot: StateSnapshot;
    if (this.ambiguous)
      snapshot = {
        ...unknown_snapshot('ambiguous_workspace_windows'),
        ...(this.pinned_session ? { session_id: this.pinned_session } : {}),
      };
    else {
      const candidates = [...this.cursors.values()].filter(
        (cursor) =>
          cursor.metadata?.eligible &&
          (this.pinned_session
            ? cursor.metadata.session_id === this.pinned_session
            : this.roots.some(
                (root) =>
                  normalize_session_path(root, this.path_flavor) ===
                  normalize_session_path(cursor.metadata?.cwd ?? '', this.path_flavor),
              )),
      );
      const now = Date.now();
      const expired = (cursor: FileCursor): boolean =>
        now - Math.min(cursor.modified, cursor.last_activity ?? cursor.modified) >
        this.stale_minutes * 60000;
      // File writes alone (for example thread_settings_applied when reopening
      // a conversation) cannot refresh an old completion or old quota error.
      // Aggregate recent evidence together, including unfinished work and unknown states.
      // Expired history cannot describe current activity; if all evidence is old, stay unknown.
      const fresh_candidates = candidates.filter((cursor) => !expired(cursor));
      const active_candidates = fresh_candidates.length ? fresh_candidates : candidates;
      const snapshots = active_candidates.map((cursor) =>
        expired(cursor)
          ? { ...cursor.snapshot, state: 'unknown' as const, reason: 'stale_session' }
          : cursor.snapshot,
      );
      snapshot = aggregate_states(snapshots);
      if (this.pinned_session) snapshot = { ...snapshot, session_id: this.pinned_session };
    }
    const serialized = JSON.stringify(snapshot);
    if (serialized !== this.last_snapshot) {
      this.last_snapshot = serialized;
      this.on_change?.(snapshot);
    }
  }
}
