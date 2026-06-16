export const XRAY_CONFIG_TEMPLATE_SETTING_KEY = 'xray_config_template';
export const XRAY_INBOUNDS_PLACEHOLDER = '__RWM_GENERATED_INBOUNDS__';
export const XRAY_CONFIG_TEMPLATE_MAX_LENGTH = 200_000;

export const XRAY_INBOUNDS_PLACEHOLDER_ALIASES = [
  XRAY_INBOUNDS_PLACEHOLDER,
  '{{generatedInbounds}}',
  '{{ generatedInbounds }}',
] as const;

const defaultXrayConfigTemplate = {
  inbounds: XRAY_INBOUNDS_PLACEHOLDER,
  outbounds: [
    { tag: 'DIRECT', protocol: 'freedom' },
    { tag: 'BLOCK', protocol: 'blackhole' },
  ],
  routing: {
    rules: [
      { type: 'field', ip: ['geoip:private'], outboundTag: 'BLOCK' },
      { type: 'field', domain: ['geosite:private'], outboundTag: 'BLOCK' },
      { type: 'field', protocol: ['bittorrent'], outboundTag: 'BLOCK' },
    ],
  },
} satisfies Record<string, unknown>;

export const DEFAULT_XRAY_CONFIG_TEMPLATE = JSON.stringify(
  defaultXrayConfigTemplate,
  null,
  2,
);

export type XrayConfigTemplateObject = Record<string, unknown> & {
  inbounds: unknown[] | string;
};

export type RenderedXrayConfig = Record<string, unknown> & {
  inbounds: unknown[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isSupportedInboundPlaceholder(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    XRAY_INBOUNDS_PLACEHOLDER_ALIASES.includes(
      value as (typeof XRAY_INBOUNDS_PLACEHOLDER_ALIASES)[number],
    )
  );
}

export function parseXrayConfigTemplate(
  template: string,
): XrayConfigTemplateObject {
  const normalized = template.trim();
  if (!normalized) {
    throw new Error('Xray config template is required');
  }
  if (normalized.length > XRAY_CONFIG_TEMPLATE_MAX_LENGTH) {
    throw new Error(
      `Xray config template must be ${XRAY_CONFIG_TEMPLATE_MAX_LENGTH} characters or less`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new Error('Xray config template must be valid JSON');
  }

  if (!isPlainObject(parsed)) {
    throw new Error('Xray config template must be a JSON object');
  }
  if (!Object.prototype.hasOwnProperty.call(parsed, 'inbounds')) {
    throw new Error('Xray config template must define root "inbounds"');
  }

  const inbounds = parsed.inbounds;
  if (!Array.isArray(inbounds) && !isSupportedInboundPlaceholder(inbounds)) {
    throw new Error(
      `Root "inbounds" must be an array or "${XRAY_INBOUNDS_PLACEHOLDER}" placeholder`,
    );
  }

  return parsed as XrayConfigTemplateObject;
}

export function normalizeXrayConfigTemplate(template: string): string {
  return JSON.stringify(parseXrayConfigTemplate(template), null, 2);
}

export function renderXrayConfigTemplate(
  template: string,
  generatedInbounds: unknown[],
): RenderedXrayConfig {
  if (!Array.isArray(generatedInbounds)) {
    throw new Error('Generated inbounds must be an array');
  }
  const config = cloneJson(parseXrayConfigTemplate(template));
  return {
    ...config,
    inbounds: cloneJson(generatedInbounds),
  };
}

export function buildInitialXrayInbound(tag: string, uuid: string) {
  return {
    tag,
    protocol: 'vless',
    port: 44321,
    settings: {
      clients: [{ id: uuid, flow: '', email: 'placeholder' }],
      decryption: 'none',
      fallbacks: [],
    },
    streamSettings: {
      network: 'tcp',
      security: 'none',
      tcpSettings: {
        acceptProxyProtocol: false,
        header: { type: 'none' },
      },
    },
    sniffing: { enabled: false, destOverride: [] },
  };
}

export function buildInitialXrayConfigFromTemplate(
  template: string,
  tag: string,
  uuid: string,
): RenderedXrayConfig {
  return renderXrayConfigTemplate(template, [
    buildInitialXrayInbound(tag, uuid),
  ]);
}
