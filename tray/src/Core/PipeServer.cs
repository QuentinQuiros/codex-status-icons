using System.Collections.Concurrent;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
using System.Text;

namespace CodexStatusTray.Core;
public sealed class PipeConnection(NamedPipeServerStream stream, uint clientPid) : IDisposable
{
    private readonly SemaphoreSlim writeLock = new(1, 1);
    public Guid Id { get; } = Guid.NewGuid();
    public uint ClientPid { get; } = clientPid;
    public async Task SendAsync(object message, CancellationToken cancellationToken = default)
    {
        var bytes = Encoding.UTF8.GetBytes(Protocol.Serialize(message));
        if (bytes.Length > Protocol.MaxFrameBytes) throw new InvalidDataException("frame_too_large");
        await writeLock.WaitAsync(cancellationToken);
        try { await stream.WriteAsync(bytes, cancellationToken); await stream.FlushAsync(cancellationToken); }
        finally { writeLock.Release(); }
    }
    public void Dispose() => stream.Dispose();
}

public sealed class PipeServer(string pipeName) : IAsyncDisposable
{
    private readonly CancellationTokenSource cancellation = new();
    private readonly ConcurrentDictionary<Guid, PipeConnection> connections = new();
    private readonly ConcurrentDictionary<Guid, Task> workers = new();
    private Task? listener;
    public event Action<PipeConnection, ClientMessage>? MessageReceived;
    public event Action<Guid>? Disconnected;
    public void Start() => listener ??= Task.Run(ListenAsync);
    public void Disconnect(Guid connectionId) { if (connections.TryGetValue(connectionId, out var connection)) connection.Dispose(); }
    public async Task SendAsync(Guid connectionId, object message)
    {
        if (!connections.TryGetValue(connectionId, out var connection)) return;
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation.Token);
        deadline.CancelAfter(TimeSpan.FromSeconds(2));
        try { await connection.SendAsync(message, deadline.Token); }
        catch (Exception error) when (error is IOException or OperationCanceledException or ObjectDisposedException) { connection.Dispose(); }
    }
    public async Task BroadcastAsync(object message) => await Task.WhenAll(connections.Keys.Select(id => SendAsync(id, message)));
    private async Task ListenAsync()
    {
        while (!cancellation.IsCancellationRequested)
        {
            NamedPipeServerStream? stream = null;
            try
            {
                stream = new NamedPipeServerStream(pipeName, PipeDirection.InOut, 64, PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly, 16384, 16384);
                await stream.WaitForConnectionAsync(cancellation.Token);
                GetNamedPipeClientProcessId(stream.SafePipeHandle, out var pid);
                var connection = new PipeConnection(stream, pid);
                connections[connection.Id] = connection;
                var worker = ServeAsync(stream, connection);
                workers[connection.Id] = worker;
                _ = worker.ContinueWith(_ => { workers.TryRemove(connection.Id, out var removed); }, TaskScheduler.Default);
                stream = null;
            }
            catch (OperationCanceledException) { break; }
            catch (IOException) { try { await Task.Delay(1000, cancellation.Token); } catch (OperationCanceledException) { break; } }
            finally { stream?.Dispose(); }
        }
    }
    private async Task ServeAsync(NamedPipeServerStream stream, PipeConnection connection)
    {
        var pending = new List<byte>();
        var buffer = new byte[4096];
        var registered = false;
        string? workspaceId = null;
        try
        {
            using var handshake = CancellationTokenSource.CreateLinkedTokenSource(cancellation.Token);
            handshake.CancelAfter(TimeSpan.FromSeconds(5));
            while (!cancellation.IsCancellationRequested)
            {
                var count = await stream.ReadAsync(buffer, registered ? cancellation.Token : handshake.Token);
                if (count == 0) break;
                for (var i = 0; i < count; i++)
                {
                    if (buffer[i] != 10)
                    {
                        if (pending.Count >= Protocol.MaxFrameBytes) return;
                        pending.Add(buffer[i]); continue;
                    }
                    var message = Protocol.Parse(Encoding.UTF8.GetString(pending.ToArray())); pending.Clear();
                    if (message is null || (!registered && message.Type != "hello")) return;
                    var claimed = message.Workspace?.WorkspaceId ?? message.WorkspaceId;
                    if (registered && claimed != workspaceId) return;
                    registered = true; workspaceId = claimed;
                    MessageReceived?.Invoke(connection, message);
                    if (message.Type == "disconnect") return;
                }
            }
        }
        catch (Exception error) when (error is IOException or OperationCanceledException or ObjectDisposedException) { /* disconnected peer */ }
        finally { connections.TryRemove(connection.Id, out _); connection.Dispose(); Disconnected?.Invoke(connection.Id); }
    }
    public async ValueTask DisposeAsync()
    {
        await cancellation.CancelAsync();
        foreach (var connection in connections.Values) connection.Dispose();
        if (listener is not null) await listener;
        await Task.WhenAll(workers.Values.ToArray()); cancellation.Dispose();
    }
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetNamedPipeClientProcessId(SafePipeHandle pipe, out uint clientPid);
}
