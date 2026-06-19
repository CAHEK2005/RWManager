import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SshNodeDto } from './scripts.dto';

describe('SshNodeDto', () => {
  it('accepts redacted credential flags returned by the API', async () => {
    const dto = plainToInstance(SshNodeDto, {
      id: 'node-1',
      name: 'Node 1',
      ip: '10.0.0.10',
      sshPort: 22,
      sshUser: 'root',
      authType: 'key',
      sshKey: '-----BEGIN OPENSSH PRIVATE KEY-----',
      categoryIds: [],
      hasPassword: true,
      hasSshKey: false,
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors).toEqual([]);
  });
});
