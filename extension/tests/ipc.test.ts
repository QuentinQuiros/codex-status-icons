import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as create_server, type Server } from 'node:net';
import { randomUUID as random_uuid } from 'node:crypto';
import { IpcClient } from '../src/ipc/client';
import { create_workspace } from '../src/workspace';
import { unknown_snapshot } from '../src/state';
const wait_until = async (condition: () => boolean, timeout_ms = 5000): Promise<void> => {
  const end = Date.now() + timeout_ms;
  while (!condition()) {
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
};
const close_server = async (server: Server): Promise<void> =>
  new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

test('Named Pipe client reconnects after server restart and sends hello/heartbeat', async () => {
  const pipe_path = `\\\\.\\pipe\\codex_status_test_${random_uuid()}`;
  const received: string[] = [];
  let launches = 0;
  const serve = (): Server =>
    create_server((socket) => {
      socket.on('data', (chunk) => {
        received.push(chunk.toString());
        socket.write('{"version":1,"type":"welcome","server_pid":1}\n');
      });
    });
  let server = serve();
  await new Promise<void>((resolve) => server.listen(pipe_path, resolve));
  const workspace = create_workspace('A', ['C:/A']);
  const client = new IpcClient({
    pipe_path,
    heartbeat_ms: 100,
    reconnect_ms: 50,
    make_message: (type) => ({
      version: 1,
      type,
      workspace,
      snapshot: unknown_snapshot('test'),
      timestamp: new Date().toISOString(),
      window_focused: false,
      show_working_duration: true,
      pinned_session: false,
    }),
    on_message: () => undefined,
    start_tray: async () => {
      launches++;
    },
  });
  try {
    client.start();
    await wait_until(() => received.some((line) => line.includes('heartbeat')));
    // Close all sockets by stopping the client, then simulate unexpected server failure on the next connection.
    client.stop();
    await close_server(server);
    server = serve();
    await new Promise<void>((resolve) => server.listen(pipe_path, resolve));
    client.start();
    await wait_until(() => received.filter((line) => line.includes('hello')).length >= 2);
    server.close();
    server.getConnections((_, count) => {
      assert.equal(count, 1);
    });
    // Destroy server peers and start it anew while the client remains running.
    const sockets: import('node:net').Socket[] = [];
    client.stop();
    await close_server(server).catch(() => undefined);
    server = create_server((socket) => {
      sockets.push(socket);
      socket.on('data', (chunk) => {
        received.push(chunk.toString());
        socket.write('{"version":1,"type":"welcome","server_pid":1}\n');
      });
    });
    await new Promise<void>((resolve) => server.listen(pipe_path, resolve));
    client.start();
    await wait_until(() => sockets.length > 0);
    sockets[0]?.destroy();
    await wait_until(() => launches > 0 && sockets.length > 1);
    assert.ok(received.some((line) => line.includes('hello')));
    for (const socket of sockets) socket.destroy();
  } finally {
    client.stop();
    await close_server(server).catch(() => undefined);
  }
});
test('explicit user exit suspends automatic relaunch', async () => {
  const pipe_path = `\\\\.\\pipe\\codex_status_test_${random_uuid()}`;
  let launches = 0;
  const workspace = create_workspace('A', ['C:/A']);
  const server = create_server((socket) => {
    socket.resume();
    socket.end('{"version":1,"type":"shutdown","reason":"user_exit"}\n');
  });
  await new Promise<void>((resolve) => server.listen(pipe_path, resolve));
  const client = new IpcClient({
    pipe_path,
    reconnect_ms: 20,
    make_message: (type) => ({
      version: 1,
      type,
      workspace,
      snapshot: unknown_snapshot('test'),
      timestamp: new Date().toISOString(),
      window_focused: false,
      show_working_duration: true,
      pinned_session: false,
    }),
    on_message: () => undefined,
    start_tray: async () => {
      launches++;
    },
  });
  try {
    client.start();
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(launches, 0);
  } finally {
    client.stop();
    await close_server(server);
  }
});
