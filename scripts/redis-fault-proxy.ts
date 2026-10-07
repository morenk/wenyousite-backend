/** 仅供已核验隔离 suite 使用；所有连接都固定转发到本轮 Redis。 */
import { createConnection, createServer, Server, Socket } from 'node:net';

export type RedisFault = 'pass' | 'disconnected' | 'drop-requests' | 'drop-replies';
export class RedisFaultProxy {
  private readonly sockets = new Set<Socket>();
  private readonly clients = new Set<Socket>();
  private readonly droppedReplies = new Set<Socket>();
  private readonly server: Server;
  private fault: RedisFault = 'pass';
  port = 0;

  constructor(targetPort: number) {
    this.server = createServer(client => {
      if (this.fault === 'disconnected') { client.destroy(); return; }
      this.clients.add(client);
      client.once('close', () => { this.clients.delete(client); this.droppedReplies.delete(client); });
      const upstream = createConnection({ host: '127.0.0.1', port: targetPort });
      for (const socket of [client, upstream]) {
        this.sockets.add(socket);
        socket.on('error', () => undefined);
        socket.once('close', () => this.sockets.delete(socket));
      }
      client.once('close', () => upstream.destroy());
      upstream.once('close', () => client.destroy());
      // 故障期间丢弃字节，不缓存请求供恢复后补发。
      client.on('data', data => { if (this.fault !== 'drop-requests') upstream.write(data); });
      upstream.on('data', data => { if (this.fault !== 'drop-replies' && !this.droppedReplies.has(client)) client.write(data); });
    });
  }

  async listen() {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => {
        this.server.removeListener('error', reject);
        this.port = (this.server.address() as { port: number }).port;
        resolve();
      });
    });
    return this;
  }

  setFault(fault: RedisFault) {
    this.fault = fault;
    this.droppedReplies.clear();
    if (fault === 'disconnected') this.disconnect();
  }

  dropRepliesForExistingConnections() {
    for (const client of this.clients) this.droppedReplies.add(client);
  }

  disconnect() {
    for (const socket of this.sockets) socket.destroy();
  }

  async close() {
    this.disconnect();
    await new Promise<void>((resolve, reject) => this.server.close(error => error ? reject(error) : resolve()));
  }
}
