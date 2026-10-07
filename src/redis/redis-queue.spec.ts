import { EventEmitter } from 'node:events';
import { Job, RedisConnection, Worker } from 'bullmq';
import Redis, { Command } from 'ioredis';
import { BoundedRedisQueue, ReconnectRedisWorker } from './redis-queue';

class ConnectionFixture extends EventEmitter {
  static instances: ConnectionFixture[] = [];
  static failNext = false;
  status = 'initializing';
  redisVersion = '7.4.0';
  databaseType = 'redis';
  raw = {
    status: 'ready',
    hset: jest.fn().mockResolvedValue(1),
    runCommand: jest.fn().mockResolvedValue('waiting'),
  };
  client: Promise<unknown>;
  constructor() {
    super();
    ConnectionFixture.instances.push(this);
    const fail = ConnectionFixture.failNext;
    ConnectionFixture.failNext = false;
    this.client = Promise.resolve().then(() => {
      if (fail) throw new Error('private-init-failure');
      this.status = 'ready';
      return new Proxy(this.raw, {
        get: (target, key) =>
          typeof key === 'string' && key.startsWith('getState')
            ? async () => 'waiting'
            : Reflect.get(target, key),
      });
    });
  }
  async close() {
    this.status = 'closed';
    this.raw.status = 'end';
  }
}
const connection = { host: 'example.invalid', port: 12345, db: 0 };
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

describe('BullMQ locked-version queue compatibility', () => {
  beforeEach(() => {
    ConnectionFixture.instances = [];
    ConnectionFixture.failNext = false;
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });
  const queue = () =>
    new BoundedRedisQueue(
      'fixture',
      { connection },
      ConnectionFixture as unknown as typeof RedisConnection,
    );

  it('真实 Queue/Scripts 构造不读取并缓存未就绪 client，恢复后读取动态连接', async () => {
    const target = queue();
    await expect(target.getJobCounts()).rejects.toThrow('Redis queue unavailable');
    await flush();
    await expect(target.scripts.getState('job')).resolves.toBe('waiting');
    ConnectionFixture.instances[0].raw.status = 'reconnecting';
    await expect(target.scripts.getState('job')).rejects.toThrow('Redis queue unavailable');
    ConnectionFixture.instances[0].raw.status = 'ready';
    await expect(target.scripts.getState('job')).resolves.toBe('waiting');
    await target.close();
  });

  it('首次 INFO 初始化失败仅重建一个连接，既有 Scripts 随新连接恢复', async () => {
    ConnectionFixture.failNext = true;
    const target = queue();
    await flush();
    expect(ConnectionFixture.instances[0].status).toBe('closed');
    await expect(target.scripts.getState('job')).rejects.toThrow('Redis queue unavailable');
    await jest.advanceTimersByTimeAsync(1000);
    expect(ConnectionFixture.instances).toHaveLength(2);
    await expect(target.scripts.getState('job')).resolves.toBe('waiting');
    await target.close();
  });

  it('关闭期间不再重建失败的初始化连接', async () => {
    ConnectionFixture.failNext = true;
    const target = queue();
    await flush();
    await target.close();
    await jest.advanceTimersByTimeAsync(5000);
    expect(ConnectionFixture.instances).toHaveLength(1);
    await expect(target.client).rejects.toThrow('Redis queue unavailable');
  });
});

class WorkerCompletionProbe extends ReconnectRedisWorker {
  confirm(job: Job) { return this.handleCompleted(undefined, job, 'fixture-token'); }
}

describe('Worker 关闭故障边界', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  function worker(status = 'ready') {
    const primary = {
      status,
      sendCommand: jest.fn((command: Command) => {
        command.resolve('PONG');
        return command.promise;
      }),
      disconnect: jest.fn(),
    };
    const blocking = { disconnect: jest.fn() };
    const target = Object.create(WorkerCompletionProbe.prototype) as WorkerCompletionProbe;
    const connection = { closing: false, close: jest.fn(async () => { connection.closing = true; }) };
    Object.assign(target, {
      primary, connection,
      owned: new Set([primary, blocking] as unknown as Redis[]),
    });
    return { target, primary, blocking, connection };
  }

  it('健康主连接不因处理器耗时而提前断开，并且仅探测非阻塞连接', async () => {
    let release!: () => void;
    jest.spyOn(Worker.prototype, 'close').mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const { target, primary, blocking } = worker();
    const closing = target.close();
    await flush();
    expect(primary.sendCommand).toHaveBeenCalledWith(expect.objectContaining({ name: 'ping' }));
    expect(primary.disconnect).not.toHaveBeenCalled();
    expect(blocking.disconnect).not.toHaveBeenCalled();
    release();
    await closing;
    expect(primary.disconnect).toHaveBeenCalledTimes(1);
    expect(blocking.disconnect).toHaveBeenCalledTimes(1);
  });

  it('原主连接故障会断开自有副本，但仍等待标准 close 和正在执行的处理器', async () => {
    let release!: () => void;
    const standard = jest.spyOn(Worker.prototype, 'close').mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const { target, primary, blocking, connection } = worker();
    primary.disconnect.mockImplementation(() => { expect(connection.closing).toBe(true); });
    primary.sendCommand.mockImplementation((command: Command) => {
      command.reject(new Error('private-fixture'));
      return command.promise;
    });
    let finished = false;
    const closing = target.close().then(() => {
      finished = true;
    });
    await flush();
    expect(primary.disconnect).toHaveBeenCalledTimes(1);
    expect(blocking.disconnect).toHaveBeenCalledTimes(1);
    expect(standard).toHaveBeenCalledWith(false);
    expect(connection.close).toHaveBeenCalledWith(true);
    const job = { moveToCompleted: jest.fn() };
    await target.confirm(job as unknown as Job);
    expect(job.moveToCompleted).not.toHaveBeenCalled();
    expect(finished).toBe(false);
    release();
    await closing;
  });

  it('关闭首轮探测成功后 Redis 才故障仍会释放连接，并清理监测定时器', async () => {
    jest.useFakeTimers();
    let release!: () => void;
    jest.spyOn(Worker.prototype, 'close').mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const { target, primary } = worker();
    let finished = false;
    const closing = target.close().then(() => {
      finished = true;
    });
    await flush();
    expect(primary.disconnect).not.toHaveBeenCalled();
    primary.sendCommand.mockImplementation((command: Command) => {
      command.reject(new Error('late-fixture'));
      return command.promise;
    });
    await jest.advanceTimersByTimeAsync(1000);
    expect(primary.sendCommand).toHaveBeenCalledTimes(2);
    expect(primary.disconnect).toHaveBeenCalledTimes(1);
    expect(finished).toBe(false);
    release();
    await closing;
    expect(jest.getTimerCount()).toBe(0);
  });

  it('未就绪连接不积压探测命令，重复关闭只执行一次标准关闭', async () => {
    const standard = jest.spyOn(Worker.prototype, 'close').mockResolvedValue(undefined);
    const { target, primary } = worker('reconnecting');
    await Promise.all([target.close(), target.close()]);
    expect(primary.sendCommand).not.toHaveBeenCalled();
    expect(primary.disconnect).toHaveBeenCalled();
    expect(standard).toHaveBeenCalledTimes(1);
  });
});
