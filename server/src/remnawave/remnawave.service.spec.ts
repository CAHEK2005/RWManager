import { ForbiddenException } from '@nestjs/common';
import { RemnavaveService } from './remnawave.service';

describe('RemnavaveService connection check', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('explains private Remnawave URL blocks', async () => {
    const service = new RemnavaveService({} as any);
    (service as any).buildApiUrl = jest
      .fn()
      .mockRejectedValue(
        new ForbiddenException('Requests to internal addresses are forbidden'),
      );

    const result = await service.checkConnectionDetailed(
      'https://panel.infra.pet',
      'token',
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain('RWM_ALLOW_PRIVATE_REMNAWAVE=true');
  });

  it('reports rejected API tokens distinctly from network failures', async () => {
    const service = new RemnavaveService({} as any);
    (service as any).buildApiUrl = jest
      .fn()
      .mockResolvedValue('https://panel.example.test/api/config-profiles');
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{"message":"Unauthorized"}', {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const result = await service.checkConnectionDetailed(
      'https://panel.example.test',
      'token',
    );

    expect(result).toEqual({
      success: false,
      status: 401,
      message: 'Remnawave rejected the API token (HTTP 401).',
    });
  });

  it('explains missing API token scopes', async () => {
    const service = new RemnavaveService({} as any);
    (service as any).buildApiUrl = jest
      .fn()
      .mockResolvedValue('https://panel.example.test/api/config-profiles');
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{"message":"Forbidden"}', {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const result = await service.checkConnectionDetailed(
      'https://panel.example.test',
      'token',
    );

    expect(result).toEqual({
      success: false,
      status: 403,
      message:
        'Remnawave API token cannot access config profiles (HTTP 403). Check the token scopes.',
    });
  });
});

describe('RemnavaveService Remnawave API v3.2.3 contract', () => {
  const panelUrl = 'https://panel.example.test';

  const createService = () => {
    const service = new RemnavaveService({} as any);
    (service as any).getSettings = jest.fn().mockResolvedValue({
      url: panelUrl,
      apiKey: 'api-key',
    });
    (service as any).buildApiUrl = jest
      .fn()
      .mockImplementation((baseUrl: string, path: string) =>
        Promise.resolve(`${baseUrl}${path}`),
      );
    return service;
  };

  const mockResponse = (status: number, body?: unknown) =>
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers:
          body === undefined
            ? undefined
            : { 'content-type': 'application/json' },
      }),
    );

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reads the node secret from response.secretKey', async () => {
    const service = createService();
    const fetchMock = mockResponse(200, {
      response: { secretKey: 'node-secret' },
    });

    await expect(service.getNodeSecretKey()).resolves.toBe('node-secret');
    expect(fetchMock).toHaveBeenCalledWith(
      `${panelUrl}/api/keygen`,
      expect.objectContaining({
        headers: { Authorization: 'Bearer api-key' },
      }),
    );
  });

  it('rejects a malformed keygen response instead of returning an empty key', async () => {
    const service = createService();
    mockResponse(200, { response: {} });

    await expect(service.getNodeSecretKey()).rejects.toThrow(
      'No node secret key returned from Remnawave',
    );
  });

  it('gets one config profile from the v3.2.3 UUID endpoint', async () => {
    const service = createService();
    const profile = { uuid: 'profile-uuid', name: 'Profile' };
    const fetchMock = mockResponse(200, { response: profile });

    await expect(service.getConfigProfile('profile-uuid')).resolves.toEqual(
      profile,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `${panelUrl}/api/config-profiles/profile-uuid`,
      expect.any(Object),
    );
  });

  it('handles documented 204 mutation responses without reading an envelope', async () => {
    const service = createService();
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(new Response(null, { status: 204 })),
      );

    await expect(
      service.deleteConfigProfile('profile-uuid'),
    ).resolves.toBeUndefined();
    await expect(service.deleteNode('node-uuid')).resolves.toBeUndefined();
    await expect(
      service.applyProfileToNode('node-uuid', 'profile-uuid', ['inbound-uuid']),
    ).resolves.toBeUndefined();

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${panelUrl}/api/config-profiles/profile-uuid`,
    );
    expect(fetchMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(fetchMock.mock.calls[1][0]).toBe(`${panelUrl}/api/nodes/node-uuid`);
    expect(fetchMock.mock.calls[1][1]).toEqual(
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(fetchMock.mock.calls[2][0]).toBe(
      `${panelUrl}/api/nodes/bulk-actions/profile-modification`,
    );
    expect(fetchMock.mock.calls[2][1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          uuids: ['node-uuid'],
          configProfile: {
            activeConfigProfileUuid: 'profile-uuid',
            activeInbounds: ['inbound-uuid'],
          },
        }),
      }),
    );
  });

  it('sends the required restart body and accepts a bodyless 202 response', async () => {
    const service = createService();
    const fetchMock = mockResponse(202);

    await expect(service.restartNode('node-uuid')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      `${panelUrl}/api/nodes/node-uuid/actions/restart`,
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer api-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ forceRestart: false }),
      }),
    );
  });

  it('keeps the documented nested node versions when unwrapping node lists', async () => {
    const service = createService();
    mockResponse(200, {
      response: [
        {
          uuid: 'node-uuid',
          versions: { xray: '25.8.3', node: '2.1.0' },
        },
      ],
    });

    const nodes = await service.getNodes();

    expect(nodes[0].versions).toEqual({ xray: '25.8.3', node: '2.1.0' });
  });

  it('rejects a successful response without the documented envelope', async () => {
    const service = createService();
    mockResponse(200, {});

    await expect(service.getNodes()).rejects.toThrow(
      'Invalid response from Remnawave for get nodes',
    );
  });
});
