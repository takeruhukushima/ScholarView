import { useCallback, useEffect, useRef } from "react";
import { SourceFormat } from "@/lib/types";
import { WorkspaceFile } from "@/lib/workspace/types";
import { composeFileNameFromTitle, defaultTitleFromFileName } from "@/lib/workspace/file-logic";

interface UseWorkspaceDocumentSyncProps {
  canEditCurrentFile: boolean;
  canEditTextCurrentFile: boolean;
  activeFile: WorkspaceFile | null;
  sourceText: string;
  sourceFormat: SourceFormat;
  title: string;
  isExistingArticle: boolean;
  isDirtyFile: boolean;
  isDirtyTitle: boolean;
  setSavingFile: (saving: boolean) => void;
  setFiles: React.Dispatch<React.SetStateAction<WorkspaceFile[]>>;
  setTitle: (title: string) => void;
  setStatusMessage: (msg: string) => void;
}

export function useWorkspaceDocumentSync({
  canEditCurrentFile,
  canEditTextCurrentFile,
  activeFile,
  sourceText,
  sourceFormat,
  title,
  isExistingArticle,
  isDirtyFile,
  isDirtyTitle,
  setSavingFile,
  setFiles,
  setTitle,
  setStatusMessage,
}: UseWorkspaceDocumentSyncProps) {
  const saveInFlightRef = useRef(false);
  const titleSaveInFlightRef = useRef(false);

  const saveCurrentFile = useCallback(async (options?: { silent?: boolean }) => {
    if (!canEditTextCurrentFile || !activeFile || activeFile.kind !== "file") {
      return null;
    }
    if (saveInFlightRef.current) {
      return null;
    }

    saveInFlightRef.current = true;
    setSavingFile(true);

    try {
      const response = await fetch(`/api/workspace/files/${encodeURIComponent(activeFile.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: sourceText,
          sourceFormat,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        file?: WorkspaceFile;
        error?: string;
      };

      if (!response.ok || !data.success || !data.file) {
        throw new Error(data.error ?? "Failed to save file");
      }

      setFiles((prev) => prev.map((item) => (item.id === data.file?.id ? data.file : item)));
      if (!options?.silent) {
        setStatusMessage(`Saved ${data.file.name}`);
      }
      return data.file;
    } finally {
      saveInFlightRef.current = false;
      setSavingFile(false);
    }
  }, [activeFile, canEditTextCurrentFile, sourceFormat, sourceText, setFiles, setSavingFile, setStatusMessage]);

  const persistTitleAsFileName = useCallback(async (options?: { silent?: boolean }) => {
    if (!canEditCurrentFile || !activeFile || activeFile.kind !== "file") {
      return null;
    }
    if (isExistingArticle) {
      return null;
    }
    if (titleSaveInFlightRef.current) {
      return null;
    }

    const nextName = composeFileNameFromTitle(title, activeFile.name);
    if (!nextName) {
      return null;
    }
    if (nextName === activeFile.name) {
      return null;
    }

    titleSaveInFlightRef.current = true;
    try {
      const response = await fetch(`/api/workspace/files/${encodeURIComponent(activeFile.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nextName }),
      });
      const data = (await response.json()) as {
        success?: boolean;
        file?: WorkspaceFile;
        error?: string;
      };
      if (!response.ok || !data.success || !data.file) {
        throw new Error(data.error ?? "Failed to save file name");
      }

      setFiles((prev) => prev.map((item) => (item.id === data.file?.id ? data.file : item)));
      setTitle(defaultTitleFromFileName(data.file.name));
      if (!options?.silent) {
        setStatusMessage(`Renamed to ${data.file.name}`);
      }
      return data.file;
    } finally {
      titleSaveInFlightRef.current = false;
    }
  }, [activeFile, canEditCurrentFile, isExistingArticle, title, setFiles, setTitle, setStatusMessage]);

  // Autosave file content
  useEffect(() => {
    if (!isDirtyFile || !canEditTextCurrentFile) return;

    const timer = window.setTimeout(() => {
      void saveCurrentFile({ silent: true }).catch((err: unknown) => {
        setStatusMessage(err instanceof Error ? err.message : "Failed to autosave file");
      });
    }, 800);

    return () => window.clearTimeout(timer);
  }, [canEditTextCurrentFile, isDirtyFile, saveCurrentFile, setStatusMessage]);

  // Sync title to filename
  useEffect(() => {
    if (!isDirtyTitle || !canEditCurrentFile) return;

    const timer = window.setTimeout(() => {
      void persistTitleAsFileName({ silent: true }).catch((err: unknown) => {
        setStatusMessage(err instanceof Error ? err.message : "Failed to save file name");
      });
    }, 800);

    return () => window.clearTimeout(timer);
  }, [canEditCurrentFile, isDirtyTitle, persistTitleAsFileName, setStatusMessage]);

  return {
    saveCurrentFile,
    persistTitleAsFileName,
  };
}
