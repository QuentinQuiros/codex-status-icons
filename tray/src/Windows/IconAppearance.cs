using System.Text.Json;
using Microsoft.Win32;
using CodexStatusTray.Core;

namespace CodexStatusTray.Windows;

public enum IconStyle { Flat, Rounded, Minimal }
public enum IconSize { Small, Medium, Large }

public static class IconSizes
{
    public static readonly IconSize[] All = [IconSize.Small, IconSize.Medium, IconSize.Large];
    public static string Id(IconSize size) => size.ToString().ToLowerInvariant();
    public static string Name(IconSize size) => UiText.Get("size." + Id(size));
    public static bool TryParse(string? value, out IconSize size)
    {
        foreach (var candidate in All) if (value == Id(candidate)) { size = candidate; return true; }
        size = IconSize.Small; return false;
    }
}

public static class IconStyles
{
    public static readonly IconStyle[] All = [IconStyle.Flat, IconStyle.Rounded, IconStyle.Minimal];
    public static string Id(IconStyle style) => style.ToString().ToLowerInvariant();
    public static string Name(IconStyle style) => UiText.Get("style." + Id(style));
    public static bool TryParse(string? value, out IconStyle style)
    {
        foreach (var candidate in All) if (value == Id(candidate)) { style = candidate; return true; }
        style = IconStyle.Flat; return false;
    }
    public static bool LightTaskbar()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
            return key?.GetValue("SystemUsesLightTheme") is int value && value == 1;
        }
        catch (Exception error) when (error is System.Security.SecurityException or IOException or UnauthorizedAccessException) { return false; }
    }
}

public sealed class IconAppearance
{
    private readonly string filename;
    public IconStyle Style { get; private set; } = IconStyle.Flat;
    public IconSize Size { get; private set; } = IconSize.Small;
    public IconAppearance(string? filename = null, string? legacyFilename = null)
    {
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        this.filename = filename ?? Path.Combine(local, "codex-status", "appearance.json");
        legacyFilename ??= filename is null ? Path.Combine(local, "Packages", "OpenAI.Codex_2p2nqsd0c76g0", "LocalCache", "Local", "codex-status", "appearance.json") : null;
        try
        {
            var source = !File.Exists(this.filename) && legacyFilename is not null && File.Exists(legacyFilename) ? legacyFilename : this.filename;
            if (new FileInfo(source).Length > 4096) return;
            using var document = JsonDocument.Parse(File.ReadAllText(source));
            if (document.RootElement.ValueKind != JsonValueKind.Object ||
                !document.RootElement.TryGetProperty("version", out var version) || version.ValueKind != JsonValueKind.Number || !version.TryGetInt32(out var number) || number != 1) return;
            if (document.RootElement.TryGetProperty("style", out var style) && style.ValueKind == JsonValueKind.String && IconStyles.TryParse(style.GetString(), out var parsed)) Style = parsed;
            if (document.RootElement.TryGetProperty("size", out var size) && size.ValueKind == JsonValueKind.String && IconSizes.TryParse(size.GetString(), out var parsedSize)) Size = parsedSize;
            // A move from a desktop-package launch to VS Code must keep the
            // user's style and size, without replacing an existing preference.
            if (source != this.filename) Save(overwrite: false);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException) { /* missing or invalid preference uses the modern default */ }
    }
    public bool Select(IconStyle style)
    {
        if (!IconStyles.All.Contains(style)) return false;
        Style = style;
        return Save();
    }
    public bool SelectSize(IconSize size)
    {
        if (!IconSizes.All.Contains(size)) return false;
        Size = size;
        return Save();
    }
    private bool Save(bool overwrite = true)
    {
        var temporary = filename + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(filename))!);
            File.WriteAllText(temporary, JsonSerializer.Serialize(new { version = 1, style = IconStyles.Id(Style), size = IconSizes.Id(Size) }));
            File.Move(temporary, filename, overwrite);
            return true;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { return false; }
        finally
        {
            try { if (File.Exists(temporary)) File.Delete(temporary); }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException) { /* leave the selected style active for this session */ }
        }
    }
}
