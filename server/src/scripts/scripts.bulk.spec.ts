import { ScriptsService } from './scripts.service';

function createHarness(initial: Record<string, unknown>) {
  const rows = new Map(
    Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)]),
  );
  const repo = {
    findOne: jest.fn(async ({ where: { key } }: { where: { key: string } }) => {
      const value = rows.get(key);
      return value === undefined ? null : { key, value };
    }),
    save: jest.fn(async ({ key, value }: { key: string; value: string }) => {
      rows.set(key, value);
      return { key, value };
    }),
    create: jest.fn((value) => value),
  };
  const service = new ScriptsService(repo as never, {} as never, {} as never);
  return {
    service,
    repo,
    read: (key: string) => JSON.parse(rows.get(key) || '[]') as unknown[],
  };
}

describe('ScriptsService bulk actions', () => {
  it('deletes selected SSH nodes in one settings write', async () => {
    const { service, repo, read } = createHarness({
      ssh_nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    });
    await expect(service.deleteSshNodes(['a', 'b'])).resolves.toEqual({
      success: true,
      deleted: 2,
    });
    expect(read('ssh_nodes')).toEqual([{ id: 'c' }]);
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('removes selected categories from nodes while preserving other categories', async () => {
    const { service, read } = createHarness({
      node_categories: [
        { id: 'prod', name: 'Production', color: '#f00' },
        { id: 'test', name: 'Test', color: '#0f0' },
        { id: 'edge', name: 'Edge', color: '#00f' },
      ],
      ssh_nodes: [
        { id: 'a', categoryIds: ['prod', 'edge'] },
        { id: 'b', categoryIds: ['test'] },
      ],
    });
    await service.deleteCategories(['prod', 'test']);
    expect(read('node_categories')).toEqual([
      { id: 'edge', name: 'Edge', color: '#00f' },
    ]);
    expect(read('ssh_nodes')).toEqual([
      { id: 'a', categoryIds: ['edge'] },
      { id: 'b', categoryIds: [] },
    ]);
  });

  it('hides built-in scripts and removes selected custom scripts together', async () => {
    const { service, read } = createHarness({
      scripts: [
        { id: 'builtin', isBuiltIn: true },
        { id: 'custom', isBuiltIn: false },
        { id: 'keep', isBuiltIn: false },
      ],
    });
    await service.deleteScripts(['builtin', 'custom']);
    expect(read('scripts')).toEqual([
      { id: 'builtin', isBuiltIn: true, isHidden: true },
      { id: 'keep', isBuiltIn: false },
    ]);
  });
});
