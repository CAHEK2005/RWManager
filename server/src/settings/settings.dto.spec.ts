import { validate } from 'class-validator';
import { AddManagedProfileDto, RenameManagedProfileDto } from './settings.dto';

const profileDtoCases = [
  {
    label: 'AddManagedProfileDto',
    make: (name: string) => Object.assign(new AddManagedProfileDto(), { name }),
  },
  {
    label: 'RenameManagedProfileDto',
    make: (name: string) =>
      Object.assign(new RenameManagedProfileDto(), { name }),
  },
];

describe.each(profileDtoCases)('$label profile name validation', ({ make }) => {
  it.each(['ab', 'a'.repeat(30), 'Profile 01_test-prod'])(
    'accepts a valid name: %s',
    async (name) => {
      await expect(validate(make(name))).resolves.toHaveLength(0);
    },
  );

  it.each([
    ['a', 'minLength'],
    ['a'.repeat(31), 'maxLength'],
    ['Profile!', 'matches'],
    ['Профиль', 'matches'],
  ])('rejects %s with %s', async (name, constraint) => {
    const errors = await validate(make(name));
    const nameError = errors.find((error) => error.property === 'name');

    expect(nameError?.constraints).toHaveProperty(constraint);
  });
});
