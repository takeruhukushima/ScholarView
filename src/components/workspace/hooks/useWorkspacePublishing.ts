import { useState } from "react";
import { SourceFormat } from "@/lib/types";
import { BibliographyEntry } from "@/lib/articles/citations";
import { WorkspaceFile } from "@/lib/workspace/types";
import { parseAuthors } from "@/lib/articles/authors";
import { exportSource } from "@/lib/export/document";
import { sanitizeFileStem, isWorkspaceImageFile } from "@/lib/workspace/image-logic";
import { triggerFileDownload } from "@/lib/workspace/utils";

export interface ExportPreview {
  content: string;
  bibSource?: string;
  target: "md" | "tex";
  filename: string;
  includeBib: boolean;
}

interface UseWorkspacePublishingProps {
  sessionDid: string | null;
  activeFile: WorkspaceFile | null;
  title: string;
  authorsText: string;
  broadcastToBsky: boolean;
  resolvedBibliography: BibliographyEntry[];
  projectBibEntries: BibliographyEntry[];
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
  files: WorkspaceFile[];
}

export function useWorkspacePublishing({
  sessionDid,
  activeFile,
  title,
  authorsText,
  broadcastToBsky,
  resolvedBibliography,
  projectBibEntries,
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
  files,
}: UseWorkspacePublishingProps) {
  const [exportPreview, setExportPreview] = useState<ExportPreview | null>(null);

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

  const handleExport = (target: "md" | "tex") => {
    const normalizedSource = normalizeWorkspaceImageUrisForExport(sourceText);
    const result = exportSource(
      normalizedSource,
      sourceFormat,
      target,
      resolvedBibliography,
      projectBibEntries,
    );
    const base = sanitizeFileStem(title || activeFile?.name || "untitled");

    setExportPreview({
      content: result.content,
      bibSource: result.bibSource,
      target,
      filename: `${base}.${target}`,
      includeBib: false,
    });
  };

  const handleExportToFolder = async () => {
    if (!exportPreview) return;
    if (!("showDirectoryPicker" in window)) {
      setStatusMessage("Your browser does not support folder export.");
      return;
    }
    
    try {
      // @ts-expect-error - File System Access API is not yet in all TS environments
      const dirHandle = await window.showDirectoryPicker();
      setBusy(true);
      
      const target = exportPreview.target;
      
      // Normalize images to be flat in the same directory
      const flattenImageUris = (input: string) =>
        input.replace(/!\[([^\]]*)\]\(workspace:\/\/([^)]+)\)(\{[^}]*\})?/g, (_all, alt, id, attrs) => {
          const file = files.find((item) => item.id === id);
          if (!file || file.kind !== "file") return _all;
          return `![${alt}](${file.name})${attrs ?? ""}`;
        });
      const normalizedSource = flattenImageUris(sourceText);

      const result = exportSource(
        normalizedSource,
        sourceFormat,
        target,
        resolvedBibliography,
        projectBibEntries,
      );
      
      const docHandle = await dirHandle.getFileHandle(exportPreview.filename, { create: true });
      const writable = await docHandle.createWritable();
      await writable.write(result.content);
      await writable.close();

      if (result.bibSource) {
        const bibHandle = await dirHandle.getFileHandle("references.bib", { create: true });
        const bibWritable = await bibHandle.createWritable();
        await bibWritable.write(result.bibSource);
        await bibWritable.close();
      }

      if (activeFile && activeFile.parentId) {
        const siblings = files.filter((f) => f.parentId === activeFile.parentId && isWorkspaceImageFile(f));
        let imgCount = 0;
        for (const img of siblings) {
          let imgContent = img.content;
          if (!imgContent) {
            try {
              const response = await fetch(`/api/workspace/files/${encodeURIComponent(img.id)}`);
              const data = await response.json() as { success?: boolean; file?: WorkspaceFile };
              if (data.success && data.file) {
                imgContent = data.file.content;
              }
            } catch (e) {
              console.error(`Failed to fetch image content for ${img.name}`, e);
            }
          }
          if (imgContent) {
            try {
              const res = await fetch(imgContent);
              const blob = await res.blob();
              const imgHandle = await dirHandle.getFileHandle(img.name, { create: true });
              const imgWritable = await imgHandle.createWritable();
              await imgWritable.write(blob);
              await imgWritable.close();
              imgCount++;
            } catch (e) {
              console.error(`Failed to write image ${img.name}`, e);
            }
          }
        }
        setStatusMessage(`Exported project (${exportPreview.filename}, ${imgCount} image(s) and .bib) to folder.`);
      } else {
        setStatusMessage(`Exported project (${exportPreview.filename} and .bib) to folder.`);
      }
      setExportPreview(null);
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        setStatusMessage(`Folder export failed: ${err.message}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleExportImage = async () => {
    if (!activeFile || !isWorkspaceImageFile(activeFile)) return;
    try {
      setBusy(true);
      let content = activeFile.content;
      if (!content) {
        const response = await fetch(`/api/workspace/files/${encodeURIComponent(activeFile.id)}`);
        const data = await response.json() as { success?: boolean; file?: WorkspaceFile };
        if (data.success && data.file) {
          content = data.file.content;
        }
      }
      if (content) {
        triggerFileDownload(activeFile.name, content);
        setStatusMessage(`Exported ${activeFile.name}`);
      }
    } catch (err: unknown) {
      setStatusMessage(err instanceof Error ? err.message : "Failed to export image");
    } finally {
      setBusy(false);
    }
  };

  const confirmExport = () => {
    if (!exportPreview) return;
    const { content, bibSource, filename, includeBib } = exportPreview;
    let finalContent = content;
    if (includeBib && bibSource) {
      if (exportPreview.target === "md") {
        finalContent += `\n\n## Project BibTeX Source\n\n\`\`\`bibtex\n${bibSource}\n\`\`\``;
      } else {
        const bibBlock = `\\begin{filecontents}{project_references.bib}\n${bibSource}\n\\end{filecontents}\n\n`;
        finalContent = bibBlock + finalContent;
      }
    }
    triggerFileDownload(filename, finalContent);
    setExportPreview(null);
    if (missingCitationKeys.length > 0) {
      setStatusMessage(`Exported with ${missingCitationKeys.length} unresolved citation warning(s).`);
    } else {
      setStatusMessage(`Exported ${filename}`);
    }
  };

  const cancelExport = () => {
    setExportPreview(null);
  };

  const toggleIncludeBibInExport = () => {
    setExportPreview((prev) => (prev ? { ...prev, includeBib: !prev.includeBib } : null));
  };

  return {
    handlePublish,
    handleUnpublish,
    handleExport,
    confirmExportToFolder: handleExportToFolder,
    handleExportImage,
    exportPreview,
    confirmExport,
    cancelExport,
    toggleIncludeBibInExport,
  };
}
