using System.Security.Principal;
using System.Security.Cryptography;
using System.Text;
namespace CodexStatusTray.Core;
public sealed class SingletonGuard : IDisposable
{
    private readonly Mutex mutex;
    public bool Acquired { get; }
    public SingletonGuard(string discriminator)
    {
        var sid = WindowsIdentity.GetCurrent().User?.Value ?? Environment.UserName;
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(sid + discriminator)))[..24];
        mutex = new Mutex(true, $"Global\\codex_status_{hash}", out var created);
        Acquired = created;
    }
    public void Dispose() { if (Acquired) mutex.ReleaseMutex(); mutex.Dispose(); }
}
