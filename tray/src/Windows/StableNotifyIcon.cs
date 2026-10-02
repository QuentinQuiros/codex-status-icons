using System.Runtime.InteropServices;

namespace CodexStatusTray.Windows;

// WinForms NotifyIcon only exposes hWnd/uID identity. Use the documented GUID
// identity so Explorer can retain preferences across reloads and app versions.
public sealed class StableNotifyIcon : IDisposable
{
    private const uint Add = 0, Modify = 1, Delete = 2, SetFocus = 3, SetVersion = 4;
    private const uint MessageFlag = 1, IconFlag = 2, TipFlag = 4, InfoFlag = 16, GuidFlag = 32, ShowTipFlag = 128;
    private const int Callback = 0x8001;
    private readonly IconWindow window;
    private Icon? image;
    private string text = "";
    private bool visible, added, disposed;
    public Guid Identity { get; }
    public event MouseEventHandler? MouseClick;
    public event EventHandler? BalloonTipClicked;
    public event EventHandler? BalloonTipShown;
    public event EventHandler? BalloonTipClosed;
    public ContextMenuStrip? ContextMenuStrip { get; set; }
    public StableNotifyIcon(Guid identity)
    {
        Identity = identity;
        window = new IconWindow(this);
    }
    public Icon? Icon { get => image; set { image = value; if (visible) Update(); } }
    public string Text
    {
        get => text;
        set { if (value.Length > 127) throw new ArgumentOutOfRangeException(nameof(value)); text = value; if (visible) Update(); }
    }
    public bool Visible
    {
        get => visible && added;
        set { if (disposed) throw new ObjectDisposedException(nameof(StableNotifyIcon)); visible = value; if (visible) Update(); else Remove(); }
    }
    private NotifyData Data(uint flags) => new()
    {
        Size = (uint)Marshal.SizeOf<NotifyData>(), Window = window.Handle, Id = 1,
        Flags = flags | GuidFlag, CallbackMessage = Callback, Icon = image?.Handle ?? IntPtr.Zero,
        Tip = text, Info = "", InfoTitle = "", Guid = Identity
    };
    private void Update()
    {
        if (disposed || !visible || image is null) return;
        var data = Data(MessageFlag | IconFlag | TipFlag | ShowTipFlag);
        if (!ShellNotifyIcon(added ? Modify : Add, ref data)) { added = false; return; }
        if (!added)
        {
            added = true;
            data.Version = 4;
            if (!ShellNotifyIcon(SetVersion, ref data)) Remove();
        }
    }
    private void Remove()
    {
        if (!added) return;
        var data = Data(0); ShellNotifyIcon(Delete, ref data); added = false;
    }
    public bool ShowBalloonTip(int timeout, string title, string message, ToolTipIcon kind, bool silent = false)
    {
        if (!added) return false;
        var data = Data(InfoFlag);
        data.Info = message.Length <= 255 ? message : message[..255];
        data.InfoTitle = title.Length <= 63 ? title : title[..63];
        data.InfoFlags = 0x80u | (silent ? 0x10u : 0u) | (kind switch { ToolTipIcon.Info => 1u, ToolTipIcon.Warning => 2u, ToolTipIcon.Error => 3u, _ => 0u });
        data.Version = (uint)Math.Max(0, timeout);
        return ShellNotifyIcon(Modify, ref data);
    }
    private void OnCallback(IntPtr wParam, IntPtr lParam)
    {
        var notification = (int)(lParam.ToInt64() & 0xffff);
        var packed = wParam.ToInt64();
        var point = new Point(unchecked((short)(packed & 0xffff)), unchecked((short)((packed >> 16) & 0xffff)));
        if (notification == 0x402) BalloonTipShown?.Invoke(this, EventArgs.Empty);
        else if (notification is 0x403 or 0x404) BalloonTipClosed?.Invoke(this, EventArgs.Empty);
        else if (notification == 0x405) // NIN_BALLOONUSERCLICK, independent from tray clicks
            BalloonTipClicked?.Invoke(this, EventArgs.Empty);
        else if (notification is 0x400 or 0x401) // NIN_SELECT / NIN_KEYSELECT
            MouseClick?.Invoke(this, new MouseEventArgs(MouseButtons.Left, 1, point.X, point.Y, 0));
        else if (notification == 0x7b) // WM_CONTEXTMENU, including keyboard invocation
        {
            MouseClick?.Invoke(this, new MouseEventArgs(MouseButtons.Right, 1, point.X, point.Y, 0));
            var menu = ContextMenuStrip;
            if (menu is null) return;
            if (point == new Point(-1, -1)) point = Cursor.Position;
            SetForegroundWindow(window.Handle);
            void Closed(object? sender, ToolStripDropDownClosedEventArgs args)
            {
                menu.Closed -= Closed;
                if (added) { var data = Data(0); ShellNotifyIcon(SetFocus, ref data); }
            }
            menu.Closed += Closed;
            menu.Show(point);
        }
    }
    public void Dispose()
    {
        if (disposed) return;
        Remove(); visible = false; disposed = true; window.DestroyHandle();
        GC.SuppressFinalize(this);
    }
    private sealed class IconWindow : NativeWindow
    {
        private readonly StableNotifyIcon owner;
        private readonly uint taskbarCreated = RegisterWindowMessage("TaskbarCreated");
        public IconWindow(StableNotifyIcon owner) { this.owner = owner; CreateHandle(new CreateParams { Caption = "Codex Status Icons" }); }
        protected override void WndProc(ref Message message)
        {
            if (message.Msg == Callback) owner.OnCallback(message.WParam, message.LParam);
            else if (taskbarCreated != 0 && (uint)message.Msg == taskbarCreated) { owner.added = false; owner.Update(); }
            base.WndProc(ref message);
        }
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NotifyData
    {
        public uint Size; public IntPtr Window; public uint Id, Flags, CallbackMessage; public IntPtr Icon;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Tip;
        public uint State, StateMask;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string Info;
        public uint Version;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string InfoTitle;
        public uint InfoFlags; public Guid Guid; public IntPtr BalloonIcon;
    }
    [DllImport("shell32.dll", EntryPoint = "Shell_NotifyIconW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] private static extern bool ShellNotifyIcon(uint operation, ref NotifyData data);
    [DllImport("user32.dll", EntryPoint = "RegisterWindowMessageW", CharSet = CharSet.Unicode)] private static extern uint RegisterWindowMessage(string message);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetForegroundWindow(IntPtr window);
}
