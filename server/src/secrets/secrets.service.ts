import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { Setting } from '../settings/entities/setting.entity';
import { randomId } from '../common/random-id';

export interface Secret {
  id: string;
  name: string;
  type: 'password' | 'ssh-key' | 'token' | 'custom';
  value: string;
  description?: string;
  createdAt: string;
}

export type SecretPublic = Omit<Secret, 'value'>;

@Injectable()
export class SecretsService implements OnModuleInit {
  private readonly logger = new Logger(SecretsService.name);

  constructor(
    @InjectRepository(Setting)
    private settingRepo: Repository<Setting>,
  ) {}

  onModuleInit() {
    const key = process.env.SECRET_ENCRYPTION_KEY;
    if (!key) {
      this.logger.warn(
        'SECRET_ENCRYPTION_KEY is not set — secrets will be stored in plain text. ' +
          'Set a 32-byte hex key (64 hex chars) for production.',
      );
      return;
    }
    if (!/^[0-9a-fA-F]{64}$/.test(key)) {
      throw new Error(
        'SECRET_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). ' +
          'Generate with: openssl rand -hex 32',
      );
    }
  }

  // ── Encryption ───────────────────────────────────────────────────────────────

  private encrypt(value: string): string {
    const key = process.env.SECRET_ENCRYPTION_KEY;
    if (!key) {
      this.logger.warn(
        'SECRET_ENCRYPTION_KEY not set — storing secret in plain text',
      );
      return value;
    }
    const keyBuf = Buffer.from(key, 'hex');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', keyBuf, iv);
    const ciphertext = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return `enc:${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
  }

  private decrypt(stored: string): string {
    if (!stored.startsWith('enc:')) return stored; // legacy plain text
    const key = process.env.SECRET_ENCRYPTION_KEY;
    if (!key)
      throw new Error('SECRET_ENCRYPTION_KEY not set but secret is encrypted');
    const parts = stored.split(':');
    const [, ivHex, tagHex, cipherHex] = parts;
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      Buffer.from(key, 'hex'),
      Buffer.from(ivHex, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return (
      decipher.update(Buffer.from(cipherHex, 'hex')).toString('utf8') +
      decipher.final('utf8')
    );
  }

  // ── Storage ───────────────────────────────────────────────────────────────────

  private async load(): Promise<Secret[]> {
    const row = await this.settingRepo.findOne({ where: { key: 'secrets' } });
    if (!row) return [];
    try {
      const raw: Secret[] = JSON.parse(row.value);
      return raw.map((s) => ({ ...s, value: this.decrypt(s.value) }));
    } catch {
      return [];
    }
  }

  private async save(secrets: Secret[]): Promise<void> {
    const toStore = secrets.map((s) => ({
      ...s,
      value: this.encrypt(s.value),
    }));
    await this.settingRepo.save({
      key: 'secrets',
      value: JSON.stringify(toStore),
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  async getAll(): Promise<SecretPublic[]> {
    const secrets = await this.load();
    return secrets.map((secret) => ({
      id: secret.id,
      name: secret.name,
      type: secret.type,
      description: secret.description,
      createdAt: secret.createdAt,
    }));
  }

  async getValue(id: string): Promise<string | null> {
    const secrets = await this.load();
    return secrets.find((s) => s.id === id)?.value ?? null;
  }

  async create(dto: Omit<Secret, 'id' | 'createdAt'>): Promise<SecretPublic> {
    const secrets = await this.load();
    const secret: Secret = {
      id: randomId(),
      createdAt: new Date().toISOString(),
      ...dto,
    };
    secrets.push(secret);
    await this.save(secrets);
    return {
      id: secret.id,
      name: secret.name,
      type: secret.type,
      description: secret.description,
      createdAt: secret.createdAt,
    };
  }

  async update(
    id: string,
    dto: Partial<Omit<Secret, 'id' | 'createdAt'>>,
  ): Promise<void> {
    const secrets = await this.load();
    const idx = secrets.findIndex((s) => s.id === id);
    if (idx === -1) throw new Error('Secret not found');
    secrets[idx] = { ...secrets[idx], ...dto };
    await this.save(secrets);
  }

  async delete(id: string): Promise<void> {
    const secrets = await this.load();
    await this.save(secrets.filter((s) => s.id !== id));
  }
}
