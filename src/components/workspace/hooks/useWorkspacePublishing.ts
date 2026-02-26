import { useCallback } from "react";
import { SourceFormat, WorkspaceFile, ArticleAuthor, BibliographyEntry, ArticleSummary } from "@/lib/types";
import { parseAuthors } from "@/lib/articles/authors";
import { exportSource } from "@/lib/export/document";
import { sanitizeFileStem } from "@/lib/workspace/image-logic";

interface UseWorkspacePublishingProps {
  sessionDid: string | null;
  activeFile: WorkspaceFile | null;
  title: string;
  authorsText: string;
  broadcastToBsky: boolean;
  resolvedBibliography: BibliographyEntry[];
  sourceText: string;
  sourceFormat: SourceFormat;
  currentDid: string | null;
  currentRkey: string | null;
  missingCitationKeys: string[];
  tab: string;
  setBusy: (busy: boolean) => void;
  setStatusMessage: (msg: string) => void;
  setBroadcastToBsky: (val: boolean) => void;
  setFiles: React.Dispatch<React.SetStateAction<WorkspaceFile[]>>;
  setCurrentDid: (val: string | null) => void;
  setCurrentRkey: (val: string | null) => void;
  setActiveArticleUri: (val: string | null) => void;
  setCurrentAuthorDid: (val: string | null) => void;
  saveCurrentFile: (options?: { silent?: boolean }) => Promise<WorkspaceFile | null>;
  refreshArticles: () => Promise<void>;
  loadDiscussion: () => Promise<void>;
  normalizeWorkspaceImageUrisForExport: (input: string) => string;
}

export function useWorkspacePublishing({
  sessionDid,
  activeFile,
  title,
  authorsText,
  broadcastToBsky,
  resolvedBibliography,
  sourceText,
  sourceFormat,
  currentDid,
  currentRkey,
  missingCitationKeys,
  tab,
  setBusy,
  setStatusMessage,
  setBroadcastToBsky,
  setFiles,
  setCurrentDid,
  setCurrentRkey,
  setActiveArticleUri,
  setCurrentAuthorDid,
  saveCurrentFile,
  refreshArticles,
  loadDiscussion,
  normalizeWorkspaceImageUrisForExport,
}: UseWorkspacePublishingProps) {

  const handlePublish = async () => {
    if (!activeFile || activeFile.kind !== "file") {
      setStatusMessage("Select a file and ensure you have edit permission.");
      return;
    }
    const isImage = activeFile.name.match(/\.(png|jpe?g|gif|webp|svg)$/i);
    if (isImage) {
      setStatusMessage("Image files cannot be published.");
      return;
    }
    if (activeFile.name.toLowerCase().endsWith(".bib")) {
      setStatusMessage("BibTeX files are citation data and cannot be published.");
      return;
    }

    if (!title.trim()) {
      setStatusMessage("Title is required.");
      return;
    }

    setBusy(true);
    try {
      await saveCurrentFile({ silent: true });

      const response = await fetch(
        `/api/workspace/files/${encodeURIComponent(activeFile.id)}/publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            authors: parseAuthors(authorsText),
            broadcastToBsky,
            bibliography: resolvedBibliography.map((entry) => ({
              key: entry.key,
              rawBibtex: entry.rawBibtex,
            })),
          }),
        }
      );

      const data = (await response.json()) as {
        success?: boolean;
        did?: string;
        rkey?: string;
        uri?: string;
        broadcasted?: 0 | 1;
        file?: WorkspaceFile;
        diagnostics?: Array<{ code: string; path: string; message: string }>;
        error?: string;
      };

      if (!response.ok || !data.success || !data.did || !data.rkey) {
        throw new Error(data.error ?? "Failed to publish file");
      }

      setCurrentDid(data.did);
      setCurrentRkey(data.rkey);
      setActiveArticleUri(data.uri ?? null);
      setCurrentAuthorDid(sessionDid ?? null);
      setBroadcastToBsky(data.broadcasted === 1);
      if (data.file) {
        setFiles((prev) => prev.map((item) => (item.id === data.file?.id ? data.file : item)));
      }

      await refreshArticles();
      if (tab === "discussion") {
        await loadDiscussion();
      }

      if (data.diagnostics && data.diagnostics.length > 0) {
        setStatusMessage(`Published with ${data.diagnostics.length} import warning(s).`);
      } else if (missingCitationKeys.length > 0) {
        setStatusMessage(`Published with ${missingCitationKeys.length} missing citation warning(s).`);
      } else {
        setStatusMessage("Published article.");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleUnpublish = async () => {
    if (!currentDid || !currentRkey) {
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(
        `/api/articles/${encodeURIComponent(currentDid)}/${encodeURIComponent(currentRkey)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            sourceFormat,
            broadcastToBsky: false,
            ...(sourceFormat === "tex" ? { tex: sourceText } : { markdown: sourceText }),
            bibliography: resolvedBibliography.map((entry) => ({
              key: entry.key,
              rawBibtex: entry.rawBibtex,
            })),
          }),
        }
      );

      const data = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "Failed to unpublish article");
      }

      setBroadcastToBsky(false);
      setStatusMessage("Unpublished from Bluesky.");
    } finally {
      setBusy(false);
    }
  };

  const downloadTextAsFile = (filename: string, text: string, mimeType = "text/plain;charset=utf-8") => {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const handleExport = (target: "md" | "tex") => {
    const normalizedSource = normalizeWorkspaceImageUrisForExport(sourceText);
    const result = exportSource(normalizedSource, sourceFormat, target, resolvedBibliography);
    const base = sanitizeFileStem(title || activeFile?.name || "untitled");
    downloadTextAsFile(`${base}.${target}`, result.content);
    if (missingCitationKeys.length > 0) {
      setStatusMessage(`Exported with ${missingCitationKeys.length} unresolved citation warning(s).`);
    } else {
      setStatusMessage(`Exported ${base}.${target}`);
    }
  };

  return {
    handlePublish,
    handleUnpublish,
    handleExport,
  };
}
