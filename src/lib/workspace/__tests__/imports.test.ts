import { describe, it, expect, vi } from 'vitest';
import { resolveWorkspaceImports } from '../imports';

describe('imports logic', () => {
  it('resolves simple imports', async () => {
    const resolveFileByPath = vi.fn().mockResolvedValue({
      kind: 'file',
      content: 'Imported Content'
    });

    const result = await resolveWorkspaceImports({
      text: 'Before {{import:/sub.md}} After',
      sourceFormat: 'markdown',
      resolveFileByPath
    });

    expect(result.resolvedText).toBe('Before Imported Content After');
    expect(resolveFileByPath).toHaveBeenCalledWith('/sub.md');
  });

  it('handles recursive imports', async () => {
    const resolveFileByPath = vi.fn().mockImplementation(async (path) => {
      if (path === '/a.md') return { kind: 'file', content: 'A {{import:/b.md}}' };
      if (path === '/b.md') return { kind: 'file', content: 'B' };
      return null;
    });

    const result = await resolveWorkspaceImports({
      text: 'Start {{import:/a.md}} End',
      sourceFormat: 'markdown',
      resolveFileByPath
    });

    expect(result.resolvedText).toBe('Start A B End');
  });

  it('detects cyclic imports', async () => {
    const resolveFileByPath = vi.fn().mockImplementation(async (path) => {
      if (path === '/a.md') return { kind: 'file', content: '{{import:/a.md}}' };
      return null;
    });

    const result = await resolveWorkspaceImports({
      text: '{{import:/a.md}}',
      sourceFormat: 'markdown',
      resolveFileByPath
    });

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'cycle',
      path: '/a.md'
    }));
  });

  it('handles tex \\input commands', async () => {
    const resolveFileByPath = vi.fn().mockResolvedValue({
      kind: 'file',
      content: 'Tex Content'
    });

    const result = await resolveWorkspaceImports({
      text: 'Result: \\input{sub.tex}',
      sourceFormat: 'tex',
      resolveFileByPath
    });

    expect(result.resolvedText).toBe('Result: Tex Content');
  });
});
