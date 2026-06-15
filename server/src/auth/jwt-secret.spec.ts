import { getJwtSecret, JWT_FALLBACK_SECRET } from './jwt-secret';

describe('JWT secret configuration', () => {
  const originalSecret = process.env.JWT_SECRET;

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = originalSecret;
    }
  });

  it('uses one shared fallback when JWT_SECRET is missing', () => {
    delete process.env.JWT_SECRET;

    expect(getJwtSecret()).toBe(JWT_FALLBACK_SECRET);
  });

  it('uses JWT_SECRET from the environment when configured', () => {
    process.env.JWT_SECRET = 'configured-secret';

    expect(getJwtSecret()).toBe('configured-secret');
  });
});
