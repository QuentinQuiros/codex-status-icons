import { valid_language, type InterfaceLanguage } from './i18n';
export interface StatusConfig {
  language: InterfaceLanguage;
  enabled: boolean;
  notifications_enabled: boolean;
  notification_sound: NotificationSound;
  notification_sound_file: string;
  workspace_label: string;
  show_working_duration: boolean;
  start_tray_automatically: boolean;
  exit_when_no_windows: boolean;
  log_level: 'off' | 'error' | 'debug';
  sessions_directory: string;
  remote_sessions_directory: string;
  stale_working_minutes: number;
}
// Kept on the wire for compatibility with older companions, never user-configurable.
export const companion_exit_delay_seconds = 15;
export const timing_settings = {
  stale_working_minutes: { minimum: 5, maximum: 1440 },
} as const;
export type TimingSetting = keyof typeof timing_settings;
export type TimingChanges = Partial<Record<TimingSetting, number>>;
export type NotificationSound = 'chatgpt' | 'windows' | 'silent' | 'custom';
export function valid_notification_sound(value: unknown): value is NotificationSound {
  return value === 'chatgpt' || value === 'windows' || value === 'silent' || value === 'custom';
}
export function valid_sound_file(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 2048 &&
    !/[\x00-\x1f]/.test(value) &&
    (value === '' || /^[a-z]:[\\/].*\.wav$/i.test(value))
  );
}
export type SettingsKey =
  | TimingSetting
  | 'language'
  | 'workspace_label'
  | 'notifications_enabled'
  | 'notification_sound'
  | 'notification_sound_file';
export type SettingsValue = number | string | boolean;
export type SettingsChanges = TimingChanges & {
  language?: InterfaceLanguage;
  workspace_label?: string;
  notifications_enabled?: boolean;
  notification_sound?: NotificationSound;
  notification_sound_file?: string;
};
export function valid_workspace_label(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 8 && /^(?:[\p{L}\p{N}]\p{M}*)?$/u.test(value);
}
export function valid_settings_changes(value: unknown): value is SettingsChanges {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length > 0 &&
    entries.length <= 6 &&
    entries.every(([key, setting]) =>
      key === 'language'
        ? valid_language(setting)
        : key === 'workspace_label'
          ? valid_workspace_label(setting)
          : key === 'notifications_enabled'
            ? typeof setting === 'boolean'
            : key === 'notification_sound'
              ? valid_notification_sound(setting)
              : key === 'notification_sound_file'
                ? valid_sound_file(setting)
                : valid_timing_setting(key, setting),
    )
  );
}
export function valid_timing_changes(value: unknown): value is TimingChanges {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length > 0 &&
    entries.length <= 1 &&
    entries.every(([key, number]) => valid_timing_setting(key, number))
  );
}
export function valid_timing_setting(key: unknown, value: unknown): key is TimingSetting {
  if (key !== 'stale_working_minutes') return false;
  const bounds = timing_settings[key];
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= bounds.minimum &&
    value <= bounds.maximum
  );
}
export async function apply_timing_setting(
  key: TimingSetting,
  value: number,
  has_workspace: boolean,
  write: (key: TimingSetting, value: number, scope: 'global' | 'workspace') => PromiseLike<void>,
): Promise<boolean> {
  if (!valid_timing_setting(key, value)) return false;
  try {
    await write(
      key,
      value,
      key === 'stale_working_minutes' && has_workspace ? 'workspace' : 'global',
    );
    return true;
  } catch {
    return false;
  }
}
export async function apply_timing_changes(
  changes: TimingChanges,
  has_workspace: boolean,
  read_stored: (key: TimingSetting, scope: 'global' | 'workspace') => number | undefined,
  write: (
    key: TimingSetting,
    value: number | undefined,
    scope: 'global' | 'workspace',
  ) => PromiseLike<void>,
): Promise<boolean> {
  if (!valid_timing_changes(changes)) return false;
  return apply_changes(changes, has_workspace, read_stored, write);
}
export async function apply_settings_changes(
  changes: SettingsChanges,
  has_workspace: boolean,
  read_stored: (key: SettingsKey, scope: 'global' | 'workspace') => SettingsValue | undefined,
  write: (
    key: SettingsKey,
    value: SettingsValue | undefined,
    scope: 'global' | 'workspace',
  ) => PromiseLike<void>,
): Promise<boolean> {
  if (!valid_settings_changes(changes)) return false;
  return apply_changes<SettingsKey, SettingsValue>(changes, has_workspace, read_stored, write);
}
async function apply_changes<K extends string, V>(
  changes: Partial<Record<K, V>>,
  has_workspace: boolean,
  read_stored: (key: K, scope: 'global' | 'workspace') => V | undefined,
  write: (key: K, value: V | undefined, scope: 'global' | 'workspace') => PromiseLike<void>,
): Promise<boolean> {
  const attempted: { key: K; value: V; scope: 'global' | 'workspace'; previous: V | undefined }[] =
    [];
  try {
    const entries = Object.entries(changes).map(([key, value]) => {
      const setting = key as K;
      const scope: 'global' | 'workspace' =
        (setting === 'stale_working_minutes' || setting === 'workspace_label') && has_workspace
          ? 'workspace'
          : 'global';
      return { key: setting, value: value as V, scope, previous: read_stored(setting, scope) };
    });
    for (const entry of entries) {
      attempted.push(entry);
      await write(entry.key, entry.value, entry.scope);
    }
    return true;
  } catch {
    for (const entry of attempted.reverse()) {
      try {
        await write(entry.key, entry.previous, entry.scope);
      } catch {
        /* An unavailable settings store cannot guarantee rollback; report failure. */
      }
    }
    return false;
  }
}
export function read_config(get_value: (key: string) => unknown): StatusConfig {
  const boolean_value = (key: string, fallback: boolean): boolean =>
    typeof get_value(key) === 'boolean' ? (get_value(key) as boolean) : fallback;
  const string_value = (key: string): string =>
    typeof get_value(key) === 'string' ? (get_value(key) as string).trim() : '';
  const number_value = (
    key: string,
    fallback: number,
    minimum: number,
    maximum: number,
  ): number => {
    const value = get_value(key);
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.min(maximum, Math.max(minimum, value))
      : fallback;
  };
  const log_level = get_value('log_level');
  return {
    language: valid_language(get_value('language'))
      ? (get_value('language') as InterfaceLanguage)
      : 'auto',
    enabled: boolean_value('enabled', true),
    notifications_enabled: boolean_value('notifications_enabled', true),
    notification_sound: valid_notification_sound(get_value('notification_sound'))
      ? (get_value('notification_sound') as NotificationSound)
      : 'chatgpt',
    notification_sound_file: valid_sound_file(get_value('notification_sound_file'))
      ? (get_value('notification_sound_file') as string)
      : '',
    workspace_label: string_value('workspace_label'),
    show_working_duration: boolean_value('show_working_duration', true),
    start_tray_automatically: boolean_value('start_tray_automatically', true),
    exit_when_no_windows: boolean_value('exit_when_no_windows', true),
    log_level: log_level === 'error' || log_level === 'debug' ? log_level : 'off',
    sessions_directory: string_value('sessions_directory'),
    remote_sessions_directory: string_value('remote_sessions_directory'),
    stale_working_minutes: number_value('stale_working_minutes', 60, 5, 1440),
  };
}
