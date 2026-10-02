using CodexStatusTray.Core;

namespace CodexStatusTray.Windows;

public sealed record TaskNotificationText(string Title, string Body, ToolTipIcon Icon)
{
    public static TaskNotificationText Create(TaskNotification kind, WorkspaceInfo workspace)
    {
        var project = TrayPresentation.DisplayName(workspace.WorkspaceName);
        if (project.Length > 160) project = project[..159] + "…";
        var key = kind == TaskNotification.Completed ? "notification.completed" : "notification.quota";
        return new(UiText.Get(key), project + Environment.NewLine + UiText.Get("notification.open"),
            kind == TaskNotification.Completed ? ToolTipIcon.Info : ToolTipIcon.Warning);
    }
}
