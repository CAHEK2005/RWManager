const SENSITIVE_SETTING_KEYS = new Set([
  'secrets',
  'telegram_bot_token',
  'remnawave_api_key',
  'ssh_proxy_url',
]);

function redactSshNodesValue(value: string): string {
  try {
    const nodes = JSON.parse(value);
    if (!Array.isArray(nodes)) return '[]';

    return JSON.stringify(
      nodes.map((node) => {
        const redacted = { ...node };
        const hasPassword = Boolean(
          redacted.password || redacted.passwordSecretId,
        );
        const hasSshKey = Boolean(redacted.sshKey || redacted.sshKeySecretId);
        const hasProxyUrl = Boolean(redacted.proxyUrl);
        delete redacted.password;
        delete redacted.sshKey;
        delete redacted.passwordSecretId;
        delete redacted.sshKeySecretId;
        delete redacted.proxyUrl;
        return {
          ...redacted,
          hasPassword,
          hasSshKey,
          hasProxyUrl,
        };
      }),
    );
  } catch {
    return '[]';
  }
}

function redactSettings(
  settings: Record<string, string>,
  excludedKeys: Set<string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (excludedKeys.has(key)) continue;
    result[key] = key === 'ssh_nodes' ? redactSshNodesValue(value) : value;
  }
  return result;
}

export function redactSettingsForResponse(
  settings: Record<string, string>,
): Record<string, string> {
  return {
    ...redactSettings(settings, SENSITIVE_SETTING_KEYS),
    ssh_proxy_configured: settings.ssh_proxy_url ? 'true' : 'false',
  };
}

export function redactSettingsForBackup(
  settings: Record<string, string>,
): Record<string, string> {
  return redactSettings(settings, SENSITIVE_SETTING_KEYS);
}

export function shouldRestoreSetting(key: string): boolean {
  return !SENSITIVE_SETTING_KEYS.has(key);
}
