namespace CodexStatusTray.Core;

public sealed record WorkspaceEntry(WorkspaceInfo Workspace, StateSnapshot Snapshot, Guid ConnectionId, uint ClientPid, DateTimeOffset LastHeartbeat, bool WindowFocused, bool ShowWorkingDuration, bool PinnedSession, TimingSettings? Settings = null, string? ExtensionVersion = null, string? Location = null, string? BridgeVersion = null, QuotaInfo? Quota = null);
public sealed class WorkspaceRegistry(TimeSpan? timeout = null)
{
    private readonly Dictionary<string, WorkspaceEntry> entries = [];
    private readonly TimeSpan heartbeatTimeout = timeout ?? TimeSpan.FromSeconds(35);
    public IReadOnlyCollection<WorkspaceEntry> Entries => entries.Values.ToArray();
    public WorkspaceEntry? Get(string workspaceId) => entries.GetValueOrDefault(workspaceId);
    public bool Update(ClientMessage message, Guid connectionId, uint clientPid, DateTimeOffset now)
    {
        if (message.Workspace is null || message.Snapshot is null) return false;
        var id = message.Workspace.WorkspaceId;
        if (entries.TryGetValue(id, out var previous) && previous.ConnectionId != connectionId && message.Type != "hello") return false;
        entries[id] = new(message.Workspace, message.Snapshot, connectionId, clientPid, now, message.WindowFocused, message.ShowWorkingDuration, message.PinnedSession, message.Settings, message.ExtensionVersion, message.Location, message.BridgeVersion, message.Quota);
        return true;
    }
    public bool Remove(string workspaceId, Guid connectionId) => entries.TryGetValue(workspaceId, out var entry) && entry.ConnectionId == connectionId && entries.Remove(workspaceId);
    public string[] RemoveConnection(Guid connectionId)
    {
        var removed = entries.Values.Where(entry => entry.ConnectionId == connectionId).Select(entry => entry.Workspace.WorkspaceId).ToArray();
        foreach (var id in removed) entries.Remove(id);
        return removed;
    }
    public string[] Expire(DateTimeOffset now)
    {
        var expired = entries.Values.Where(entry => now - entry.LastHeartbeat > heartbeatTimeout).Select(entry => entry.Workspace.WorkspaceId).ToArray();
        foreach (var id in expired) entries.Remove(id);
        return expired;
    }
    public bool IsAmbiguous(WorkspaceEntry target)
    {
        if (target.PinnedSession && target.Snapshot.SessionId is { } pinned)
            return entries.Values.Any(other => other.Workspace.WorkspaceId != target.Workspace.WorkspaceId && Scope(other.Workspace.WorkspacePath) == Scope(target.Workspace.WorkspacePath) && other.PinnedSession && other.Snapshot.SessionId == pinned);
        return entries.Values.Any(other => other.Workspace.WorkspaceId != target.Workspace.WorkspaceId && target.Workspace.WorkspaceRoots.Any(root => other.Workspace.WorkspaceRoots.Any(otherRoot => string.Equals(root, otherRoot, root.StartsWith("vscode-remote://", StringComparison.Ordinal) ? StringComparison.Ordinal : StringComparison.OrdinalIgnoreCase))));
    }
    private static string Scope(string path) { const string prefix = "vscode-remote://"; if (!path.StartsWith(prefix, StringComparison.Ordinal)) return "local"; var end = path.IndexOf('/', prefix.Length); return end < 0 ? path : path[..end]; }
}
