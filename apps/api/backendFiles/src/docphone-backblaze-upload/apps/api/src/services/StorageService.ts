import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl as presignS3Url } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env.js';

const UPLOADS_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), 'docphone-uploads')
  : process.env.RENDER
    ? '/opt/render/project/src/uploads'
    : path.join(__dirname, '../../uploads');

export interface StoredObjectRef {
  provider: 's3' | 'local';
  bucket: string;
  key: string;
}

interface ObjectStorageAdapter {
  provider: StoredObjectRef['provider'];
  putObject(input: { buffer: Buffer; originalName: string; prefix: string }): Promise<StoredObjectRef>;
  getSignedUrl(ref: StoredObjectRef, expiresInSeconds?: number): Promise<string>;
}

class LocalDiskAdapter implements ObjectStorageAdapter {
  provider: StoredObjectRef['provider'] = 'local';
  private readonly bucket = 'local-uploads';

  private async init(): Promise<void> {
    try {
      await fs.access(UPLOADS_DIR);
    } catch {
      await fs.mkdir(UPLOADS_DIR, { recursive: true });
    }
  }

  async putObject(input: { buffer: Buffer; originalName: string; prefix: string }): Promise<StoredObjectRef> {
    await this.init();
    const extension = path.extname(input.originalName);
    const key = `${input.prefix}/${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`;
    const filePath = path.join(UPLOADS_DIR, key.replace('/', '-'));
    await fs.writeFile(filePath, input.buffer);
    return { provider: this.provider, bucket: this.bucket, key };
  }

  async getSignedUrl(ref: StoredObjectRef): Promise<string> {
    return `/uploads/${ref.key.replace('/', '-')}`;
  }
}

class S3CompatibleAdapter implements ObjectStorageAdapter {
  provider: StoredObjectRef['provider'];
  private readonly client: S3Client;

  constructor(provider: 's3', private readonly bucket: string) {
    this.provider = provider;
    this.client = new S3Client({
      region: process.env.B2_REGION || 'us-east-1',
      endpoint: process.env.B2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.B2_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.B2_SECRET_ACCESS_KEY || '',
      },
      forcePathStyle: true,
    });
  }

  async putObject(input: { buffer: Buffer; originalName: string; prefix: string }): Promise<StoredObjectRef> {
    const extension = path.extname(input.originalName);
    const key = `${input.prefix}/${Date.now()}-${crypto.randomUUID()}${extension}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: input.buffer,
        ContentType: detectContentType(input.originalName),
      }),
    );

    return { provider: this.provider, bucket: this.bucket, key };
  }

  async getSignedUrl(ref: StoredObjectRef, expiresInSeconds = 900): Promise<string> {
    return presignS3Url(
      this.client,
      new GetObjectCommand({
        Bucket: ref.bucket,
        Key: ref.key,
      }),
      { expiresIn: expiresInSeconds },
    );
  }
}

function detectContentType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.m4a') return 'audio/mp4';
  if (ext === '.ogg') return 'audio/ogg';
  return 'application/octet-stream';
}

function resolveAdapter(): ObjectStorageAdapter {
  if (env.OBJECT_STORAGE_PROVIDER === 's3' && env.OBJECT_STORAGE_BUCKET) {
    return new S3CompatibleAdapter('s3', env.OBJECT_STORAGE_BUCKET);
  }

  return new LocalDiskAdapter();
}

export class StorageService {
  private static readonly adapter = resolveAdapter();

  static async init(): Promise<void> {
    // Kept for backward compatibility with existing bootstrap flow.
    return;
  }

  static async saveObject(
    fileBuffer: Buffer,
    originalName: string,
    prefix: string
  ): Promise<StoredObjectRef> {
    return this.adapter.putObject({ buffer: fileBuffer, originalName, prefix });
  }

  static async getSignedUrl(ref: StoredObjectRef, expiresInSeconds = 600): Promise<string> {
    return this.adapter.getSignedUrl(ref, expiresInSeconds);
  }

  static getWorkerFetchUrl(ref: StoredObjectRef, signedUrl: string): string {
    if (ref.provider === 's3') {
      return signedUrl;
    }

    if (/^https?:\/\//i.test(signedUrl)) {
      return signedUrl;
    }

    const baseUrl = process.env.BACKEND_BASE_URL?.trim() || `http://127.0.0.1:${env.PORT}`;
    const localPath = `/uploads/${ref.key.replace('/', '-')}`;
    const resolvedPath = signedUrl.startsWith('/') ? signedUrl : localPath;
    return new URL(resolvedPath, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
  }

  // Compatibility path for existing flows in slice 1.
  static async saveFile(fileBuffer: Buffer, originalName: string, prefix: string): Promise<string> {
    const ref = await this.saveObject(fileBuffer, originalName, prefix);
    return `/uploads/${ref.key.replace('/', '-')}`;
  }

  static getFilePath(fileUrl: string): string {
    const filename = path.basename(fileUrl);
    return path.join(UPLOADS_DIR, filename);
  }

  static async readFile(fileUrl: string): Promise<Buffer> {
    return fs.readFile(this.getFilePath(fileUrl));
  }

  static async fileExists(fileUrl: string): Promise<boolean> {
    try {
      await fs.access(this.getFilePath(fileUrl));
      return true;
    } catch {
      return false;
    }
  }

  static async deleteFile(fileUrl: string): Promise<void> {
    await fs.unlink(this.getFilePath(fileUrl));
  }
}
