import { Logger } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import Redis, { Command, RedisOptions } from 'ioredis';
import {
  Queue,
  QueueOptions,
  RedisClient,
  RedisConnection,
  Scripts,
  Worker,
  WorkerOptions,
  Processor,
} from 'bullmq';
import { RedisConnectionOptions } from './redis-connection';
import { REDIS_COMMAND_TIMEOUT_MS, redisRequestOptions } from './redis-client-policy';

/** 只在连接初始化完成后允许业务命令进入 BullMQ；离线调用不会等待后再迟到入队。 */
export class BoundedRedisQueue extends Queue {
  private readonly logger = new Logger(BoundedRedisQueue.name);
  private reconnectTimer?: NodeJS.Timeout;
  private stopping = false;

  constructor(
    name: string,
    options: QueueOptions,
    private readonly Connection = RedisConnection,
  ) {
    super(
      name,
      { ...options, connection: redisRequestOptions(options.connection as RedisConnectionOptions) },
      Connection,
    );
    this.on('error', () => undefined);
    this.observeInitialization(this.connection);
  }

  protected override createScripts(): void {
    // BullMQ 默认工厂会快照 client Promise；保留动态 getter，连接恢复不复用旧拒绝。
    this.scripts = new Scripts(this);
  }

  override get client(): Promise<RedisClient> {
    if (this.stopping || this.connection.status !== 'ready') {
      return Promise.reject(new Error('Redis queue unavailable'));
    }
    return super.client.then((client) => {
      if (client.status !== 'ready') throw new Error('Redis queue unavailable');
      return client;
    });
  }

  private observeInitialization(connection: RedisConnection): void {
    void connection.client
      .then(
        (client) => {
          if (this.stopping || this.connection !== connection) return;
          // Queue 构造期的 waitUntilReady 已经快速拒绝；在准备完成后补既有幂等元数据。
          if (!this.opts.skipMetasUpdate)
            void client.hset(this.keys.meta, this.metaValues).catch(() => undefined);
        },
        () => this.replaceFailedInitialization(connection),
      )
      .catch(() => {
        // 关闭失败时停止重建，避免未回收连接和未处理拒绝；不记录原异常。
        this.logger.warn('队列连接初始化或回收失败');
      });
  }

  private async replaceFailedInitialization(connection: RedisConnection): Promise<void> {
    await connection.close(true);
    if (this.stopping || this.connection !== connection) return;
    // BullMQ 的 initializing Promise 不会在失败后复位；重建仅处理连接/INFO，不重发业务命令。
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.stopping) return;
      try {
        const replacement = new this.Connection(this.opts.connection, { blocking: false });
        replacement.on('error', () => undefined);
        this.connection = replacement;
        this.observeInitialization(replacement);
      } catch {
        this.logger.warn('队列连接重建失败');
      }
    }, 1000);
  }

  override async close(): Promise<void> {
    this.stopping = true;
    clearTimeout(this.reconnectTimer);
    await this.connection.close(true);
    await super.close();
  }
}

/** 只登记本 Worker 创建的连接；BullMQ 通过公开 duplicate() 创建阻塞副本。 */
class OwnedWorkerRedis extends Redis {
  constructor(
    options: RedisOptions,
    private readonly owned: Set<Redis>,
  ) {
    super(options);
    owned.add(this);
    this.on('error', () => undefined);
  }

  override duplicate(override?: Partial<RedisOptions>): Redis {
    return new OwnedWorkerRedis({ ...this.options, ...override }, this.owned);
  }
}

/** Nest 从 Queue.opts 继承参数；阻塞消费必须显式移除生产者的一秒命令预算。 */
export class ReconnectRedisWorker<
  T = unknown,
  R = unknown,
  N extends string = string,
> extends Worker<T, R, N> {
  private readonly owned: Set<Redis>;
  private readonly primary: Redis;
  private closingOwned?: Promise<void>;

  constructor(
    name: string,
    processor: Processor<T, R, N> | string | URL | null,
    options: WorkerOptions,
  ) {
    const connection = options.connection as RedisConnectionOptions;
    const probeConnection = {
      host: connection.host,
      port: connection.port,
      db: connection.db,
      username: connection.username,
      password: connection.password,
    };
    const owned = new Set<Redis>();
    const client = new OwnedWorkerRedis(
      {
        ...probeConnection,
        maxRetriesPerRequest: null,
        retryStrategy: (times) => Math.min(times * 100, 1000),
      },
      owned,
    );
    try {
      super(name, processor, { ...options, connection: client });
    } catch (error) {
      for (const socket of owned) socket.disconnect();
      throw error;
    }
    this.owned = owned;
    this.primary = client;
    this.on('error', () => undefined);
  }

  override close(force = false): Promise<void> {
    this.closingOwned ??= this.closeOwned(force);
    return this.closingOwned;
  }

  private async closeOwned(force: boolean): Promise<void> {
    let finished = false;
    let timer: NodeJS.Timeout | undefined;
    let wake: (() => void) | undefined;
    const disconnect = () => {
      for (const socket of this.owned) socket.disconnect();
    };
    const stopRedis = async () => {
      // BullMQ 以 connection.closing 决定是否继续 ACK；只断 socket 会让关闭期 ConnectionError 无限重试。
      const closed = this.connection.close(true);
      disconnect();
      await closed;
    };
    const stopMonitoring = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      wake?.();
      // 关闭已完成，可取消尚在进行的只读探测；主连接由本类拥有而非 BullMQ 共享回收。
      disconnect();
    };
    // 立即停止领取新任务；不以超时放弃正在执行的处理器。
    const closing = super.close(force).finally(stopMonitoring);
    const monitor = async () => {
      if (force) {
        await stopRedis();
        return;
      }
      while (!finished) {
        try {
          // 检测用于 ACK 的非阻塞主连接，不在 BZPOPMIN 副本后面排队。
          if (this.primary.status !== 'ready') throw new Error('Redis worker unavailable');
          const ping = new Command('ping');
          ping.setTimeout(REDIS_COMMAND_TIMEOUT_MS);
          await this.primary.sendCommand(ping);
        } catch {
          if (!finished) await stopRedis();
          return;
        }
        if (finished) return;
        // 健康慢处理器可能等待很久；串行复查覆盖首次 PING 后才发生的断连。
        await new Promise<void>((resolve) => {
          wake = resolve;
          timer = setTimeout(resolve, REDIS_COMMAND_TIMEOUT_MS);
        });
        clearTimeout(timer);
        wake = undefined;
      }
    };
    const results = await Promise.allSettled([closing, monitor()]);
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }
}

export function configureRedisQueues(): void {
  BullModule.queueClass = BoundedRedisQueue;
  BullModule.workerClass = ReconnectRedisWorker;
}
