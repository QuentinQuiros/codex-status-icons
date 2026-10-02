namespace CodexStatusTray.Windows;

internal sealed class SettingsField : Panel
{
    private readonly Control input;

    public SettingsField(Control input, string? hint = null)
    {
        this.input = input;
        AutoSize = true;
        AutoSizeMode = AutoSizeMode.GrowAndShrink;
        Padding = new Padding(10, 6, 10, 6);
        TabStop = false;
        SetStyle(ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        input.Font = new Font("Segoe UI", 11);
        input.ForeColor = SystemColors.WindowText;
        input.Margin = Padding.Empty;
        input.Location = new Point(Padding.Left, Padding.Top);
        if (input is TextBox textBox) textBox.BorderStyle = BorderStyle.None;
        if (input is ComboBox combo) combo.FlatStyle = FlatStyle.Flat;
        Controls.Add(input);
        if (input is TextBox hinted && hint is not null) hinted.PlaceholderText = hint;
        void RefreshAppearance()
        {
            BackColor = input.BackColor = input.Enabled ? SystemColors.Window : SystemColors.Control;
            Invalidate();
        }
        input.GotFocus += (_, _) => RefreshAppearance();
        input.LostFocus += (_, _) => RefreshAppearance();
        input.TextChanged += (_, _) => RefreshAppearance();
        input.EnabledChanged += (_, _) => RefreshAppearance();
        Click += (_, _) => input.Focus();
        RefreshAppearance();
    }

    protected override void OnPaint(PaintEventArgs args)
    {
        base.OnPaint(args);
        var color = input.Focused ? SystemColors.Highlight : SystemInformation.HighContrast ? SystemColors.WindowText : input.Enabled ? Color.FromArgb(119, 130, 147) : SystemColors.ControlDark;
        using var pen = new Pen(color, input.Focused ? 2 : 1);
        args.Graphics.DrawRectangle(pen, 1, 1, Math.Max(0, Width - 3), Math.Max(0, Height - 3));
    }
}

internal sealed class SettingsTextBox : TextBox
{
    protected override void WndProc(ref Message message)
    {
        base.WndProc(ref message);
        // Paint the cue with a readable colour, including print-to-image previews.
        // PlaceholderText stays separate from Text and is never saved as a value.
        if (message.Msg is not (0x000F or 0x0317 or 0x0318) || Focused || TextLength != 0 || PlaceholderText.Length == 0) return;
        using var graphics = message.Msg == 0x000F ? Graphics.FromHwnd(Handle) : Graphics.FromHdc(message.WParam);
        var color = !Enabled ? SystemColors.GrayText : SystemInformation.HighContrast ? SystemColors.WindowText : Color.FromArgb(70, 80, 95);
        var bounds = ClientRectangle;
        bounds.Offset(1, 1);
        TextRenderer.DrawText(graphics, PlaceholderText, Font, bounds, color, BackColor, TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix | TextFormatFlags.Top | TextFormatFlags.EndEllipsis);
    }
}
