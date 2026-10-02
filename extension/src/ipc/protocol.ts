import { codex_states, type StateSnapshot } from '../state';
import type { WorkspaceIdentity } from '../workspace';
import type { QuotaWindow } from '../codex/account_quota';
import {
  valid_timing_setting,
  valid_settings_changes,
  type TimingSetting,
  type SettingsChanges,
} from '../config';
export const protocol_version = 1;
export const max_frame_bytes = 16384;
export type ClientMessage =
  | {
      version: 1;
      type: 'hello' | 'update' | 'heartbeat';
      timestamp: string;
      workspace: WorkspaceIdentity;
      snapshot: StateSnapshot;
      window_focused: boolean;
      show_working_duration: boolean;
      pinned_session: boolean;
      extension_version?: string;
      location?: string;
      bridge_version?: string | undefined;
      quota?: { checked_at: string; windows: QuotaWindow[] } | undefined;
      settings?: {
        exit_grace_seconds: number;
        stale_working_minutes: number;
        exit_when_no_windows: boolean;
        configuration_version?: number;
        language?: string;
        workspace_label?: string;
        notifications_enabled?: boolean;
        notification_sound?: string;
        notification_sound_file?: string;
      };
    }
  | { version: 1; type: 'disconnect'; workspace_id: string }
  | {
      version: 1;
      type: 'diagnostics' | 'request_focus' | 'restart_tray';
      workspace_id: string;
      request_id: string;
    }
  | {
      version: 1;
      type: 'focus_result';
      request_id: string;
      workspace_id: string;
      focused: boolean;
    }
  | {
      version: 1;
      type: 'configuration_result';
      request_id: string;
      workspace_id: string;
      success: boolean;
    };
export type ServerMessage =
  | {
      version: 1;
      type: 'diagnostics';
      request_id: string;
      connected_count: number;
      icon_visible: boolean;
      state: string;
      reason?: string;
      status_text?: string;
      tooltip?: string;
      label?: string;
      extension_version?: string;
      location?: string;
      bridge_version?: string;
      window_handle: string;
      focus_succeeded: boolean | null;
      icon_style?: string;
      icon_size?: string;
      tray_version?: string;
      icon_guid?: string;
      executable_path?: string;
      exit_grace_seconds?: number;
      stale_working_minutes?: number;
      exit_when_no_windows?: boolean;
      language?: string;
      language_preference?: string;
      notifications_enabled?: boolean;
      notifications_sent?: number;
      notification_sound?: string;
    }
  | { version: 1; type: 'welcome'; server_pid: number; language?: 'fr' | 'en' }
  | { version: 1; type: 'association'; ambiguous: boolean }
  | { version: 1; type: 'focus'; request_id: string }
  | { version: 1; type: 'configure'; request_id: string; key: TimingSetting; value: number }
  | { version: 1; type: 'configure_settings'; request_id: string; changes: SettingsChanges }
  | { version: 1; type: 'shutdown'; reason: 'user_exit' | 'restart' };
export function serialize_message(message: ClientMessage | ServerMessage): string {
  const frame = `${JSON.stringify(message)}\n`;
  if (Buffer.byteLength(frame) > max_frame_bytes) throw new Error('frame_too_large');
  return frame;
}
export function parse_server_message(line: string): ServerMessage | undefined {
  try {
    const value: unknown = JSON.parse(line);
    if (!is_record(value) || value.version !== 1) return;
    if (
      value.type === 'diagnostics' &&
      typeof value.request_id === 'string' &&
      typeof value.connected_count === 'number' &&
      typeof value.icon_visible === 'boolean' &&
      typeof value.state === 'string' &&
      typeof value.window_handle === 'string'
    )
      return value as unknown as ServerMessage;
    if (
      value.type === 'welcome' &&
      Number.isInteger(value.server_pid) &&
      (value.language === undefined || value.language === 'fr' || value.language === 'en')
    )
      return value as unknown as ServerMessage;
    if (value.type === 'association' && typeof value.ambiguous === 'boolean')
      return value as unknown as ServerMessage;
    if (
      value.type === 'configure_settings' &&
      typeof value.request_id === 'string' &&
      value.request_id.length > 0 &&
      value.request_id.length < 100 &&
      valid_settings_changes(value.changes)
    )
      return value as unknown as ServerMessage;
    if (
      value.type === 'configure' &&
      typeof value.request_id === 'string' &&
      value.request_id.length > 0 &&
      value.request_id.length < 100 &&
      valid_timing_setting(value.key, value.value)
    )
      return value as unknown as ServerMessage;
    if (
      value.type === 'focus' &&
      typeof value.request_id === 'string' &&
      value.request_id.length < 100
    )
      return value as unknown as ServerMessage;
    if (value.type === 'shutdown' && (value.reason === 'user_exit' || value.reason === 'restart'))
      return value as unknown as ServerMessage;
  } catch {
    /* malformed frame has no effect */
  }
}
export function is_record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function is_state(value: unknown): boolean {
  return typeof value === 'string' && (codex_states as readonly string[]).includes(value);
}
export class FrameDecoder {
  private pending = Buffer.alloc(0);
  push(chunk: Buffer): string[] {
    this.pending = Buffer.concat([this.pending, chunk]);
    const lines: string[] = [];
    let end: number;
    while ((end = this.pending.indexOf(10)) >= 0) {
      if (end > max_frame_bytes) throw new Error('frame_too_large');
      lines.push(this.pending.subarray(0, end).toString('utf8'));
      this.pending = this.pending.subarray(end + 1);
    }
    if (this.pending.length > max_frame_bytes) throw new Error('frame_too_large');
    return lines;
  }
}
