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
});
