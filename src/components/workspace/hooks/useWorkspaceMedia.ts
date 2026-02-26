import { useState, useCallback, useEffect, useRef } from "react";
import type { DragEvent } from "react";
import { WorkspaceFile, ImageDropPosition, EditorBlock } from "@/lib/workspace/types";
import { 
  deriveImagePreviewSource, 
  isWorkspaceImageFile, 
  isInlineImageDataUrl, 
  createUniqueImageFileName, 
  sanitizeFileStem, 
  inferImageExtension,
  toFigureLabel
} from "@/lib/workspace/image-logic";
import { resolveWorkspacePathFromDocument, normalizeWorkspacePath } from "@/lib/workspace/file-logic";
import { newId } from "@/lib/workspace/utils";

interface UseWorkspaceMediaProps {
  files: WorkspaceFile[];
  setFiles: React.Dispatch<React.SetStateAction<WorkspaceFile[]>>;
  activeFile: WorkspaceFile | null;
  activeFilePath: string | null;
  workspaceFilesByPath: Map<string, WorkspaceFile>;
  editorBlocks: EditorBlock[];
  setEditorBlocks: React.Dispatch<React.SetStateAction<EditorBlock[]>>;
  activeBlockId: string | null;
  setActiveBlockId: (id: string | null) => void;
  canEditTextCurrentFile: boolean;
  isBibWorkspaceFile: boolean;
  sessionDid: string | null;
  setBusy: (busy: boolean) => void;
  setStatusMessage: (msg: string) => void;
  loadFiles: (did: string | null, setBusy: (b: boolean) => void, setStatusMessage: (m: string) => void) => Promise<WorkspaceFile[]>;
  filePathMap: Map<string, string>;
}

export function useWorkspaceMedia({
  files,
  setFiles,
  activeFile,
  activeFilePath,
  workspaceFilesByPath,
  editorBlocks,
  setEditorBlocks,
  activeBlockId,
  setActiveBlockId,
  canEditTextCurrentFile,
  isBibWorkspaceFile,
  sessionDid,
  setBusy,
  setStatusMessage,
  loadFiles,
  filePathMap,
}: UseWorkspaceMediaProps) {
  const [activeImagePreviewSrc, setActiveImagePreviewSrc] = useState<string | null>(null);
  const [imageDropTarget, setImageDropTarget] = useState<{
    blockId: string;
    position: ImageDropPosition;
  } | null>(null);
  const imagePreviewFetchRequestedRef = useRef(new Set<string>());

  const resolveWorkspaceImageSrc = useCallback(
    (input: string) => {
      const trimmed = input.trim();
      if (!trimmed) return input;
      const match = trimmed.match(/^workspace:\/\/(.+)$/);
      if (match) {
        const file = files.find((item) => item.id === match[1]);
        if (!file || file.kind !== "file" || !file.content) return trimmed;
        return file.content;
      }
      if (isInlineImageDataUrl(trimmed)) return trimmed;
      const resolvedPath = resolveWorkspacePathFromDocument(trimmed, activeFilePath);
      if (!resolvedPath) return trimmed;
      const file = workspaceFilesByPath.get(resolvedPath);
      if (!file || !file.content) return trimmed;
      return isWorkspaceImageFile(file) ? file.content : trimmed;
    },
    [activeFilePath, files, workspaceFilesByPath],
  );

  // Handle automatic fetching of image content for preview
  useEffect(() => {
    const isImageFile = activeFile && isWorkspaceImageFile(activeFile);
    if (!activeFile || activeFile.kind !== "file" || !isImageFile) {
      setActiveImagePreviewSrc(null);
      return;
    }

    const fromContent = deriveImagePreviewSource(activeFile.content, resolveWorkspaceImageSrc);
    if (fromContent) {
      setActiveImagePreviewSrc(fromContent);
      return;
    }

    const fromIdRef = deriveImagePreviewSource(`workspace://${activeFile.id}`, resolveWorkspaceImageSrc);
    if (fromIdRef) {
      setActiveImagePreviewSrc(fromIdRef);
      return;
    }

    if (imagePreviewFetchRequestedRef.current.has(activeFile.id)) {
      setActiveImagePreviewSrc(null);
      return;
    }
    imagePreviewFetchRequestedRef.current.add(activeFile.id);

    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/workspace/files/${encodeURIComponent(activeFile.id)}`, {
          cache: "no-store",
        });
        const data = (await response.json()) as { success?: boolean; file?: WorkspaceFile };
        if (!response.ok || !data.success || !data.file || cancelled) {
          return;
        }

        setFiles((prev) =>
          prev.map((item) => (item.id === data.file?.id ? data.file : item)),
        );
        const resolved =
          deriveImagePreviewSource(data.file.content, resolveWorkspaceImageSrc) ??
          deriveImagePreviewSource(`workspace://${data.file.id}`, resolveWorkspaceImageSrc);
        if (!cancelled) {
          setActiveImagePreviewSrc(resolved);
        }
      } catch {
        if (!cancelled) {
          setActiveImagePreviewSrc(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeFile, resolveWorkspaceImageSrc, setFiles]);

  const readFileAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          resolve(reader.result);
          return;
        }
        reject(new Error("Failed to read image file"));
      };
      reader.onerror = () => reject(new Error("Failed to read image file"));
      reader.readAsDataURL(file);
    });

  const handleImageDrop = async (
    event: DragEvent<HTMLElement>,
    insertAt?: { blockId: string; position: ImageDropPosition } | null,
  ) => {
    if (
      !canEditTextCurrentFile ||
      isBibWorkspaceFile ||
      !sessionDid ||
      !activeFile ||
      activeFile.kind !== "file"
    ) {
      return;
    }
    const dropped = Array.from(event.dataTransfer.files ?? []).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (dropped.length === 0) return;

    event.preventDefault();
    event.stopPropagation();

    try {
      const findInsertIndex = (): number => {
        if (insertAt?.blockId) {
          const blockIndex = editorBlocks.findIndex((block) => block.id === insertAt.blockId);
          if (blockIndex >= 0) {
            return insertAt.position === "before" ? blockIndex : blockIndex + 1;
          }
        }

        const fromTarget =
          event.target instanceof HTMLElement
            ? event.target.closest<HTMLElement>("[data-editor-block-id]")?.dataset.editorBlockId
            : undefined;
        if (fromTarget) {
          const blockIndex = editorBlocks.findIndex((block) => block.id === fromTarget);
          if (blockIndex >= 0) return blockIndex + 1;
        }

        if (activeBlockId) {
          const activeIndex = editorBlocks.findIndex((block) => block.id === activeBlockId);
          if (activeIndex >= 0) return activeIndex + 1;
        }
        return editorBlocks.length;
      };

      let insertIndex = findInsertIndex();
      let lastInsertedId: string | null = null;
      const targetFolderId = activeFile.parentId;
      const targetFolderPath = targetFolderId ? (filePathMap.get(targetFolderId) ?? "") : "";
      const takenImageNames = new Set(
        files
          .filter((file) => file.kind === "file" && file.parentId === targetFolderId)
          .map((file) => file.name.toLowerCase()),
      );
      for (const image of dropped) {
        const dataUrl = await readFileAsDataUrl(image);
        const ext = inferImageExtension(image.name, image.type);
        const stem = sanitizeFileStem(image.name);
        const fileName = createUniqueImageFileName(stem, ext, takenImageNames);
        const response = await fetch("/api/workspace/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            parentId: targetFolderId,
            name: fileName,
            kind: "file",
            format: "markdown",
            content: dataUrl,
          }),
        });
        const data = (await response.json()) as { success?: boolean; file?: WorkspaceFile; error?: string };
        if (!response.ok || !data.success || !data.file) {
          throw new Error(data.error ?? "Failed to store image");
        }

        const figureLabel = toFigureLabel(stem);
        const imagePath = normalizeWorkspacePath(`${targetFolderPath}/${fileName}`);
        const token = `![${stem}](${imagePath}){#${figureLabel} width=0.8 align=center}`;
        const insertedId = newId();
        setEditorBlocks((prev) => {
          const next = [...prev];
          const clamped = Math.max(0, Math.min(insertIndex, next.length));
          next.splice(clamped, 0, { id: insertedId, kind: "paragraph", text: token });
          return next;
        });
        insertIndex += 1;
        lastInsertedId = insertedId;
      }
      if (lastInsertedId) {
        setActiveBlockId(lastInsertedId);
      }
      await loadFiles(sessionDid, setBusy, setStatusMessage);
      setStatusMessage("Inserted image figure block(s).");
    } catch (err: unknown) {
      setStatusMessage(err instanceof Error ? err.message : "Failed to insert image");
    } finally {
      setImageDropTarget(null);
    }
  };

  return {
    activeImagePreviewSrc,
    imageDropTarget,
    setImageDropTarget,
    resolveWorkspaceImageSrc,
    handleImageDrop,
  };
}
