import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useWorkspaceEditor } from '../useWorkspaceEditor';

describe('useWorkspaceEditor hook - Hardened', () => {
  it('prevents removing the last remaining block', () => {
    const { result } = renderHook(() => useWorkspaceEditor());
    expect(result.current.editorBlocks).toHaveLength(1);

    act(() => {
      result.current.removeBlock(0);
    });

    // Should still have 1 block because we don't allow 0 blocks
    expect(result.current.editorBlocks).toHaveLength(1);
  });

  it('correctly handles multi-block selection via range', () => {
    const { result } = renderHook(() => useWorkspaceEditor());
    
    act(() => {
      result.current.insertBlockAfter(0, 'paragraph', { text: 'B2' });
    });
    act(() => {
      result.current.insertBlockAfter(1, 'paragraph', { text: 'B3' });
    });

    const ids = result.current.editorBlocks.map(b => b.id);

    // Step 1: Select first block (becomes anchor)
    act(() => {
      result.current.updateSelectionRange(ids[0], false);
    });
    // Step 2: Shift-select third block
    act(() => {
      result.current.updateSelectionRange(ids[2], true);
    });

    expect(result.current.selectedBlockIds).toHaveLength(3);
    expect(result.current.selectedBlockIds).toContain(ids[0]);
    expect(result.current.selectedBlockIds).toContain(ids[1]);
    expect(result.current.selectedBlockIds).toContain(ids[2]);
  });

  it('resets selection and menu when inserting a new block', () => {
    const { result } = renderHook(() => useWorkspaceEditor());
    
    act(() => {
      result.current.setBlockMenuForId('some-id');
      result.current.insertBlockAfter(0);
    });

    expect(result.current.blockMenuForId).toBeNull();
    expect(result.current.selectedBlockIds).toHaveLength(1);
  });
});
