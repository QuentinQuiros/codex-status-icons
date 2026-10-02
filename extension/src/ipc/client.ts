import { createConnection as create_connection, type Socket } from 'node:net';
import { randomUUID as random_uuid } from 'node:crypto';
import {
  FrameDecoder,
  parse_server_message,
  serialize_message,
  type ClientMessage,
  type ServerMessage,
} from './protocol';
export interface IpcOptions {
  pipe_path: string;
  make_message: (type: 'hello' | 'heartbeat' | 'update') => ClientMessage;
  on_message: (message: ServerMessage) => void;
  start_tray: () => Promise<void>;
  heartbeat_ms?: number;
  reconnect_ms?: number;
}
export class IpcClient {
  private socket: Socket | undefined;
  private reconnect_timer: NodeJS.Timeout | undefined;
  private heartbeat_timer: NodeJS.Timeout | undefined;
  private attempt = 0;
  private stopped = true;
  private suspended = false;
  private last_receive = 0;
  constructor(private readonly options: IpcOptions) {}
  start(): void {
    this.stopped = false;
    this.suspended = false;
    this.connect();
  }
  restart(): void {
    this.stop();
    this.start();
  }
  send_update(): void {
    this.send(this.options.make_message('update'));
  }
  send(message: ClientMessage): void {
    if (this.socket?.writable) {
      try {
        if (this.socket.writableLength > 65536) this.socket.destroy();
        else this.socket.write(serialize_message(message));
      } catch {
        this.socket.destroy();
      }
    }
  }
  stop(): void {
    this.stopped = true;
    if (this.reconnect_timer) clearTimeout(this.reconnect_timer);
    if (this.heartbeat_timer) clearInterval(this.heartbeat_timer);
    this.socket?.destroy();
    this.socket = undefined;
  }
  private connect(): void {
    if (this.stopped || this.suspended) return;
    const socket = create_connection(this.options.pipe_path);
    this.socket = socket;
    const decoder = new FrameDecoder();
    const connect_timeout = setTimeout(() => socket.destroy(), 3000);
    socket.on('connect', () => {
      clearTimeout(connect_timeout);
      this.attempt = 0;
      this.last_receive = Date.now();
      this.send(this.options.make_message('hello'));
      this.heartbeat_timer = setInterval(() => {
        if (Date.now() - this.last_receive > 35000) socket.destroy();
        else this.send(this.options.make_message('heartbeat'));
      }, this.options.heartbeat_ms ?? 10000);
    });
    socket.on('data', (chunk: Buffer) => {
      try {
        for (const line of decoder.push(chunk)) {
          const message = parse_server_message(line);
          if (!message) continue;
          this.last_receive = Date.now();
          if (message.type === 'shutdown' && message.reason === 'user_exit') this.suspended = true;
          this.options.on_message(message);
        }
      } catch {
        socket.destroy();
      }
    });
    socket.on('error', () => {
      /* handled through reconnect */
    });
    socket.on('close', () => {
      clearTimeout(connect_timeout);
      if (this.heartbeat_timer) clearInterval(this.heartbeat_timer);
      if (this.stopped || this.suspended || this.socket !== socket) return;
      this.socket = undefined;
      const delay =
        Math.min(15000, (this.options.reconnect_ms ?? 500) * 2 ** Math.min(this.attempt++, 5)) +
        Math.floor(Math.random() * 150);
      this.reconnect_timer = setTimeout(() => {
        void this.options
          .start_tray()
          .catch(() => undefined)
          .finally(() => this.connect());
      }, delay);
    });
  }
}
export function focus_result(workspace_id: string, focused: boolean): ClientMessage {
  return { version: 1, type: 'focus_result', request_id: random_uuid(), workspace_id, focused };
}
