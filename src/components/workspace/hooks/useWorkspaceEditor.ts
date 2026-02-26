import { useState, useCallback, useRef } from "react";
import { BlockKind, EditorBlock, ImageDropPosition } from "@/lib/workspace/types";
import { newId, resizeTextarea } from "@/lib/workspace/utils";

export function useWorkspaceEditor() {
  const [title, setTitle] = useState("");
  const [authorsText, setAuthorsText] = useState("");
  const [isAuthorsFocused, setIsAuthorsFocused] = useState(false);
  
  const [editorBlocks, setEditorBlocks] = useState<EditorBlock[]>([
    { id: newId(), kind: "paragraph", text: "" },
  ]);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  const [selectionAnchorBlockId, setSelectionAnchorBlockId] = useState<string | null>(null);
  const [blockMenuForId, setBlockMenuForId] = useState<string | null>(null);

  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const titleRef = useRef<HTMLInputElement>(null);
  const authorsRef = useRef<HTMLTextAreaElement>(null);

  const updateBlock = useCallback((id: string, patch: Partial<EditorBlock>) => {
    setEditorBlocks((prev) =>
      prev.map((block) => (block.id === id ? { ...block, ...patch } : block))
    );
  }, []);

  const updateSelectionRange = useCallback(
    (targetId: string, isShift: boolean) => {
      if (isShift && selectionAnchorBlockId) {
        const anchorIndex = editorBlocks.findIndex((b) => b.id === selectionAnchorBlockId);
        const targetIndex = editorBlocks.findIndex((b) => b.id === targetId);
        if (anchorIndex >= 0 && targetIndex >= 0) {
          const start = Math.min(anchorIndex, targetIndex);
          const end = Math.max(anchorIndex, targetIndex);
          const rangeIds = editorBlocks.slice(start, end + 1).map((b) => b.id);
          setSelectedBlockIds(rangeIds);
        }
      } else {
        setSelectedBlockIds([targetId]);
        setSelectionAnchorBlockId(targetId);
      }
    },
    [editorBlocks, selectionAnchorBlockId]
  );

  const insertBlockAfter = useCallback(
    (
      index: number,
      kind: BlockKind = "paragraph",
      options?: { text?: string; selectionStart?: number; selectionEnd?: number }
    ) => {
      const block = { id: newId(), kind, text: options?.text ?? "" };
      const selectionStart = options?.selectionStart ?? 0;
      const selectionEnd = options?.selectionEnd ?? selectionStart;

      setEditorBlocks((prev) => {
        const next = [...prev];
        next.splice(index + 1, 0, block);
        return next;
      });

      setActiveBlockId(block.id);
      setSelectedBlockIds([block.id]);
      setSelectionAnchorBlockId(block.id);
      setBlockMenuForId(null);

      window.setTimeout(() => {
        const textarea = textareaRefs.current[block.id];
        if (!textarea) {
          window.setTimeout(() => {
            const retry = textareaRefs.current[block.id];
            if (!retry) return;
            retry.focus();
            retry.setSelectionRange(selectionStart, selectionEnd);
            resizeTextarea(retry);
          }, 0);
          return;
        }
        textarea.focus();
        textarea.setSelectionRange(selectionStart, selectionEnd);
        resizeTextarea(textarea);
      }, 0);

      return block;
    },
    []
  );

  const removeBlock = useCallback((index: number) => {
    setEditorBlocks((prev) => {
      if (prev.length <= 1) return prev;
      const next = [...prev];
      next.splice(index, 1);

      const fallback = next[index] || next[index - 1];
      window.setTimeout(() => {
        if (fallback) {
          setActiveBlockId(fallback.id);
          setSelectedBlockIds([fallback.id]);
          setSelectionAnchorBlockId(fallback.id);
          window.setTimeout(() => {
            textareaRefs.current[fallback.id]?.focus();
          }, 0);
        }
      }, 0);
      return next;
    });
  }, []);

  const moveBlockByDelta = useCallback((index: number, delta: -1 | 1) => {
    setEditorBlocks((prev) => {
      const block = prev[index];
      if (!block) return prev;

      const idsToMove = selectedBlockIds.includes(block.id) ? selectedBlockIds : [block.id];
      const indices = idsToMove
        .map((id) => prev.findIndex((b) => b.id === id))
        .filter((idx) => idx >= 0)
        .sort((a, b) => a - b);
      
      if (indices.length === 0) return prev;

      const firstIdx = indices[0];
      const lastIdx = indices[indices.length - 1];

      if (delta === -1 && firstIdx === 0) return prev;
      if (delta === 1 && lastIdx === prev.length - 1) return prev;

      const movingBlocks = prev.filter((b) => idsToMove.includes(b.id));
      const remaining = prev.filter((b) => !idsToMove.includes(b.id));

      const targetBlock = prev[delta === -1 ? firstIdx - 1 : lastIdx + 1];
      const targetIdxInRemaining = remaining.findIndex((b) => b.id === targetBlock.id);

      const next = [...remaining];
      next.splice(delta === -1 ? targetIdxInRemaining : targetIdxInRemaining + 1, 0, ...movingBlocks);
      return next;
    });

    setBlockMenuForId(null);
  }, [selectedBlockIds]);

  const moveBlockByDrop = useCallback((draggedId: string, targetId: string, position: ImageDropPosition) => {
    if (draggedId === targetId) return;

    const idsToMove = selectedBlockIds.includes(draggedId) ? selectedBlockIds : [draggedId];

    setEditorBlocks((prev) => {
      const movingBlocks = prev.filter((block) => idsToMove.includes(block.id));
      if (movingBlocks.length === 0) return prev;

      const remaining = prev.filter((block) => !idsToMove.includes(block.id));
      const targetIndexInRemaining = remaining.findIndex((block) => block.id === targetId);
      if (targetIndexInRemaining < 0) return prev;

      const insertAt = position === "before" ? targetIndexInRemaining : targetIndexInRemaining + 1;

      const next = [...remaining];
      next.splice(insertAt, 0, ...movingBlocks);
      return next;
    });

    setBlockMenuForId(null);
    setActiveBlockId(draggedId);
    window.setTimeout(() => {
      const focusWithRetry = (attempt = 0) => {
        const textarea = textareaRefs.current[draggedId];
        if (!textarea) {
          if (attempt < 6) {
            window.setTimeout(() => focusWithRetry(attempt + 1), 0);
          }
          return;
        }
        textarea.focus();
        resizeTextarea(textarea);
      };
      focusWithRetry();
    }, 0);
  }, [selectedBlockIds]);

  const focusBlockByIndex = useCallback((
    index: number,
    options?: {
      position?: "start" | "end";
    },
  ) => {
    setEditorBlocks((prev) => {
      const block = prev[index];
      if (!block) return prev;
      setActiveBlockId(block.id);
      setSelectedBlockIds([block.id]);
      setSelectionAnchorBlockId(block.id);
      setBlockMenuForId(null);
      window.setTimeout(() => {
        const textarea = textareaRefs.current[block.id];
        if (!textarea) return;
        textarea.focus();
        const position = options?.position === "start" ? 0 : textarea.value.length;
        textarea.setSelectionRange(position, position);
        resizeTextarea(textarea);
      }, 0);
      return prev;
    });
  }, []);

  const activateBlockEditor = useCallback((blockId: string, position: "start" | "end" = "start") => {
    setActiveBlockId(blockId);
    setSelectedBlockIds([blockId]);
    setSelectionAnchorBlockId(blockId);
    setBlockMenuForId(null);
    const focusWithRetry = (attempt = 0) => {
      const textarea = textareaRefs.current[blockId];
      if (!textarea) {
        if (attempt < 6) {
          window.setTimeout(() => focusWithRetry(attempt + 1), 0);
        }
        return;
      }
      textarea.focus();
      const pos = position === "start" ? 0 : textarea.value.length;
      textarea.setSelectionRange(pos, pos);
      resizeTextarea(textarea);
    };
    focusWithRetry();
  }, []);

  return {
    title,
    setTitle,
    authorsText,
    setAuthorsText,
    isAuthorsFocused,
    setIsAuthorsFocused,
    editorBlocks,
    setEditorBlocks,
    activeBlockId,
    setActiveBlockId,
    selectedBlockIds,
    setSelectedBlockIds,
    selectionAnchorBlockId,
    setSelectionAnchorBlockId,
    blockMenuForId,
    setBlockMenuForId,
    textareaRefs,
    titleRef,
    authorsRef,
    updateBlock,
    insertBlockAfter,
    removeBlock,
    moveBlockByDelta,
    updateSelectionRange,
    focusBlockByIndex,
    activateBlockEditor,
    moveBlockByDrop,
  };
}
