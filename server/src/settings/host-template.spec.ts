import {
  DEFAULT_HOST_TEMPLATE,
  renderHostRemark,
  resolveActiveHostTemplate,
  validateHostTemplate,
} from './host-template';

describe('host template helpers', () => {
  const context = {
    countryFlag: '🇩🇪',
    countryCode: 'DE',
    nodeName: 'Berlin-01',
    nodeAddress: '203.0.113.10',
    inboundType: 'vless-tcp-reality',
    index: 3,
  };

  it('renders supported variables everywhere they appear', () => {
    expect(
      renderHostRemark(
        '{countryCode}-{nodeName}-{inboundType}-#{index}-{index}',
        context,
      ),
    ).toBe('DE-Berlin-01-vless-tcp-reality-#3-3');
  });

  it('rejects empty and unknown-variable templates', () => {
    expect(() => validateHostTemplate('   ')).toThrow(
      'Host template is required',
    );
    expect(() => validateHostTemplate('{nodeName}-{unknown}')).toThrow(
      'Unsupported host template variable: {unknown}',
    );
  });

  it('resolves inheritance and legacy profile templates', () => {
    expect(
      resolveActiveHostTemplate(
        { hostTemplateMode: 'inherit', hostTemplate: 'custom' },
        'global',
      ),
    ).toBe('global');

    expect(
      resolveActiveHostTemplate(
        { hostTemplateMode: 'custom', hostTemplate: '{nodeName}' },
        'global',
      ),
    ).toBe('{nodeName}');

    expect(
      resolveActiveHostTemplate(
        { hostTemplate: DEFAULT_HOST_TEMPLATE },
        'global',
      ),
    ).toBe('global');

    expect(
      resolveActiveHostTemplate({ hostTemplate: 'legacy-custom' }, 'global'),
    ).toBe('legacy-custom');
  });
});
