import { SecretsService } from './secrets.service';

describe('SecretsService bulk deletion', () => {
  it('does not overwrite encrypted secrets when the decryption key is unavailable', async () => {
    const previousKey = process.env.SECRET_ENCRYPTION_KEY;
    delete process.env.SECRET_ENCRYPTION_KEY;
    const repo = {
      findOne: jest.fn(async () => ({
        key: 'secrets',
        value: JSON.stringify([{ id: 'secret-1', value: 'enc:00:00:00' }]),
      })),
      save: jest.fn(),
    };
    try {
      const service = new SecretsService(repo as never);
      await expect(service.deleteMany(['secret-1'])).rejects.toThrow(
        'SECRET_ENCRYPTION_KEY',
      );
      expect(repo.save).not.toHaveBeenCalled();
    } finally {
      if (previousKey === undefined) delete process.env.SECRET_ENCRYPTION_KEY;
      else process.env.SECRET_ENCRYPTION_KEY = previousKey;
    }
  });
});
