import 'reflect-metadata';
import { validate } from 'class-validator';
import { InstallNodeRequestDto } from './nodes.dto';

function makeInstallDto(
  overrides: Partial<InstallNodeRequestDto> = {},
): InstallNodeRequestDto {
  return Object.assign(new InstallNodeRequestDto(), {
    name: 'node-01',
    ip: '10.0.0.1',
    authType: 'password' as const,
    ...overrides,
  });
}

async function expectConstraint(
  property: keyof InstallNodeRequestDto,
  constraint: string,
  overrides: Partial<InstallNodeRequestDto>,
): Promise<void> {
  const errors = await validate(makeInstallDto(overrides));
  const propertyError = errors.find((error) => error.property === property);

  expect(propertyError?.constraints).toHaveProperty(constraint);
}

describe('InstallNodeRequestDto Remnawave validation', () => {
  it.each(['abc', 'n'.repeat(30)])(
    'accepts a node name at the supported boundary: %s',
    async (name) => {
      await expect(validate(makeInstallDto({ name }))).resolves.toHaveLength(0);
    },
  );

  it('rejects a node name shorter than 3 characters', async () => {
    await expectConstraint('name', 'minLength', { name: 'ab' });
  });

  it('rejects a node name longer than 30 characters', async () => {
    await expectConstraint('name', 'maxLength', { name: 'n'.repeat(31) });
  });

  it('accepts a Remnawave address with 2 characters', async () => {
    await expect(validate(makeInstallDto({ ip: 'ab' }))).resolves.toHaveLength(
      0,
    );
  });

  it('rejects a Remnawave address shorter than 2 characters', async () => {
    await expectConstraint('ip', 'minLength', { ip: 'a' });
  });

  it.each([undefined, 'R', 'RU'])(
    'accepts an optional country code up to 2 characters: %s',
    async (countryCode) => {
      await expect(
        validate(makeInstallDto({ countryCode })),
      ).resolves.toHaveLength(0);
    },
  );

  it('rejects a country code longer than 2 characters', async () => {
    await expectConstraint('countryCode', 'maxLength', {
      countryCode: 'RUS',
    });
  });

  it.each([undefined, 'ab', 'p'.repeat(30), 'Profile 01_test-prod'])(
    'accepts an optional valid profile name: %s',
    async (profileName) => {
      await expect(
        validate(makeInstallDto({ profileName })),
      ).resolves.toHaveLength(0);
    },
  );

  it.each([
    ['a', 'minLength'],
    ['p'.repeat(31), 'maxLength'],
    ['Profile!', 'matches'],
    ['Профиль', 'matches'],
  ])('rejects profile name %s with %s', async (profileName, constraint) => {
    await expectConstraint('profileName', constraint, { profileName });
  });
});
