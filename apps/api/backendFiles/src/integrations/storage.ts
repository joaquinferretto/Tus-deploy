import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface StoragePutInput {
  key: string;
  data: Uint8Array | ArrayBuffer | string;
  contentType?: string;
  metadata?: Readonly<Record<string, string>>;
}

export interface StorageObject {
  key: string;
  data: Uint8Array;
  contentType?: string;
  metadata: Record<string, string>;
}

export interface SignedUrlOptions {
  expiresInSeconds?: number;
}

export interface StorageAdapter {
  put(input: StoragePutInput): Promise<void>;
  get(key: string): Promise<StorageObject | null>;
  delete(key: string): Promise<void>;
  createSignedUrl(key: string, options?: SignedUrlOptions): Promise<string>;
}

function toBytes(data: StoragePutInput['data']): Uint8Array {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data);
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT';
}

export class LocalFilesystemStorageAdapter implements StorageAdapter {
  private readonly root: string;

  public constructor(rootDirectory: string) {
    this.root = resolve(rootDirectory);
  }

  private pathFor(key: string): string {
    const target = resolve(this.root, key.replaceAll('\\', '/'));
    const outsideRoot = relative(this.root, target);
    if (isAbsolute(outsideRoot) || outsideRoot === '..' || outsideRoot.startsWith(`..${'/'}`) || outsideRoot.startsWith(`..${'\\'}`)) throw new Error('Storage key escapes the configured root');
    return target;
  }

  private metadataPathFor(key: string): string {
    return `${this.pathFor(key)}.metadata.json`;
  }

  public async put(input: StoragePutInput): Promise<void> {
    const path = this.pathFor(input.key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, toBytes(input.data));
    const metadata = { contentType: input.contentType, values: input.metadata ?? {} };
    await writeFile(this.metadataPathFor(input.key), JSON.stringify(metadata), 'utf8');
  }

  public async get(key: string): Promise<StorageObject | null> {
    const path = this.pathFor(key);
    try {
      const data = new Uint8Array(await readFile(path));
      let contentType: string | undefined;
      let metadata: Record<string, string> = {};
      try {
        const raw = JSON.parse(await readFile(this.metadataPathFor(key), 'utf8')) as { contentType?: unknown; values?: unknown };
        contentType = typeof raw.contentType === 'string' ? raw.contentType : undefined;
        if (typeof raw.values === 'object' && raw.values !== null) metadata = Object.fromEntries(Object.entries(raw.values).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      return { key, data, contentType, metadata };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  public async delete(key: string): Promise<void> {
    await Promise.all([unlink(this.pathFor(key)).catch((error: unknown) => { if (!isNotFound(error)) throw error; }), unlink(this.metadataPathFor(key)).catch((error: unknown) => { if (!isNotFound(error)) throw error; })]);
  }

  public async createSignedUrl(key: string, _options?: SignedUrlOptions): Promise<string> {
    return pathToFileURL(this.pathFor(key)).toString();
  }
}

export class InjectedStorageAdapter implements StorageAdapter {
  public constructor(private readonly backend: StorageAdapter) {}

  public put(input: StoragePutInput): Promise<void> { return this.backend.put(input); }
  public get(key: string): Promise<StorageObject | null> { return this.backend.get(key); }
  public delete(key: string): Promise<void> { return this.backend.delete(key); }
  public createSignedUrl(key: string, options?: SignedUrlOptions): Promise<string> { return this.backend.createSignedUrl(key, options); }
}

export function createStorageAdapter(backend: StorageAdapter): StorageAdapter {
  return new InjectedStorageAdapter(backend);
}
