export const JWT_FALLBACK_SECRET = 'INSECURE_DEFAULT_CHANGE_ME_IN_PRODUCTION';

export function getJwtSecret(): string {
  return process.env.JWT_SECRET || JWT_FALLBACK_SECRET;
}
