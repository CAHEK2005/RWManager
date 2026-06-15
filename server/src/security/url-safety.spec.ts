import { assertSafePublicHttpUrl, readLimitedResponseText } from './url-safety';

describe('URL safety helpers', () => {
  it('rejects localhost URLs', async () => {
    await expect(
      assertSafePublicHttpUrl('http://localhost/admin'),
    ).rejects.toThrow(/internal/i);
  });

  it('rejects private IPv4 URLs', async () => {
    await expect(
      assertSafePublicHttpUrl('http://192.168.1.5/config'),
    ).rejects.toThrow(/internal/i);
  });

  it('rejects unsupported protocols', async () => {
    await expect(assertSafePublicHttpUrl('file:///etc/passwd')).rejects.toThrow(
      /http/i,
    );
  });

  it('enforces response body size limits', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(6));
        controller.close();
      },
    });
    const response = new Response(body);

    await expect(readLimitedResponseText(response, 5)).rejects.toThrow(
      /exceeds/i,
    );
  });
});
