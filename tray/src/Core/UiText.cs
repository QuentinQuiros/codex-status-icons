using System.Globalization;
using System.Text.Json;

namespace CodexStatusTray.Core;

public static class UiText
{
    public static readonly string[] Preferences = ["auto", "fr", "en"];
    private static readonly Dictionary<string, Dictionary<string, string>> Catalogs = new() { ["en"] = Load("en"), ["fr"] = Load("fr") };
    public static string Preference { get; private set; } = "auto";
    public static string Code => Resolve(Preference, CultureInfo.CurrentUICulture.Name);
    public static bool ValidPreference(string? value) => Preferences.Contains(value);
    public static string Resolve(string preference, string systemLanguage) => preference is "fr" or "en" ? preference : systemLanguage.Equals("fr", StringComparison.OrdinalIgnoreCase) || systemLanguage.StartsWith("fr-", StringComparison.OrdinalIgnoreCase) ? "fr" : "en";
    public static bool Select(string preference)
    {
        if (!ValidPreference(preference)) return false;
        var changed = Preference != preference;
        Preference = preference;
        return changed;
    }
    public static string Get(string key, params object[] values) => For(Code, key, values);
    public static string For(string code, string key, params object[] values) => string.Format(CultureInfo.CurrentCulture, Catalogs[code][key], values);
    public static IReadOnlyDictionary<string, string> Catalog(string code) => Catalogs[code];
    private static Dictionary<string, string> Load(string code)
    {
        using var stream = typeof(UiText).Assembly.GetManifestResourceStream($"CodexStatusTray.Locales.{code}.json") ?? throw new InvalidDataException("missing_translation_catalog");
        return JsonSerializer.Deserialize<Dictionary<string, string>>(stream) ?? throw new InvalidDataException("invalid_translation_catalog");
    }
}
