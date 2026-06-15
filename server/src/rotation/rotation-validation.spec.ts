import {
  resolveInboundPort,
  validateRequiredSni,
  pickRandomPort,
} from './rotation-validation';

describe('rotation validation helpers', () => {
  it('rejects invalid fixed ports', () => {
    expect(() => resolveInboundPort({ port: 'not-a-number' })).toThrow(/port/i);
    expect(() => resolveInboundPort({ port: 70000 })).toThrow(/port/i);
  });

  it('requires SNI for Reality-based inbound types', () => {
    expect(() => validateRequiredSni('vless-tcp-reality', '')).toThrow(/SNI/i);
    expect(() =>
      validateRequiredSni('trojan-tcp-reality', 'example.com'),
    ).not.toThrow();
  });

  it('stops random port selection when the configured range is exhausted', () => {
    const usedPorts = new Set<number>();
    for (let port = 10000; port <= 60000; port += 1) {
      usedPorts.add(port);
    }

    expect(() => pickRandomPort(usedPorts)).toThrow(/available port/i);
  });
});
