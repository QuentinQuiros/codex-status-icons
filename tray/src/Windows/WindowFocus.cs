using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using CodexStatusTray.Core;

namespace CodexStatusTray.Windows;
public sealed class WindowFocus
{
    private readonly Dictionary<string, nint> handles = [];
    public void Observe(WorkspaceEntry entry)
    {
        if (!entry.WindowFocused) return;
        var handle = GetForegroundWindow();
        if (!IsCodeWindow(handle) || !MatchesTitle(handle, entry.Workspace.WorkspaceName)) return;
        // Captures only foreground Code windows belonging to this client's Code process tree.
        GetWindowThreadProcessId(handle, out var windowPid);
        if (!HasAncestor(entry.ClientPid, windowPid)) return;
        handles[entry.Workspace.WorkspaceId] = handle;
    }
    public void Remove(string workspaceId) => handles.Remove(workspaceId);
    public nint Resolve(string workspaceId, string name)
    {
        if (handles.TryGetValue(workspaceId, out var handle) && IsCodeWindow(handle) && MatchesTitle(handle, name)) return handle;
        var candidates = CodeWindows().Where(candidate => MatchesTitle(candidate, name)).ToArray();
        return candidates.Length == 1 ? candidates[0] : 0;
    }
    public bool Focus(string workspaceId, string name)
    {
        var handle = Resolve(workspaceId, name);
        if (handle == 0) return false;
        if (GetForegroundWindow() == handle) return true;
        if (IsIconic(handle)) ShowWindowAsync(handle, 9);
        var result = SetForegroundWindow(handle) || GetForegroundWindow() == handle;
        if (!result) { var info = new FlashInfo { Size = (uint)Marshal.SizeOf<FlashInfo>(), Window = handle, Flags = 3, Count = 3 }; FlashWindowEx(ref info); }
        return result;
    }
    public static nint[] CodeWindows()
    {
        var result = new List<nint>();
        EnumWindows((window, _) => { if (IsWindowVisible(window) && IsCodeWindow(window)) result.Add(window); return true; }, 0);
        return result.ToArray();
    }
    public static string Title(nint handle) { var text = new StringBuilder(1024); GetWindowText(handle, text, text.Capacity); return text.ToString(); }
    public static bool TitleMatchesWorkspace(string title, string name) => Regex.IsMatch(title, @"(?:^|\s[-–—]\s)" + Regex.Escape(name) + @"(?:\s[-–—]\s|\s\[|$)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static bool MatchesTitle(nint handle, string name) => TitleMatchesWorkspace(Title(handle), name);
    private static bool IsCodeWindow(nint handle)
    {
        if (handle == 0 || !IsWindow(handle)) return false;
        GetWindowThreadProcessId(handle, out var pid);
        try { using var process = Process.GetProcessById((int)pid); return process.ProcessName is "Code" or "Code - Insiders"; }
        catch (Exception error) when (error is ArgumentException or InvalidOperationException or System.ComponentModel.Win32Exception) { return false; }
    }
    private static bool HasAncestor(uint pid, uint ancestor)
    {
        if (pid == ancestor) return true;
        var snapshot = CreateToolhelp32Snapshot(2, 0);
        if (snapshot == -1) return false;
        try
        {
            var parents = new Dictionary<uint, uint>(); var entry = new ProcessEntry { Size = (uint)Marshal.SizeOf<ProcessEntry>(), Executable = string.Empty };
            if (Process32First(snapshot, ref entry)) do { parents[entry.ProcessId] = entry.ParentProcessId; } while (Process32Next(snapshot, ref entry));
            var seen = new HashSet<uint>();
            while (seen.Add(pid) && parents.TryGetValue(pid, out var parent)) { if (parent == ancestor) return true; pid = parent; }
            return false;
        }
        finally { CloseHandle(snapshot); }
    }
    [StructLayout(LayoutKind.Sequential)] private struct FlashInfo { public uint Size; public nint Window; public uint Flags; public uint Count; public uint Timeout; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct ProcessEntry { public uint Size; public uint Usage; public uint ProcessId; public nuint Heap; public uint Module; public uint Threads; public uint ParentProcessId; public int Priority; public uint Flags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string Executable; }
    private delegate bool WindowCallback(nint window, nint parameter);
    [DllImport("user32.dll")] private static extern bool EnumWindows(WindowCallback callback, nint parameter);
    [DllImport("user32.dll")] private static extern nint GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(nint handle, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(nint handle, StringBuilder text, int length);
    [DllImport("user32.dll")] private static extern bool IsWindow(nint handle);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(nint handle);
    [DllImport("user32.dll")] private static extern bool IsIconic(nint handle);
    [DllImport("user32.dll")] private static extern bool ShowWindowAsync(nint handle, int command);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(nint handle);
    [DllImport("user32.dll")] private static extern bool FlashWindowEx(ref FlashInfo info);
    [DllImport("kernel32.dll")] private static extern nint CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern bool Process32First(nint snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern bool Process32Next(nint snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(nint handle);
}
