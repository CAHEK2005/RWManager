import * as crypto from 'node:crypto';

// Uses the same key and storage format as SecretsService, while proxy URLs
// remain in their existing settings fields for compatibility with old data.
export function encryptProxyUrl(value: string): string {
  const key = process.env.SECRET_ENCRYPTION_KEY;
  if (!key || !value) return value;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    'aes-256-gcm',
    Buffer.from(key, 'hex'),
    iv,
  );
  const ciphertext = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);
  return `enc:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${ciphertext.toString('hex')}`;
}

export function decryptProxyUrl(value: string): string {
  if (!value.startsWith('enc:')) return value;
  const key = process.env.SECRET_ENCRYPTION_KEY;
  if (!key)
    throw new Error(
      'SECRET_ENCRYPTION_KEY is required to decrypt SOCKS5 proxy credentials',
    );
  const parts = value.split(':');
  if (parts.length !== 4)
    throw new Error('Invalid encrypted SOCKS5 proxy value');
  const [, ivHex, tagHex, ciphertextHex] = parts;
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(key, 'hex'),
    Buffer.from(ivHex, 'hex'),
  );
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}
