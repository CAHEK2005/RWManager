import {
  redactSettingsForResponse,
  redactSettingsForBackup,
} from './settings-redaction';

describe('settings redaction', () => {
  const sshNodes = JSON.stringify([
    {
      id: 'node-1',
      name: 'prod',
      password: 'secret-password',
      sshKey: 'secret-key',
      authType: 'password',
    },
  ]);

  it('redacts SSH credentials from settings responses', () => {
    const result = redactSettingsForResponse({
      ssh_nodes: sshNodes,
      remnawave_api_key: 'rw-key',
      public_key: 'visible',
    });

    expect(result.public_key).toBe('visible');
    expect(result.remnawave_api_key).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('secret-password');
    expect(JSON.stringify(result)).not.toContain('secret-key');
  });

  it('redacts SSH credentials from backups while preserving node metadata', () => {
    const result = redactSettingsForBackup({
      ssh_nodes: sshNodes,
      secrets: 'must-not-export',
      telegram_bot_token: 'must-not-export',
    });

    expect(result.secrets).toBeUndefined();
    expect(result.telegram_bot_token).toBeUndefined();
    expect(JSON.stringify(result)).toContain('prod');
    expect(JSON.stringify(result)).not.toContain('secret-password');
    expect(JSON.stringify(result)).not.toContain('secret-key');
  });
});
