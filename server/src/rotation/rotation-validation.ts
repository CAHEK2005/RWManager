const MIN_ROTATION_PORT = 10_000;
const MAX_ROTATION_PORT = 60_000;

interface PortConfig {
  port?: string | number;
  randomPort?: boolean;
}

export function resolveInboundPort(config: PortConfig): number {
  const port =
    typeof config.port === 'string'
      ? Number.parseInt(config.port, 10)
      : config.port;

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Invalid inbound port');
  }

  return port;
}

export function validateRequiredSni(type: string, sni: string): void {
  const requiresSni = [
    'vless-tcp-reality',
    'vless-xhttp-reality',
    'vless-grpc-reality',
    'vless-ws',
    'trojan-tcp-reality',
  ].includes(type);

  if (requiresSni && !sni.trim()) {
    throw new Error(`SNI is required for ${type}`);
  }
}

export function pickRandomPort(
  usedPorts: Set<number>,
  excludedPorts: Set<number> = new Set(),
): number {
  const availableCount =
    MAX_ROTATION_PORT -
    MIN_ROTATION_PORT +
    1 -
    new Set([...usedPorts, ...excludedPorts]).size;

  if (availableCount <= 0) {
    throw new Error('No available port in rotation range');
  }

  for (let attempts = 0; attempts < 10_000; attempts += 1) {
    const port =
      Math.floor(Math.random() * (MAX_ROTATION_PORT - MIN_ROTATION_PORT + 1)) +
      MIN_ROTATION_PORT;
    if (!usedPorts.has(port) && !excludedPorts.has(port)) {
      usedPorts.add(port);
      return port;
    }
  }

  for (let port = MIN_ROTATION_PORT; port <= MAX_ROTATION_PORT; port += 1) {
    if (!usedPorts.has(port) && !excludedPorts.has(port)) {
      usedPorts.add(port);
      return port;
    }
  }

  throw new Error('No available port in rotation range');
}
