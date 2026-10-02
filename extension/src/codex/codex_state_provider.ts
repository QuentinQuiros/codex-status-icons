import type { StateSnapshot } from '../state';
export interface CodexStateProvider {
  start(on_change: (snapshot: StateSnapshot) => void): Promise<void>;
  stop(): void;
  set_ambiguous(ambiguous: boolean): void;
  pin_session(session_id: string | undefined): void;
  sessions(): readonly { session_id: string; cli_version: string }[];
  scan?(): Promise<void>;
}
