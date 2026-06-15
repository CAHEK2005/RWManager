export const DEFAULT_HOST_TEMPLATE = '{countryCode} {nodeName} - {inboundType}';
export const HOST_TEMPLATE_REMARK_MAX_LENGTH = 40;

export const HOST_TEMPLATE_VARIABLES = [
  'countryFlag',
  'countryCode',
  'nodeName',
  'nodeAddress',
  'inboundType',
  'index',
] as const;

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

export function validateHostTemplate(template: string): string | null {
  const normalized = template.trim();
  if (!normalized) return 'Шаблон не может быть пустым';
  if (normalized.length > 160) return 'Шаблон должен быть не длиннее 160 символов';

  const unknown = new Set<string>();
  for (const match of normalized.matchAll(VARIABLE_RE)) {
    const variable = match[1];
    if (!VARIABLE_SET.has(variable)) unknown.add(variable);
  }
  if (unknown.size > 0) {
    return `Неизвестные переменные: ${Array.from(unknown).map(v => `{${v}}`).join(', ')}`;
  }

  return null;
}

export function renderHostTemplate(
  template: string,
  context: HostTemplateContext,
  maxLength = HOST_TEMPLATE_REMARK_MAX_LENGTH,
): string {
  return template
    .trim()
    .replace(VARIABLE_RE, (_, variable: keyof HostTemplateContext) => String(context[variable] ?? ''))
    .trim()
    .slice(0, maxLength);
}

export function resolveProfileHostTemplate(
  mode: HostTemplateMode | undefined,
  profileTemplate: string,
  defaultTemplate: string,
): string {
  return mode === 'custom' ? profileTemplate : defaultTemplate;
}
