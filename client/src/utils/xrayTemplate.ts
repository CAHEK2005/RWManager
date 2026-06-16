export const XRAY_INBOUNDS_PLACEHOLDER = '__RWM_GENERATED_INBOUNDS__';
export const XRAY_CONFIG_TEMPLATE_MAX_LENGTH = 200_000;

const XRAY_INBOUNDS_PLACEHOLDER_ALIASES = [
  XRAY_INBOUNDS_PLACEHOLDER,
  '{{generatedInbounds}}',
  '{{ generatedInbounds }}',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateXrayConfigTemplate(template: string): string | null {
  const normalized = template.trim();
  if (!normalized) return 'Шаблон Xray config не может быть пустым';
  if (normalized.length > XRAY_CONFIG_TEMPLATE_MAX_LENGTH) {
    return `Шаблон должен быть не длиннее ${XRAY_CONFIG_TEMPLATE_MAX_LENGTH} символов`;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    return 'Шаблон должен быть корректным JSON';
  }

  if (!isRecord(parsed)) return 'Корневой Xray config должен быть JSON-объектом';
  if (!Object.prototype.hasOwnProperty.call(parsed, 'inbounds')) {
    return 'В корне должен быть ключ "inbounds"';
  }

  const inbounds = parsed.inbounds;
  if (
    !Array.isArray(inbounds) &&
    !(
      typeof inbounds === 'string' &&
      XRAY_INBOUNDS_PLACEHOLDER_ALIASES.includes(inbounds)
    )
  ) {
    return `Ключ "inbounds" должен быть массивом или "${XRAY_INBOUNDS_PLACEHOLDER}"`;
  }

  return null;
}

export function formatXrayConfigTemplate(template: string): string {
  return JSON.stringify(JSON.parse(template), null, 2);
}
