import { ScriptsService } from './scripts.service';

describe('ScriptsService history', () => {
  function createRepo(initial: Record<string, string>) {
    const rows = new Map(Object.entries(initial));
    return {
      findOne: jest.fn(async ({ where: { key } }) => {
        const value = rows.get(key);
        return value === undefined ? null : { key, value };
      }),
      save: jest.fn(async ({ key, value }) => {
        rows.set(key, value);
        return { key, value };
      }),
      create: jest.fn((value) => value),
    };
  }

  it('returns logPreview in paginated history list', async () => {
    const repo = createRepo({
      script_history: JSON.stringify([
        {
          id: 'history-1',
          scriptId: 'script-1',
          scriptName: 'Deploy',
          status: 'success',
          startedAt: '2026-01-01T00:00:00.000Z',
          finishedAt: '2026-01-01T00:00:01.000Z',
          durationMs: 1000,
          nodeResults: [
            {
              nodeId: 'node-1',
              nodeName: 'prod',
              status: 'success',
              logs: ['[SSH] connected', 'deployment complete'],
            },
          ],
        },
      ]),
    });
    const service = new ScriptsService(
      repo as never,
      {
        notifyScriptExecution: jest.fn(),
      } as never,
      {
        getValue: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      } as never,
    );

    const result = await service.getHistory();

    expect(result.data[0].logPreview).toBe('deployment complete');
  });
});
