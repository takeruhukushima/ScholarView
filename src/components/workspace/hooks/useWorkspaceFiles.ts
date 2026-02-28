import { useState, useCallback } from "react";
import { WorkspaceFile } from "@/lib/workspace/types";
import { triggerFileDownload } from "@/lib/workspace/utils";
import { isWorkspaceImageFile } from "@/lib/workspace/image-logic";

export function useWorkspaceFiles() {
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);

  const loadFiles = useCallback(async (
    sessionDid: string | null,
    setBusy: (b: boolean) => void,
    setStatusMessage: (m: string) => void
  ) => {
    try {
      setBusy(true);
      const response = await fetch("/api/workspace/files", { cache: "no-store" });
      const data = (await response.json()) as {
        success?: boolean;
        files?: WorkspaceFile[];
        error?: string;
      };

      if (!response.ok || !data.success || !data.files) {
        throw new Error(data.error ?? "Failed to load workspace files");
      }

      setFiles(data.files);
      return data.files;
    } catch (err: unknown) {
      setStatusMessage(err instanceof Error ? err.message : "Failed to load files");
      return [] as WorkspaceFile[];
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    files,
    setFiles,
    activeFileId,
    setActiveFileId,
    loadFiles,
    createWorkspaceItem: async (
      name: string,
      kind: "folder" | "file",
      parentId: string | null,
      sessionDid: string | null,
      setBusy: (b: boolean) => void,
      setStatusMessage: (m: string) => void
    ) => {
      try {
        setBusy(true);
        const response = await fetch("/api/workspace/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, kind, parentId }),
        });
        const data = (await response.json()) as { success?: boolean; file?: WorkspaceFile; error?: string };

        if (!response.ok || !data.success || !data.file) {
          throw new Error(data.error ?? "Failed to create item");
        }

        await loadFiles(sessionDid, setBusy, setStatusMessage);
        return data.file;
      } catch (err: unknown) {
        setStatusMessage(err instanceof Error ? err.message : "Failed to create item");
        return null;
      } finally {
        setBusy(false);
      }
    },
    deleteFileItem: async (
      fileId: string,
      sessionDid: string | null,
      setBusy: (b: boolean) => void,
      setStatusMessage: (m: string) => void
    ) => {
      try {
        setBusy(true);
        const response = await fetch(`/api/workspace/files/${encodeURIComponent(fileId)}`, {
          method: "DELETE",
        });
        const data = (await response.json()) as { success?: boolean; error?: string };
        if (!response.ok || !data.success) {
          throw new Error(data.error ?? "Failed to delete item");
        }
        const latestFiles = await loadFiles(sessionDid, setBusy, setStatusMessage);
        return latestFiles;
      } catch (err: unknown) {
        setStatusMessage(err instanceof Error ? err.message : "Failed to delete item");
        return null;
      } finally {
        setBusy(false);
      }
    },
    moveWorkspaceItem: async (
      draggedId: string,
      targetId: string,
      position: string,
      sessionDid: string | null,
      setBusy: (b: boolean) => void,
      setStatusMessage: (m: string) => void
    ) => {
      try {
        setBusy(true);
        const response = await fetch("/api/workspace/files/move", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draggedId, targetId, position }),
        });
        const data = (await response.json()) as {
          success?: boolean;
          error?: string;
          updates?: Array<{ id: string; oldPath: string; newPath: string }>;
        };

        if (!response.ok || !data.success) {
          throw new Error(data.error ?? "Failed to move item");
        }

        const latestFiles = await loadFiles(sessionDid, setBusy, setStatusMessage);
        return { latestFiles, updates: data.updates || [] };
      } catch (err: unknown) {
        setStatusMessage(err instanceof Error ? err.message : "Failed to move item");
        return null;
      } finally {
        setBusy(false);
      }
    },
    renameFileItem: async (
      fileId: string,
      nextName: string,
      sessionDid: string | null,
      setBusy: (b: boolean) => void,
      setStatusMessage: (m: string) => void
    ) => {
      try {
        setBusy(true);
        const response = await fetch(`/api/workspace/files/${encodeURIComponent(fileId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: nextName }),
        });
        const data = (await response.json()) as { success?: boolean; error?: string };
        if (!response.ok || !data.success) {
          throw new Error(data.error ?? "Failed to rename item");
        }
        await loadFiles(sessionDid, setBusy, setStatusMessage);
        return true;
      } catch (err: unknown) {
        setStatusMessage(err instanceof Error ? err.message : "Failed to rename item");
        return false;
      } finally {
        setBusy(false);
      }
    },
    downloadFileItem: async (
      file: WorkspaceFile,
      setBusy: (b: boolean) => void,
      setStatusMessage: (m: string) => void
    ) => {
      if (file.kind !== "file") return;
      try {
        setBusy(true);
        let content = file.content;
        if (!content && isWorkspaceImageFile(file)) {
          const response = await fetch(`/api/workspace/files/${encodeURIComponent(file.id)}`);
          const data = (await response.json()) as { success?: boolean; file?: WorkspaceFile };
          if (data.success && data.file) {
            content = data.file.content;
          }
        }
        if (!content) {
          setStatusMessage("No content available for download.");
          return;
        }
        triggerFileDownload(file.name, content);
        setStatusMessage(`Downloaded ${file.name}`);
      } catch (err: unknown) {
        setStatusMessage(err instanceof Error ? err.message : "Failed to download file");
      } finally {
        setBusy(false);
      }
    },
  };
}
