import type { StatusConfig } from './config';
type SafeField = 'workspace_id' | 'session_id' | 'provider' | 'state' | 'reason' | 'cli_version';
export class SafeLogger {
  constructor(
    private readonly level: StatusConfig['log_level'],
    private readonly write_line: (line: string) => void,
  ) {}
  write(event: string, fields: Partial<Record<SafeField, string>> = {}, error = false): void {
    if (this.level === 'off' || (this.level === 'error' && !error)) return;
    const allowed = ['workspace_id', 'session_id', 'provider', 'state', 'reason', 'cli_version'];
    const safe = Object.entries(fields)
      .filter(([key]) => allowed.includes(key))
      .map(
        ([key, value]) =>
          `${key}=${String(value)
            .replace(/[\r\n\x00-\x1f]/g, '')
            .slice(0, 180)}`,
      );
    this.write_line(
      `[${new Date().toISOString()}] ${event.replace(/[^a-z_]/g, '')} ${safe.join(' ')}`,
    );
  }
}
