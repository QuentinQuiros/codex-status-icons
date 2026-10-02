using System.Diagnostics;
using System.Security;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace CodexStatusTray.Windows;

public sealed record IconHistoryEntry(string Key, string ExecutablePath, Dictionary<string, IconHistoryValue> Values);
public sealed record IconHistoryValue(RegistryValueKind Kind, object Value);
public sealed record IconCleanupResult(int Candidates, int Deleted, string? Backup, string? Error = null, string[]? PlannedKeys = null);
public interface IIconHistoryStore
{
    IEnumerable<IconHistoryEntry> Read();
    bool DeleteIfUnchanged(IconHistoryEntry entry);
}

// Never reset Explorer's whole cache. Match only our former executable paths,
// exclude every running companion, and back up all values before deleting keys.
public static partial class LegacyIconCleanup
{
    public static bool IsLegacyPath(string executable, IEnumerable<string> cacheRoots, string extensionRoot)
    {
        string path;
        try { path = Canonical(executable); } catch (Exception error) when (error is ArgumentException or NotSupportedException or PathTooLongException) { return false; }
        foreach (var root in cacheRoots)
        {
            var prefix = Canonical(root) + "\\";
            if (path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) && CacheSuffix().IsMatch(path[prefix.Length..])) return true;
        }
        var extensionPrefix = Canonical(extensionRoot) + "\\";
        return path.StartsWith(extensionPrefix, StringComparison.OrdinalIgnoreCase) && ExtensionSuffix().IsMatch(path[extensionPrefix.Length..]);
    }
    public static IconCleanupResult Run(IIconHistoryStore store, IEnumerable<string> cacheRoots, string extensionRoot, IEnumerable<string> runningPaths, string backupDirectory, IEnumerable<string>? additionalOwnedExecutables = null, bool preview = false)
    {
        var candidateCount = 0;
        var deleted = 0;
        string? backup = null;
        try
        {
            var roots = cacheRoots.Select(Canonical).ToArray();
            var active = runningPaths.Select(Canonical).ToHashSet(StringComparer.OrdinalIgnoreCase);
            // MSIX can expose a logical LocalAppData path for a running process
            // while Explorer records its redirected package-cache path. Preserve
            // the same digest under every one of our known cache roots.
            foreach (var path in active.ToArray())
                foreach (var root in roots)
                {
                    var prefix = root + "\\";
                    if (!path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) || !CacheSuffix().IsMatch(path[prefix.Length..])) continue;
                    foreach (var alias in roots) active.Add(alias + "\\" + path[prefix.Length..]);
                }
            // Optional exact paths are for explicitly selected development builds.
            // They are never inferred from the executable's basename alone.
            var additional = (additionalOwnedExecutables ?? []).Select(Canonical).Where(path => string.Equals(Path.GetFileName(path), "codex_status_tray.exe", StringComparison.OrdinalIgnoreCase)).ToHashSet(StringComparer.OrdinalIgnoreCase);
            var entries = store.Read().Where(entry => {
                var path = TryCanonical(entry.ExecutablePath);
                return path is not null && (IsLegacyPath(path, roots, extensionRoot) || additional.Contains(path)) && !active.Contains(path);
            }).ToArray();
            candidateCount = entries.Length;
            if (preview) return new(entries.Length, 0, null, PlannedKeys: entries.Select(entry => entry.Key).ToArray());
            if (entries.Length == 0) return new(0, 0, null);
            Directory.CreateDirectory(backupDirectory);
            var filename = Path.Combine(backupDirectory, $"notification-icons-{DateTime.UtcNow:yyyyMMdd-HHmmss}-{Guid.NewGuid():N}.json");
            // CreateNew prevents overwriting an earlier recovery file.
            using (var output = new FileStream(filename, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                JsonSerializer.Serialize(output, new { version = 1, registry = "HKEY_CURRENT_USER\\Control Panel\\NotifyIconSettings", entries }, new JsonSerializerOptions { WriteIndented = true });
                output.Flush(true);
            }
            backup = filename;
            foreach (var entry in entries) if (store.DeleteIfUnchanged(entry)) deleted++;
            return new(entries.Length, deleted, filename);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or SecurityException or System.ComponentModel.Win32Exception)
        { return new(candidateCount, deleted, backup, error.GetType().Name); }
    }
    public static IconCleanupResult CleanInstalledHistory(IEnumerable<string>? additionalOwnedExecutables = null, bool preview = false)
    {
        try
        {
            var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var running = new List<string>();
            foreach (var name in new[] { "codex_status_tray", "Codex Status Icons" })
                foreach (var process in Process.GetProcessesByName(name))
                    using (process)
                    {
                        try { if (process.MainModule?.FileName is { } filename) running.Add(filename); }
                        catch (InvalidOperationException) { /* Process already exited. */ }
                    }
            if (Environment.ProcessPath is { } current) running.Add(current);
            var cacheRoots = new[] {
                Path.Combine(local, "codex-status", "bin"),
                // Earlier local builds were launched from the Codex desktop
                // package's redirected LocalAppData cache. This is our cache,
                // not the other programs in that package or in NotifyIconSettings.
                Path.Combine(local, "Packages", "OpenAI.Codex_2p2nqsd0c76g0", "LocalCache", "Local", "codex-status", "bin")
            };
            return Run(new RegistryIconHistoryStore(), cacheRoots, Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".vscode", "extensions"), running, Path.Combine(local, "codex-status", "icon-history-backups"), additionalOwnedExecutables, preview);
        }
        catch (Exception error) when (error is System.ComponentModel.Win32Exception or UnauthorizedAccessException or SecurityException)
        { return new(0, 0, null, error.GetType().Name); }
    }
    private static string Canonical(string value) => Path.GetFullPath(value.StartsWith("\\\\?\\", StringComparison.Ordinal) ? value[4..] : value).Replace('/', '\\').TrimEnd('\\');
    private static string? TryCanonical(string value) { try { return Canonical(value); } catch (Exception error) when (error is ArgumentException or NotSupportedException or PathTooLongException) { return null; } }
    [GeneratedRegex(@"^[0-9a-f]{64}\\codex_status_tray\.exe$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)] private static partial Regex CacheSuffix();
    [GeneratedRegex(@"^local-codex-tools\.codex-status-\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?\\bin\\win-(?:x64|arm64)\\codex_status_tray\.exe$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)] private static partial Regex ExtensionSuffix();
}

internal sealed class RegistryIconHistoryStore : IIconHistoryStore
{
    private const string Root = @"Control Panel\NotifyIconSettings";
    public IEnumerable<IconHistoryEntry> Read()
    {
        using var root = Registry.CurrentUser.OpenSubKey(Root);
        if (root is null) yield break;
        foreach (var name in root.GetSubKeyNames())
        {
            using var key = root.OpenSubKey(name);
            if (key is null || key.SubKeyCount != 0 || key.GetValue("ExecutablePath", null, RegistryValueOptions.DoNotExpandEnvironmentNames) is not string path) continue;
            var values = new Dictionary<string, IconHistoryValue>();
            foreach (var valueName in key.GetValueNames())
                if (key.GetValue(valueName, null, RegistryValueOptions.DoNotExpandEnvironmentNames) is { } value) values[valueName] = new(key.GetValueKind(valueName), value);
            yield return new(name, path, values);
        }
    }
    public bool DeleteIfUnchanged(IconHistoryEntry entry)
    {
        using var root = Registry.CurrentUser.OpenSubKey(Root, writable: true);
        if (root is null) return false;
        using (var key = root.OpenSubKey(entry.Key))
        {
            if (key is null || key.SubKeyCount != 0 || key.GetValueNames().Length != entry.Values.Count) return false;
            foreach (var (name, saved) in entry.Values)
            {
                var current = key.GetValue(name, null, RegistryValueOptions.DoNotExpandEnvironmentNames);
                if (current is null || key.GetValueKind(name) != saved.Kind) return false;
                var same = saved.Value switch {
                    byte[] bytes => current is byte[] actual && bytes.SequenceEqual(actual),
                    string[] strings => current is string[] actual && strings.SequenceEqual(actual),
                    _ => saved.Value.Equals(current)
                };
                if (!same) return false;
            }
        }
        root.DeleteSubKey(entry.Key, throwOnMissingSubKey: false);
        return true;
    }
}
