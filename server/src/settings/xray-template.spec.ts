import {
  DEFAULT_XRAY_CONFIG_TEMPLATE,
  XRAY_INBOUNDS_PLACEHOLDER,
  buildInitialXrayConfigFromTemplate,
  normalizeXrayConfigTemplate,
  renderXrayConfigTemplate,
} from './xray-template';

describe('xray config template helpers', () => {
  const generatedInbounds = [
    { tag: 'vless-tcp-reality-rwm-a1', protocol: 'vless', port: 443 },
  ];

  it('renders generated inbounds into the default template', () => {
    const config = renderXrayConfigTemplate(
      DEFAULT_XRAY_CONFIG_TEMPLATE,
      generatedInbounds,
    );

    expect(config.inbounds).toEqual(generatedInbounds);
    expect(config.outbounds).toEqual([
      { tag: 'DIRECT', protocol: 'freedom' },
      { tag: 'BLOCK', protocol: 'blackhole' },
    ]);
    expect(config.routing).toEqual({
      rules: [
        { type: 'field', ip: ['geoip:private'], outboundTag: 'BLOCK' },
        { type: 'field', domain: ['geosite:private'], outboundTag: 'BLOCK' },
        { type: 'field', protocol: ['bittorrent'], outboundTag: 'BLOCK' },
      ],
    });
  });

  it('preserves custom config sections and replaces stale inbounds', () => {
    const template = JSON.stringify({
      log: { loglevel: 'warning' },
      dns: { servers: ['1.1.1.1'] },
      inbounds: [{ tag: 'old-inbound' }],
      outbounds: [{ tag: 'CUSTOM', protocol: 'freedom' }],
      routing: { domainStrategy: 'IPIfNonMatch', rules: [] },
    });

    const config = renderXrayConfigTemplate(template, generatedInbounds);

    expect(config.inbounds).toEqual(generatedInbounds);
    expect(config.dns).toEqual({ servers: ['1.1.1.1'] });
    expect(config.outbounds).toEqual([{ tag: 'CUSTOM', protocol: 'freedom' }]);
    expect(config.routing).toEqual({
      domainStrategy: 'IPIfNonMatch',
      rules: [],
    });
  });

  it('accepts the generated inbounds placeholder', () => {
    const normalized = normalizeXrayConfigTemplate(
      JSON.stringify({ inbounds: XRAY_INBOUNDS_PLACEHOLDER, outbounds: [] }),
    );

    expect(JSON.parse(normalized)).toEqual({
      inbounds: XRAY_INBOUNDS_PLACEHOLDER,
      outbounds: [],
    });
  });

  it('rejects invalid templates', () => {
    expect(() => normalizeXrayConfigTemplate('{')).toThrow(/valid JSON/i);
    expect(() => normalizeXrayConfigTemplate('[]')).toThrow(/JSON object/i);
    expect(() =>
      normalizeXrayConfigTemplate(JSON.stringify({ outbounds: [] })),
    ).toThrow(/inbounds/i);
    expect(() =>
      normalizeXrayConfigTemplate(JSON.stringify({ inbounds: 'bad' })),
    ).toThrow(/placeholder/i);
  });

  it('builds an initial profile config from the active template', () => {
    const config = buildInitialXrayConfigFromTemplate(
      JSON.stringify({
        inbounds: XRAY_INBOUNDS_PLACEHOLDER,
        outbounds: [{ tag: 'DIRECT', protocol: 'freedom' }],
        policy: { levels: { 0: { statsUserUplink: true } } },
      }),
      'init-rwm',
      'client-uuid',
    );

    expect(config.inbounds).toHaveLength(1);
    expect(config.inbounds[0]).toMatchObject({
      tag: 'init-rwm',
      protocol: 'vless',
      settings: {
        clients: [{ id: 'client-uuid', flow: '', email: 'placeholder' }],
      },
    });
    expect(config.policy).toEqual({
      levels: { 0: { statsUserUplink: true } },
    });
  });
});
