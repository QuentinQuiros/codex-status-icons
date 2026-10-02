namespace CodexStatusTray.Core;

public enum TaskNotification { Completed, QuotaExhausted }

public static class NotificationTransition
{
    public static TaskNotification? Detect(WorkspaceEntry? previous, WorkspaceEntry current, string messageType, bool enabled, bool ambiguous)
    {
        // A hello establishes a baseline. Reloading, reconnecting or discovering old
        // history must not announce a completion that this connection never observed.
        if (!enabled || ambiguous || messageType is not ("update" or "heartbeat") || previous is null
            || previous.ConnectionId != current.ConnectionId
            || previous.Workspace.WorkspaceId != current.Workspace.WorkspaceId
            || previous.Workspace.WorkspacePath != current.Workspace.WorkspacePath
            || !previous.Workspace.WorkspaceRoots.SequenceEqual(current.Workspace.WorkspaceRoots)
            || previous.Snapshot.State != "working") return null;
        var accountBlock = current.Snapshot is { State: "rate_limited", Provider: "app_server" } && current.Snapshot.Reason.StartsWith("account_", StringComparison.Ordinal);
        if (!accountBlock && previous.Snapshot.SessionId is { } oldSession && current.Snapshot.SessionId is { } newSession && oldSession != newSession) return null;
        return current.Snapshot.State switch {
            "idle" when current.Snapshot.Reason is "task_complete" or "turn_completed" or "thread_idle" => TaskNotification.Completed,
            "rate_limited" => TaskNotification.QuotaExhausted,
            _ => null
        };
    }
}
