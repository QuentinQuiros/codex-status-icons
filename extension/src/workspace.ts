import { randomUUID as random_uuid } from 'node:crypto';
import path from 'node:path';
import { resolve_language, translate } from './i18n';
const default_text = (key: 'workspace.remote' | 'workspace.empty'): string =>
  translate(resolve_language('auto', Intl.DateTimeFormat().resolvedOptions().locale), key);
export interface WorkspaceIdentity {
  workspace_id: string;
  workspace_name: string;
  workspace_path: string;
  workspace_roots: string[];
  label: string;
}
export function normalize_path(value: string): string {
  return path.win32
    .normalize(value)
    .replace(/[\\/]+$/, '')
    .toLowerCase();
}
export function normalize_session_path(value: string, flavor: 'windows' | 'posix'): string {
  if (flavor === 'windows') return normalize_path(value);
  const normalized = path.posix.normalize(value);
  return normalized === '/' ? normalized : normalized.replace(/\/+$/, '');
}
export function create_remote_workspace(
  name: string | undefined,
  root_uris: readonly string[],
  override = '',
  workspace_id: string = random_uuid(),
  fallback_name = default_text('workspace.remote'),
): WorkspaceIdentity {
  const workspace_name = name?.trim() || fallback_name;
  return {
    workspace_id,
    workspace_name,
    workspace_path: root_uris[0] ?? '',
    workspace_roots: [...new Set(root_uris)],
    label: workspace_label(workspace_name, override),
  };
}
export function workspace_label(name: string, override = ''): string {
  const source = (override.trim() || name).normalize('NFD').replace(/\p{M}/gu, '');
  return (source.match(/[\p{L}\p{N}]/u)?.[0] ?? '?').toUpperCase();
}
export function create_workspace(
  name: string | undefined,
  roots: readonly string[],
  override = '',
  workspace_id: string = random_uuid(),
  fallback_name = default_text('workspace.empty'),
): WorkspaceIdentity {
  const workspace_name = name?.trim() || (roots[0] ? path.win32.basename(roots[0]) : fallback_name);
  return {
    workspace_id,
    workspace_name,
    workspace_path: roots[0] ?? '',
    workspace_roots: [...new Set(roots.map(normalize_path))],
    label: workspace_label(workspace_name, override),
  };
}
