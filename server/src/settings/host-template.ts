export const DEFAULT_HOST_TEMPLATE = '{countryCode} {nodeName} - {inboundType}';
export const HOST_TEMPLATE_SETTING_KEY = 'host_template_default';
export const HOST_TEMPLATE_REMARK_MAX_LENGTH = 40;

export const HOST_TEMPLATE_VARIABLES = [
  'countryFlag',
  'countryCode',
  'nodeName',
  'nodeAddress',
  'inboundType',
  'index',
] as const;

export type HostTemplateVariable = (typeof HOST_TEMPLATE_VARIABLES)[number];
export type HostTemplateMode = 'inherit' | 'custom';

export interface HostTemplateContext {
  countryFlag: string;
  countryCode: string;
  nodeName: string;
  nodeAddress: string;
  inboundType: string;
  index: number;
}

const VARIABLE_SET = new Set<string>(HOST_TEMPLATE_VARIABLES);
const VARIABLE_RE = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

export function validateHostTemplate(template: string): string {
  const normalized = template.trim();
  if (!normalized) {
    throw new Error('Host template is required');
  }
  if (normalized.length > 160) {
    throw new Error('Host template must be 160 characters or less');
  }

  const unknown = new Set<string>();
  for (const match of normalized.matchAll(VARIABLE_RE)) {
    const variable = match[1];
    if (!VARIABLE_SET.has(variable)) unknown.add(variable);
  }
  if (unknown.size > 0) {
    throw new Error(
      `Unsupported host template variable: ${Array.from(unknown)
        .map((v) => `{${v}}`)
        .join(', ')}`,
    );
  }

  return normalized;
}

export function renderHostRemark(
  template: string,
  context: HostTemplateContext,
  maxLength = HOST_TEMPLATE_REMARK_MAX_LENGTH,
): string {
  const rendered = validateHostTemplate(template).replace(
    VARIABLE_RE,
    (_, variable: HostTemplateVariable) => String(context[variable] ?? ''),
  );
  return rendered.trim().slice(0, maxLength);
}

export function resolveActiveHostTemplate(
  profile: { hostTemplate?: string; hostTemplateMode?: HostTemplateMode },
  defaultTemplate: string,
): string {
  const globalTemplate = validateHostTemplate(
    defaultTemplate || DEFAULT_HOST_TEMPLATE,
  );

  if (profile.hostTemplateMode === 'custom') {
    return validateHostTemplate(profile.hostTemplate || globalTemplate);
  }
  if (profile.hostTemplateMode === 'inherit') {
    return globalTemplate;
  }

  if (profile.hostTemplate && profile.hostTemplate !== DEFAULT_HOST_TEMPLATE) {
    return validateHostTemplate(profile.hostTemplate);
  }
  return globalTemplate;
}

export function inferHostTemplateMode(profile: {
  hostTemplate?: string;
  hostTemplateMode?: HostTemplateMode;
}): HostTemplateMode {
  if (profile.hostTemplateMode) return profile.hostTemplateMode;
  return profile.hostTemplate && profile.hostTemplate !== DEFAULT_HOST_TEMPLATE
    ? 'custom'
    : 'inherit';
}

export function countryCodeToFlag(countryCode: string): string {
  if (countryCode.length !== 2) return countryCode;
  return Array.from(countryCode.toUpperCase())
    .map((c) => String.fromCodePoint(c.charCodeAt(0) - 65 + 0x1f1e6))
    .join('');
}
