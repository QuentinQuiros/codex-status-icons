namespace CodexStatusTray.Windows;

internal static class DialogLayout
{
    private const int ContentWidth = 560 + 24 * 2;

    public static void AttachTabbed(Form dialog, TableLayoutPanel content)
    {
        dialog.AutoSize = dialog.AutoScroll = false;
        content.AutoSize = false;
        content.Dock = DockStyle.Fill;
        content.MinimumSize = new Size(ContentWidth, 0);
        content.Margin = Padding.Empty;
        dialog.Controls.Add(content);
        var fitting = false;
        void Fit()
        {
            if (fitting || !dialog.IsHandleCreated) return;
            fitting = true;
            try {
                var area = Screen.FromHandle(dialog.Handle).WorkingArea;
                var frameHeight = dialog.Height - dialog.ClientSize.Height;
                var maximumHeight = area.Height - frameHeight - 40;
                if (dialog.MaximumSize.Height > 0) maximumHeight = Math.Min(maximumHeight, dialog.MaximumSize.Height - frameHeight);
                var target = new Size(content.MinimumSize.Width + SystemInformation.VerticalScrollBarWidth, Math.Max(240, Math.Min(880, maximumHeight)));
                if (dialog.ClientSize != target) dialog.ClientSize = target;
            } finally { fitting = false; }
        }
        dialog.Load += (_, _) => {
            Fit();
            if (dialog.StartPosition == FormStartPosition.CenterScreen) {
                var area = Screen.FromHandle(dialog.Handle).WorkingArea;
                dialog.Location = new Point(area.Left + (area.Width - dialog.Width) / 2, area.Top + (area.Height - dialog.Height) / 2);
            }
        };
        content.Layout += (_, _) => { if (dialog.Visible) Fit(); };
        dialog.DpiChanged += (_, _) => dialog.BeginInvoke((Action)Fit);
    }

    public static void Attach(Form dialog, TableLayoutPanel content)
    {
        // A Form with MaximumSize.Width == 0 and a bounded height can be clamped
        // to Windows' minimum tracking width when its native handle is created.
        // Give both dialogs the same content width and bound only their height.
        dialog.AutoSize = false;
        dialog.AutoScroll = true;
        content.AutoSizeMode = AutoSizeMode.GrowAndShrink;
        content.Margin = Padding.Empty;
        content.MinimumSize = new Size(ContentWidth, 0);
        content.MaximumSize = new Size(ContentWidth, 0);
        dialog.Controls.Add(content);
        var fitting = false;
        void Fit()
        {
            if (fitting || !dialog.IsHandleCreated) return;
            fitting = true;
            try {
                var area = Screen.FromHandle(dialog.Handle).WorkingArea;
                var frameHeight = dialog.Height - dialog.ClientSize.Height;
                // Reserve space for a vertical scrollbar even when it is hidden,
                // so long content never creates a horizontal scrollbar.
                var width = content.MinimumSize.Width + SystemInformation.VerticalScrollBarWidth;
                var height = Math.Min(content.PreferredSize.Height, Math.Max(200, area.Height - frameHeight - 40));
                var target = new Size(width, height);
                if (dialog.ClientSize != target) dialog.ClientSize = target;
            }
            finally { fitting = false; }
        }
        dialog.Load += (_, _) => {
            Fit();
            if (dialog.StartPosition == FormStartPosition.CenterScreen) {
                var area = Screen.FromHandle(dialog.Handle).WorkingArea;
                dialog.Location = new Point(area.Left + (area.Width - dialog.Width) / 2, area.Top + (area.Height - dialog.Height) / 2);
            }
        };
        content.Layout += (_, _) => { if (dialog.Visible) Fit(); };
        dialog.DpiChanged += (_, _) => dialog.BeginInvoke((Action)Fit);
    }
}
