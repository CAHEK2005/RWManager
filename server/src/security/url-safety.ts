import { BadRequestException, ForbiddenException } from '@nestjs/common';
import * as dns from 'dns/promises';
import * as net from 'net';

export interface UrlSafetyOptions {
  allowPrivate?: boolean;
}

const PRIVATE_IPV4_RANGES = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
];

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[(.*)]$/, '$1');
}

export function isPrivateAddress(address: string): boolean {
  const normalized = normalizeHostname(address);
  const ipVersion = net.isIP(normalized);

  if (normalized === 'localhost') return true;
  if (ipVersion === 4)
    return PRIVATE_IPV4_RANGES.some((pattern) => pattern.test(normalized));
  if (ipVersion === 6) {
    return (
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe80:')
    );
  }

  return false;
}

export async function assertSafePublicHttpUrl(
  input: string,
  options: UrlSafetyOptions = {},
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new BadRequestException('Invalid URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new BadRequestException('Only HTTP/HTTPS URLs are allowed');
  }

  if (parsed.username || parsed.password) {
    throw new BadRequestException('URL credentials are not allowed');
  }

  if (options.allowPrivate) return parsed;

  const hostname = normalizeHostname(parsed.hostname);
  if (isPrivateAddress(hostname)) {
    throw new ForbiddenException(
      'Requests to internal addresses are forbidden',
    );
  }

  if (net.isIP(hostname) === 0) {
    let resolved: Array<{ address: string; family: number }>;
    try {
      resolved = await dns.lookup(hostname, { all: true });
    } catch {
      throw new BadRequestException('URL hostname cannot be resolved');
    }

    if (resolved.some((entry) => isPrivateAddress(entry.address))) {
      throw new ForbiddenException(
        'Requests to internal addresses are forbidden',
      );
    }
  }

  return parsed;
}

export async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  timeoutMs = 10_000,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      redirect: init.redirect ?? 'error',
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function readLimitedResponseText(
  response: Response,
  maxBytes = 1_048_576,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';

  const chunks: Uint8Array[] = [];
  let totalSize = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalSize += value.length;
    if (totalSize > maxBytes) {
      await reader.cancel();
      throw new Error(`Response body exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder().decode(merged);
}

export function normalizeGithubBlobUrl(input: string): string {
  const match = input.match(
    /^https?:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/(.+)$/,
  );
  return match
    ? `https://raw.githubusercontent.com/${match[1]}/${match[2]}`
    : input;
}
