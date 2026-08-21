export interface RedisSetOptions {
  ttlSeconds?: number;
  onlyIfAbsent?: boolean;
}

export interface RedisQueueOptions {
  timeoutMs?: number;
}

export interface RedisMessageHandler {
  (message: string, channel: string): void | Promise<void>;
}

export interface RedisUnsubscribe {
  (): Promise<void>;
}

export interface RedisOperations {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: RedisSetOptions): Promise<void>;
  del(key: string): Promise<boolean>;
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string, handler: RedisMessageHandler): Promise<RedisUnsubscribe>;
  enqueue(queue: string, value: string): Promise<number>;
  dequeue(queue: string, options?: RedisQueueOptions): Promise<string | null>;
}

export interface RedisAdapter extends RedisOperations {}

export class InjectedRedisAdapter implements RedisAdapter {
  public constructor(private readonly operations: RedisOperations) {}

  public get(key: string): Promise<string | null> { return this.operations.get(key); }
  public set(key: string, value: string, options?: RedisSetOptions): Promise<void> { return this.operations.set(key, value, options); }
  public del(key: string): Promise<boolean> { return this.operations.del(key); }
  public publish(channel: string, message: string): Promise<number> { return this.operations.publish(channel, message); }
  public subscribe(channel: string, handler: RedisMessageHandler): Promise<RedisUnsubscribe> { return this.operations.subscribe(channel, handler); }
  public enqueue(queue: string, value: string): Promise<number> { return this.operations.enqueue(queue, value); }
  public dequeue(queue: string, options?: RedisQueueOptions): Promise<string | null> { return this.operations.dequeue(queue, options); }
}

export function createRedisAdapter(operations: RedisOperations): RedisAdapter {
  return new InjectedRedisAdapter(operations);
}
