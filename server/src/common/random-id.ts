import { randomUUID } from 'crypto';

export function randomId(): string {
  return randomUUID();
}
