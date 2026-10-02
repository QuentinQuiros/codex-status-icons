using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace CodexStatusTray.Core;

// Transport IDs change on window reload. Icon GUIDs instead describe a workspace
// and a duplicate-window slot, independently of labels, languages and versions.
public sealed class IconIdentityRegistry
{
    private readonly Dictionary<string, (string Scope, int Slot, Guid Guid)> assigned = [];
    public Guid Assign(WorkspaceInfo workspace)
    {
        var scope = Scope(workspace);
        if (assigned.TryGetValue(workspace.WorkspaceId, out var previous) && previous.Scope == scope) return previous.Guid;
        assigned.Remove(workspace.WorkspaceId);
        var used = assigned.Values.Where(item => item.Scope == scope).Select(item => item.Slot).ToHashSet();
        var slot = 0;
        while (used.Contains(slot)) slot++;
        var digest = SHA256.HashData(Encoding.UTF8.GetBytes("Codex Status Icons/icon/v1\n" + scope + "\n" + slot));
        var guid = new Guid(digest.AsSpan(0, 16));
        assigned[workspace.WorkspaceId] = (scope, slot, guid);
        return guid;
    }
    public void Remove(string workspaceId) => assigned.Remove(workspaceId);
    private static string Scope(WorkspaceInfo workspace)
    {
        var roots = workspace.WorkspaceRoots.Length > 0 ? workspace.WorkspaceRoots : string.IsNullOrEmpty(workspace.WorkspacePath) ? [] : new[] { workspace.WorkspacePath };
        return JsonSerializer.Serialize(roots.Select(root => root.StartsWith("vscode-remote://", StringComparison.Ordinal)
            ? root.TrimEnd('/') : root.Replace('\\', '/').TrimEnd('/').ToLowerInvariant()).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal));
    }
}
