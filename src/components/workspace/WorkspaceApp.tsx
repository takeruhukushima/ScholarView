"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { type BibliographyEntry } from "@/lib/articles/citations";
import type { ArticleSummary, SourceFormat } from "@/lib/types";
import {
  type RightTab,
  type TreeDropPosition,
  type WorkspaceFile,
  type BlockMoveDropTarget,
} from "@/lib/workspace/types";
import {
  newId,
  resizeTextarea,
} from "@/lib/workspace/utils";
import {
  editorBlocksToSource,
  inferSourceFormat,
  sourceToEditorBlocks,
  bibEditorBlocksToSource,
} from "@/lib/workspace/editor-logic";
import {
  buildFilePathMap,
  defaultTitleFromFileName,
  ensureFileExtension,
  resolveWorkspacePathFromDocument,
} from "@/lib/workspace/file-logic";
import {
  isWorkspaceImageFile,
  rewriteImagePathReferencesInMarkdown,
} from "@/lib/workspace/image-logic";
import { Sidebar } from "./UI/Sidebar";
import { EditorPanel } from "./UI/EditorPanel";
import { RightPanel } from "./UI/RightPanel";
import { MobileNavBar } from "./UI/MobileNavBar";
import { OnboardingTour } from "./OnboardingTour";
import { useWorkspaceFiles } from "./hooks/useWorkspaceFiles";
import { useWorkspaceEditor } from "./hooks/useWorkspaceEditor";
import { useWorkspaceDiscussion } from "./hooks/useWorkspaceDiscussion";
import { useWorkspacePublishing } from "./hooks/useWorkspacePublishing";
import { useWorkspaceMedia } from "./hooks/useWorkspaceMedia";
import { useWorkspaceNavigation } from "./hooks/useWorkspaceNavigation";
import { useWorkspaceDocumentSync } from "./hooks/useWorkspaceDocumentSync";
import { useWorkspaceCitations } from "./hooks/useWorkspaceCitations";

const TUTORIAL_STORAGE_KEY = "scholarview:tutorial:v1";

interface WorkspaceAppProps {
  initialArticles: ArticleSummary[];
  sessionDid: string | null;
  accountHandle?: string | null;
}

export function WorkspaceApp({ initialArticles, sessionDid, accountHandle }: WorkspaceAppProps) {
  const [articles, setArticles] = useState<ArticleSummary[]>(initialArticles);
  const [activeArticleUri, setActiveArticleUri] = useState<string | null>(null);
  const [sourceFormat, setSourceFormat] = useState<SourceFormat>("markdown");
  const [articleBibliography, setArticleBibliography] = useState<BibliographyEntry[]>([]);
  const [broadcastToBsky, setBroadcastToBsky] = useState(true);

  const [currentDid, setCurrentDid] = useState<string | null>(null);
  const [currentRkey, setCurrentRkey] = useState<string | null>(null);
  const [currentAuthorDid, setCurrentAuthorDid] = useState<string | null>(null);

  const [tab, setTab] = useState<RightTab>("discussion");
  const [mobileView, setMobileView] = useState<"files" | "editor" | "discussion">("editor");
  const [statusMessage, setStatusMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [savingFile, setSavingFile] = useState(false);
  const [draggingEditorBlockId, setDraggingEditorBlockId] = useState<string | null>(null);
  const [blockMoveDropTarget, setBlockMoveDropTarget] = useState<BlockMoveDropTarget | null>(null);
  const bibHighlightScrollRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const legacySyncRequestedRef = useRef(false);
  const draggingEditorBlockIdRef = useRef<string | null>(null);

  const {
    files,
    setFiles,
    activeFileId,
    setActiveFileId,
    loadFiles,
    createWorkspaceItem: apiCreateItem,
    deleteFileItem: apiDeleteItem,
    moveWorkspaceItem: apiMoveItem,
    renameFileItem: apiRenameItem,
    downloadFileItem,
  } = useWorkspaceFiles();

  const activeFile = useMemo(
    () => files.find((file) => file.id === activeFileId) ?? null,
    [files, activeFileId],
  );
  const filePathMap = useMemo(() => buildFilePathMap(files), [files]);
  const activeFilePath = useMemo(
    () =>
      activeFile?.kind === "file"
        ? (filePathMap.get(activeFile.id) ?? null)
        : null,
    [activeFile, filePathMap],
  );
  const workspaceFilesByPath = useMemo(() => {
    const map = new Map<string, WorkspaceFile>();
    for (const file of files) {
      if (file.kind !== "file") continue;
      const path = filePathMap.get(file.id);
      if (!path) continue;
      map.set(path, file);
    }
    return map;
  }, [filePathMap, files]);

  const {
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
    setBlockMenuForId,
    textareaRefs,
    titleRef,
    authorsRef,
    updateBlock,
    updateSelectionRange,
    insertBlockAfter,
    removeBlock,
    focusBlockByIndex,
    activateBlockEditor,
    moveBlockByDrop,
  } = useWorkspaceEditor();

  const isLoggedIn = Boolean(sessionDid);
  const isImageWorkspaceFile = Boolean(
    activeFile && isWorkspaceImageFile(activeFile),
  );
  const isBibWorkspaceFile = Boolean(
    activeFile?.kind === "file" && activeFile.name.toLowerCase().endsWith(".bib"),
  );
  const isExistingArticle = Boolean(currentDid && currentRkey);
  const canEditArticle = !isExistingArticle || (isLoggedIn && currentAuthorDid === sessionDid);
  const canEditCurrentFile = Boolean(canEditArticle && activeFile?.kind === "file");
  const canEditTextCurrentFile = canEditCurrentFile && !isImageWorkspaceFile;
  const canPublishCurrentFile = canEditCurrentFile && !isBibWorkspaceFile && !isImageWorkspaceFile;
  const hasOpenDocument = Boolean((activeFile && activeFile.kind === "file") || activeArticleUri);

  const {
    activeImagePreviewSrc,
    imageDropTarget,
    setImageDropTarget,
    resolveWorkspaceImageSrc,
    handleImageDrop,
  } = useWorkspaceMedia({
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
  });

  const articleByUri = useMemo(() => {
    const map = new Map<string, ArticleSummary>();
    for (const article of articles) map.set(article.uri, article);
    return map;
  }, [articles]);

  const syncLegacyArticles = useCallback(
    async (options?: { force?: boolean; silent?: boolean }) => {
      if (!sessionDid) return 0;
      const force = options?.force === true;
      if (!force && legacySyncRequestedRef.current) return 0;
      if (!force) {
        legacySyncRequestedRef.current = true;
      }

      try {
        const response = await fetch("/api/workspace/sync-articles", {
          method: "POST",
          cache: "no-store",
        });
        const data = (await response.json()) as {
          success?: boolean;
          created?: number;
          error?: string;
        };
        if (!response.ok || !data.success) {
          throw new Error(data.error ?? "Failed to sync legacy articles");
        }
        const created = data.created ?? 0;
        if (created > 0) {
          await loadFiles(sessionDid, setBusy, setStatusMessage);
        }
        if (!options?.silent) {
          setStatusMessage(
            created > 0
              ? `Linked ${created} article(s) to the file tree`
              : "No unlinked articles found",
          );
        }
        return created;
      } catch (err: unknown) {
        setStatusMessage(err instanceof Error ? err.message : "Failed to sync legacy articles");
        return 0;
      }
    },
    [loadFiles, sessionDid, setBusy, setStatusMessage],
  );

  const blockSourceText = useMemo(
    () => editorBlocksToSource(editorBlocks, sourceFormat),
    [editorBlocks, sourceFormat],
  );
  const bibSourceText = useMemo(() => bibEditorBlocksToSource(editorBlocks), [editorBlocks]);
  const sourceText = useMemo(() => {
    if (isImageWorkspaceFile) return activeFile?.content ?? "";
    return isBibWorkspaceFile ? bibSourceText : blockSourceText;
  }, [activeFile, bibSourceText, blockSourceText, isBibWorkspaceFile, isImageWorkspaceFile]);
  const isDirtyFile = useMemo(() => {
    if (!canEditCurrentFile || !activeFile || activeFile.kind !== "file") {
      return false;
    }
    const currentContent = activeFile.content ?? "";
    const currentFormat = activeFile.sourceFormat ?? inferSourceFormat(activeFile.name, null);
    return currentContent !== sourceText || currentFormat !== sourceFormat;
  }, [activeFile, canEditCurrentFile, sourceFormat, sourceText]);
  const isDirtyTitle = useMemo(() => {
    if (!canEditCurrentFile || !activeFile || activeFile.kind !== "file") {
      return false;
    }
    if (isExistingArticle) {
      return false;
    }
    return title.trim() !== defaultTitleFromFileName(activeFile.name);
  }, [activeFile, canEditCurrentFile, isExistingArticle, title]);

  const {
    discussionRoot,
    discussionPosts,
    replyDrafts,
    setReplyDrafts,
    selectedQuote,
    setSelectedQuote,
    quoteComment,
    setQuoteComment,
    loadDiscussion,
    submitInlineComment,
    runEngagement,
  } = useWorkspaceDiscussion({
    sessionDid,
    currentDid,
    currentRkey,
    setBusy,
    setStatusMessage,
    setTab,
  });

  const {
    citationMenu,
    setCitationMenu,
    citationMenuIndex,
    setCitationMenuIndex,
    projectBibEntries,
    resolvedBibliography,
    missingCitationKeys,
    citationNumberByKey,
    renderCitationLookup,
    updateCitationMenu,
    filteredCitationEntries,
    applyCitationSuggestion,
    formatBibtexBlockById,
  } = useWorkspaceCitations({
    files,
    activeFileId,
    articleBibliography,
    sourceText,
    isImageWorkspaceFile,
    setEditorBlocks,
    textareaRefs,
  });

  const {
    openFile,
    openArticle,
  } = useWorkspaceNavigation({
    files,
    sessionDid,
    articleByUri,
    loadFiles,
    syncLegacyArticles,
    setActiveFileId,
    setActiveArticleUri,
    setSourceFormat,
    setEditorBlocks,
    setCurrentDid,
    setCurrentRkey,
    setCurrentAuthorDid,
    setTitle,
    setAuthorsText,
    setBroadcastToBsky,
    setArticleBibliography,
    setSelectedQuote,
    setQuoteComment,
    setShowMoreMenu,
    setActiveBlockId,
    setBlockMenuForId,
    setCitationMenu,
    setStatusMessage,
    setBusy,
  });

  useEffect(() => {
    setArticles(initialArticles);
  }, [initialArticles]);

  useEffect(() => {
    draggingEditorBlockIdRef.current = draggingEditorBlockId;
  }, [draggingEditorBlockId]);

  const {
    saveCurrentFile,
    persistTitleAsFileName,
  } = useWorkspaceDocumentSync({
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
  });

  const readOnlyMessage = isExistingArticle && !isLoggedIn
    ? "この論文はサーバー上に存在するため、ログインしないと編集できません。"
    : isExistingArticle && currentAuthorDid !== sessionDid
      ? "この論文は閲覧専用です（編集は作成者のみ）。"
      : isExistingArticle && !canEditCurrentFile
        ? "この投稿はワークスペースのファイルに未リンクのため閲覧専用です。"
      : null;


  const refreshArticles = useCallback(async () => {
    try {
      const response = await fetch("/api/articles", { cache: "no-store" });
      const data = (await response.json()) as { success?: boolean; articles?: ArticleSummary[] };
      if (response.ok && data.success && data.articles) {
        setArticles(data.articles);
      }
    } catch {
      // noop
    }
  }, []);

  useEffect(() => {
    void loadFiles(sessionDid, setBusy, setStatusMessage).catch((err: unknown) => {
      setStatusMessage(err instanceof Error ? err.message : "Failed to load files");
    });
  }, [loadFiles, sessionDid]);

  useEffect(() => {
    void refreshArticles();
  }, [refreshArticles]);

  useEffect(() => {
    void syncLegacyArticles({ silent: true });
  }, [syncLegacyArticles]);

  useEffect(() => {
    for (const block of editorBlocks) {
      resizeTextarea(textareaRefs.current[block.id] ?? null);
    }
  }, [editorBlocks, textareaRefs]);

  useEffect(() => {
    if (tab !== "discussion") return;
    void loadDiscussion().catch((err: unknown) => {
      setStatusMessage(err instanceof Error ? err.message : "Failed to load discussion");
    });
  }, [loadDiscussion, tab]);

  const createWorkspaceItem = async (
    kind: "folder" | "file",
    options?: {
      name?: string;
      format?: SourceFormat;
      content?: string;
    },
  ) => {
    let name =
      options?.name ?? window.prompt(kind === "folder" ? "Folder name" : "File name");
    if (!name) return;

    if (kind === "file" && !name.includes(".")) {
      name = `${name}.md`;
    }

    const parentId = activeFile?.kind === "folder" ? activeFile.id : activeFile?.parentId ?? null;

    const created = await apiCreateItem(
      name,
      kind,
      parentId,
      sessionDid,
      setBusy,
      setStatusMessage
    );

    if (created) {
      await openFile(created);
    }
  };

  const deleteWorkspaceItem = async (file: WorkspaceFile) => {
    const label = file.kind === "folder" ? "folder and all children" : "file";
    const confirmed = window.confirm(`Delete this ${label}?`);
    if (!confirmed) return;

    const latestFiles = await apiDeleteItem(
      file.id,
      sessionDid,
      setBusy,
      setStatusMessage
    );

    if (latestFiles) {
      if (activeFileId && !latestFiles.some((item) => item.id === activeFileId)) {
        setActiveFileId(null);
        if (!activeArticleUri) {
          setCurrentDid(null);
          setCurrentRkey(null);
          setEditorBlocks([{ id: newId(), kind: "paragraph", text: "" }]);
          setTitle("");
          setSelectedQuote("");
          setQuoteComment("");
        }
      }
    }
  };

  const renameWorkspaceItem = async (file: WorkspaceFile) => {
    const requestedName = window.prompt(
      file.kind === "folder" ? "Rename folder" : "Rename file",
      file.name,
    );
    if (!requestedName) return;
    const trimmed = requestedName.trim();
    if (!trimmed) return;

    const isBibFile = file.kind === "file" && file.name.toLowerCase().endsWith(".bib");
    const nextName = isBibFile ? ensureFileExtension(trimmed, "bib") : trimmed;
    if (!nextName || nextName === file.name) return;

    const success = await apiRenameItem(
      file.id,
      nextName,
      sessionDid,
      setBusy,
      setStatusMessage
    );

    if (success) {
      setStatusMessage(`Renamed to ${nextName}`);
    }
  };

  const normalizeWorkspaceImageUrisForExport = useCallback(
    (input: string) =>
      input.replace(/!\[([^\]]*)\]\(workspace:\/\/([^)]+)\)(\{[^}]*\})?/g, (_all, alt, id, attrs) => {
        const file = files.find((item) => item.id === id);
        if (!file || file.kind !== "file") return _all;
        const path = filePathMap.get(file.id) ?? `/assets/${file.name}`;
        return `![${alt}](${path})${attrs ?? ""}`;
      }),
    [filePathMap, files],
  );

  const {
    handlePublish,
    handleUnpublish,
    handleExport,
    confirmExportToFolder,
    handleExportImage,
    exportPreview,
    confirmExport,
    cancelExport,
    toggleIncludeBibInExport,
  } = useWorkspacePublishing({
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
  });

  const handleSourceFormatChange = useCallback(
    (nextFormat: SourceFormat) => {
      if (isBibWorkspaceFile || isImageWorkspaceFile) return;
      if (nextFormat === sourceFormat) return;
      const currentSource = blockSourceText;
      const nextBlocks = sourceToEditorBlocks(currentSource, nextFormat);
      setSourceFormat(nextFormat);
      setEditorBlocks(nextBlocks);
      setCitationMenu(null);
      setBlockMenuForId(null);
      setActiveBlockId(null);
    },
    [blockSourceText, isBibWorkspaceFile, isImageWorkspaceFile, sourceFormat, setEditorBlocks, setCitationMenu, setBlockMenuForId, setActiveBlockId],
  );

  const handleMoveWorkspaceItem = useCallback(
    async (draggedId: string, target: WorkspaceFile, position: TreeDropPosition) => {
      if (!sessionDid) return;

      const res = await apiMoveItem(
        draggedId,
        target.id,
        position,
        sessionDid,
        setBusy,
        setStatusMessage,
      );

      if (!res) return;

      const { latestFiles, updates } = res;

      let rewrittenCount = 0;
      if (updates.length > 0) {
        const nextFilePathMap = buildFilePathMap(latestFiles);
        for (const update of updates) {
          const dragged = latestFiles.find((f) => f.id === update.id);
          if (!dragged) continue;

          const oldDraggedPath = update.oldPath;
          const nextDraggedPath = update.newPath;

          for (const file of latestFiles) {
            if (
              file.kind === "file" &&
              !isWorkspaceImageFile(file) &&
              inferSourceFormat(file.name, file.sourceFormat) === "markdown"
            ) {
              const documentPath = nextFilePathMap.get(file.id) ?? null;
              const source =
                file.id === activeFileId && canEditTextCurrentFile
                  ? sourceText
                  : (file.content ?? "");
              const nextContent = rewriteImagePathReferencesInMarkdown(source, {
                movedFileId: dragged.id,
                oldPath: oldDraggedPath,
                newPath: nextDraggedPath,
                documentPath,
                resolveWorkspacePathFromDocument,
              });

              if (nextContent !== source) {
                rewrittenCount += 1;
                if (file.id === activeFileId) {
                  setEditorBlocks(sourceToEditorBlocks(nextContent, sourceFormat));
                } else {
                  await fetch(`/api/workspace/files/${encodeURIComponent(file.id)}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      content: nextContent,
                      sourceFormat: inferSourceFormat(file.name, file.sourceFormat),
                    }),
                  });
                }
              }
            }
          }
        }
      }

      setStatusMessage(
        rewrittenCount > 0
          ? `Updated file order and ${rewrittenCount} image reference file(s).`
          : "Updated file order.",
      );
    },
    [
      activeFileId,
      canEditTextCurrentFile,
      sessionDid,
      sourceFormat,
      sourceText,
      apiMoveItem,
      setBusy,
      setStatusMessage,
      setEditorBlocks,
    ],
  );

  const insertInlineMath = (blockId: string) => {
    const target = textareaRefs.current[blockId];
    if (!target) return;
    const start = target.selectionStart;
    const end = target.selectionEnd;

    setEditorBlocks((prev) =>
      prev.map((block) => {
        if (block.id !== blockId) return block;
        const before = block.text.slice(0, start);
        const selected = block.text.slice(start, end);
        const after = block.text.slice(end);
        if (selected.length > 0) {
          return { ...block, text: `${before}$${selected}$${after}` };
        }
        return { ...block, text: `${before}$$${after}` };
      }),
    );

    window.setTimeout(() => {
      const textarea = textareaRefs.current[blockId];
      if (!textarea) return;
      if (end > start) {
        textarea.focus();
        textarea.setSelectionRange(start + 1, end + 1);
        return;
      }
      textarea.focus();
      textarea.setSelectionRange(start + 1, start + 1);
    }, 0);
  };

  const shouldShowStatus = Boolean(statusMessage);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_right,_#E9F4FF_0%,_#F8FAFC_45%)] p-4 md:p-6 pb-20 lg:pb-6">
      <OnboardingTour storageKey={TUTORIAL_STORAGE_KEY} />

      {shouldShowStatus ? (
        <p className="mb-3 rounded-md border bg-white px-3 py-2 text-sm text-slate-600">
          {statusMessage}
        </p>
      ) : null}

      <div className="grid min-h-[calc(100vh-4rem)] grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)_360px] items-start">
        <div
          className={`${
            mobileView === "files" ? "block" : "hidden"
          } lg:block lg:sticky lg:top-6 lg:h-[calc(100vh-5rem)]`}
        >
          <Sidebar
            articles={articles}
            activeArticleUri={activeArticleUri}
            openArticle={openArticle}
            syncLegacyArticles={syncLegacyArticles}
            onRefreshArticle={(article) => {
              void syncLegacyArticles({ force: true });
            }}
            files={files}            activeFileId={activeFileId}
            openFile={openFile}
            renameWorkspaceItem={renameWorkspaceItem}
            deleteWorkspaceItem={deleteWorkspaceItem}
            downloadWorkspaceItem={(file) =>
              downloadFileItem(file, setBusy, setStatusMessage)
            }
            handleMoveWorkspaceItem={handleMoveWorkspaceItem}
            createWorkspaceItem={createWorkspaceItem}
            isLoggedIn={isLoggedIn}
            accountHandle={accountHandle}
            loadFiles={loadFiles}
            sessionDid={sessionDid}
            setBusy={setBusy}
            setStatusMessage={setStatusMessage}
          />
        </div>

        <div className={`${mobileView === "editor" ? "block" : "hidden"} lg:block`}>
          <EditorPanel
            hasOpenDocument={hasOpenDocument}
            activeFile={activeFile}
            title={title}
            setTitle={setTitle}
            authorsText={authorsText}
            setAuthorsText={setAuthorsText}
            isAuthorsFocused={isAuthorsFocused}
            setIsAuthorsFocused={setIsAuthorsFocused}
            editorBlocks={editorBlocks}
            activeBlockId={activeBlockId}
            canEditCurrentFile={canEditCurrentFile}
            canEditTextCurrentFile={canEditTextCurrentFile}
            canPublishCurrentFile={canPublishCurrentFile}
            isImageWorkspaceFile={isImageWorkspaceFile}
            isBibWorkspaceFile={isBibWorkspaceFile}
            isDirtyFile={isDirtyFile}
            isDirtyTitle={isDirtyTitle}
            savingFile={savingFile}
            busy={busy}
            broadcastToBsky={broadcastToBsky}
            setBroadcastToBsky={setBroadcastToBsky}
            sourceFormat={sourceFormat}
            currentDid={currentDid}
            currentRkey={currentRkey}
            readOnlyMessage={readOnlyMessage}
            handlePublish={handlePublish}
            handleUnpublish={handleUnpublish}
            handleExport={handleExport}
            confirmExportToFolder={confirmExportToFolder}
            handleExportImage={handleExportImage}
            exportPreview={exportPreview}
            confirmExport={confirmExport}
            cancelExport={cancelExport}
            toggleIncludeBibInExport={toggleIncludeBibInExport}
            handleSourceFormatChange={handleSourceFormatChange}
            persistTitleAsFileName={persistTitleAsFileName}
            updateBlock={updateBlock}
            updateSelectionRange={updateSelectionRange}
            insertBlockAfter={insertBlockAfter}
            removeBlock={removeBlock}
            focusBlockByIndex={focusBlockByIndex}
            activateBlockEditor={activateBlockEditor}
            insertInlineMath={insertInlineMath}
            setStatusMessage={setStatusMessage}
            onRefresh={async () => {
              await syncLegacyArticles({ force: true });
              if (activeFile && activeFile.kind === "file") {
                await openFile(activeFile);
              }
            }}
            setTab={setTab}
            citationMenu={citationMenu}
            citationMenuIndex={citationMenuIndex}
            setCitationMenuIndex={setCitationMenuIndex}
            filteredCitationEntries={filteredCitationEntries}
            applyCitationSuggestion={applyCitationSuggestion}
            renderCitationLookup={renderCitationLookup}
            citationNumberByKey={citationNumberByKey}
            resolvedBibliography={resolvedBibliography}
            updateCitationMenu={updateCitationMenu}
            selectedQuote={selectedQuote}
            activeImagePreviewSrc={activeImagePreviewSrc}
            resolveWorkspaceImageSrc={resolveWorkspaceImageSrc}
            handleImageDrop={handleImageDrop}
            imageDropTarget={imageDropTarget}
            setImageDropTarget={setImageDropTarget}
            draggingEditorBlockId={draggingEditorBlockId}
            setDraggingEditorBlockId={setDraggingEditorBlockId}
            blockMoveDropTarget={blockMoveDropTarget}
            setBlockMoveDropTarget={setBlockMoveDropTarget}
            moveBlockByDrop={moveBlockByDrop}
            titleRef={titleRef}
            authorsRef={authorsRef}
            textareaRefs={textareaRefs}
            bibHighlightScrollRefs={bibHighlightScrollRefs}
            showMoreMenu={showMoreMenu}
            setShowMoreMenu={setShowMoreMenu}
            formatBibtexBlockById={formatBibtexBlockById}
          />
        </div>

        <div
          className={`${
            mobileView === "discussion" ? "block" : "hidden"
          } lg:block lg:sticky lg:top-6 lg:h-[calc(100vh-5rem)]`}
        >
          <RightPanel
            selectedQuote={selectedQuote}
            quoteComment={quoteComment}
            setQuoteComment={setQuoteComment}
            submitInlineComment={submitInlineComment}
            discussionRoot={discussionRoot}
            discussionPosts={discussionPosts}
            replyDrafts={replyDrafts}
            setReplyDrafts={setReplyDrafts}
            runEngagement={runEngagement}
            sessionDid={sessionDid}
            busy={busy}
            setStatusMessage={setStatusMessage}
          />
        </div>
      </div>

      <MobileNavBar mobileView={mobileView} setMobileView={setMobileView} />
    </div>
  );
}
