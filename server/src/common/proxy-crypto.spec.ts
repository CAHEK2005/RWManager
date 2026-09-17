import { decryptProxyUrl, encryptProxyUrl } from './proxy-crypto';

describe('proxy URL encryption', () => {
  const previousKey = process.env.SECRET_ENCRYPTION_KEY;

  afterEach(() => {
    if (previousKey === undefined) delete process.env.SECRET_ENCRYPTION_KEY;
    else process.env.SECRET_ENCRYPTION_KEY = previousKey;
  });

  it('encrypts authenticated proxy URLs and decrypts them for connections', () => {
    process.env.SECRET_ENCRYPTION_KEY = 'ab'.repeat(32);
    const url = 'socks5://user:p%40ss@proxy.example:1080';
    const encrypted = encryptProxyUrl(url);
    expect(encrypted).toMatch(/^enc:/);
    expect(encrypted).not.toContain('p%40ss');
    expect(decryptProxyUrl(encrypted)).toBe(url);
  });

  it('accepts legacy unencrypted values', () => {
    process.env.SECRET_ENCRYPTION_KEY = 'ab'.repeat(32);
    expect(decryptProxyUrl('socks5://proxy.example:1080')).toBe(
      'socks5://proxy.example:1080',
    );
  });

  it('rejects ciphertext tampering', () => {
    process.env.SECRET_ENCRYPTION_KEY = 'ab'.repeat(32);
    const encrypted = encryptProxyUrl('socks5://proxy.example:1080');
    const corrupted = encrypted.slice(0, -2) + 'ff';
    expect(() => decryptProxyUrl(corrupted)).toThrow();
  });
});
