"use client";

import {
  Fragment,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import katex from "katex";

import { LoginForm } from "@/components/LoginForm";
import { LogoutButton } from "@/components/LogoutButton";
import type { ArticleBlock } from "@/lib/articles/blocks";
import { parseMarkdownToBlocks, parseTexToBlocks } from "@/lib/articles/blocks";
import {
  extractCitationKeysFromText,
  formatBibtexSource,
  formatBibliographyIEEE,
  parseBibtexEntries,
  splitBibtexSourceBlocks,
  type BibliographyEntry,
} from "@/lib/articles/citations";
import { formatAuthors, parseAuthors } from "@/lib/articles/authors";
import { exportSource } from "@/lib/export/document";
import type { ArticleAuthor, ArticleSummary, SourceFormat } from "@/lib/types";
import {
  type BlockKind,
  type CitationMenuState,
  type DiscussionPost,
  type DiscussionRoot,
  type EditorBlock,
  type ImageAlign,
  type ImageDropPosition,
  type NewFileType,
  type RightTab,
  type TreeDropPosition,
  type WorkspaceFile,
  type ArticleDetailPayload,
  type BlockMoveDropTarget,
  type ParsedMarkdownImageLine,
} from "@/lib/workspace/types";
import {
  blockTextClass,
  isImeComposing,
  linkHref,
  newId,
  referenceAnchorId,
  renderMathHtml,
  resizeTextarea,
  timeAgo,
} from "@/lib/workspace/utils";
import {
  blocksToSource,
  createBibtexTemplate,
  detectCitationTrigger,
  editorBlocksToSource,
  inferSourceFormat,
  isClosedBibtexEntryBlock,
  normalizeEditedBlockInput,
  sourceToBibEditorBlocks,
  sourceToEditorBlocks,
  bibEditorBlocksToSource,
} from "@/lib/workspace/editor-logic";
import {
  buildFilePathMap,
  composeFileNameFromTitle,
  defaultTitleFromFileName,
  ensureFileExtension,
  makeFileTree,
  resolveWorkspacePathFromDocument,
  findProjectRootFolderId,
  isDescendantOfFolder,
  collectProjectBibFiles,
} from "@/lib/workspace/file-logic";
import {
  createUniqueImageFileName,
  deriveImagePreviewSource,
  imageAlignFromAttrs,
  isWorkspaceImageFile,
  parseMarkdownImageLine,
  setImageAlignOnMarkdownLine,
  toFigureLabel,
  isInlineImageDataUrl,
  rewriteImagePathReferencesInMarkdown,
  sanitizeFileStem,
  inferImageExtension,
} from "@/lib/workspace/image-logic";
import {
  renderBibtexHighlighted,
  renderInlineText,
  renderRichParagraphs,
} from "./RichRenderer";
import { FileTree } from "./FileTree";
import { ArticleList } from "./ArticleList";
import { OnboardingTour } from "./OnboardingTour";
import { useWorkspaceFiles } from "./hooks/useWorkspaceFiles";

const TUTORIAL_STORAGE_KEY = "scholarview:tutorial:v1";

function parseSourceToBlocks(source: string, sourceFormat: SourceFormat): ArticleBlock[] {
  return sourceFormat === "tex" ? parseTexToBlocks(source) : parseMarkdownToBlocks(source);
}

export function WorkspaceApp({ initialArticles, sessionDid, accountHandle }: WorkspaceAppProps) {
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
  } = useWorkspaceFiles();
  const [articles, setArticles] = useState<ArticleSummary[]>(initialArticles);
  const [activeArticleUri, setActiveArticleUri] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [authorsText, setAuthorsText] = useState("");
  const [isAuthorsFocused, setIsAuthorsFocused] = useState(false);
  const [sourceFormat, setSourceFormat] = useState<SourceFormat>("markdown");
  const [editorBlocks, setEditorBlocks] = useState<EditorBlock[]>([{ id: newId(), kind: "paragraph", text: "" }]);
  const [articleBibliography, setArticleBibliography] = useState<BibliographyEntry[]>([]);
  const [citationMenu, setCitationMenu] = useState<CitationMenuState | null>(null);
  const [citationMenuIndex, setCitationMenuIndex] = useState(0);
  const [broadcastToBsky, setBroadcastToBsky] = useState(true);

  const [currentDid, setCurrentDid] = useState<string | null>(null);
  const [currentRkey, setCurrentRkey] = useState<string | null>(null);
  const [currentAuthorDid, setCurrentAuthorDid] = useState<string | null>(null);

  const [tab, setTab] = useState<RightTab>("discussion");
  const [discussionRoot, setDiscussionRoot] = useState<DiscussionRoot | null>(null);
  const [discussionPosts, setDiscussionPosts] = useState<DiscussionPost[]>([]);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [selectedQuote, setSelectedQuote] = useState("");
  const [quoteComment, setQuoteComment] = useState("");

  const [statusMessage, setStatusMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showLoginBox, setShowLoginBox] = useState(false);
  const [showNewFileForm, setShowNewFileForm] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [newFileType, setNewFileType] = useState<NewFileType>("markdown");
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  const [selectionAnchorBlockId, setSelectionAnchorBlockId] = useState<string | null>(null);
  const [blockMenuForId, setBlockMenuForId] = useState<string | null>(null);
  const [savingFile, setSavingFile] = useState(false);
  const [activeImagePreviewSrc, setActiveImagePreviewSrc] = useState<string | null>(null);
  const [imageDropTarget, setImageDropTarget] = useState<{
    blockId: string;
    position: ImageDropPosition;
  } | null>(null);
  const [draggingEditorBlockId, setDraggingEditorBlockId] = useState<string | null>(null);
  const [blockMoveDropTarget, setBlockMoveDropTarget] = useState<BlockMoveDropTarget | null>(null);

  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const titleRef = useRef<HTMLInputElement>(null);
  const authorsRef = useRef<HTMLTextAreaElement>(null);
  const bibHighlightScrollRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const saveInFlightRef = useRef(false);
  const titleSaveInFlightRef = useRef(false);
  const legacySyncRequestedRef = useRef(false);
  const imagePreviewFetchRequestedRef = useRef(new Set<string>());
  const draggingEditorBlockIdRef = useRef<string | null>(null);

  useEffect(() => {
    setArticles(initialArticles);
  }, [initialArticles]);

  useEffect(() => {
    draggingEditorBlockIdRef.current = draggingEditorBlockId;
  }, [draggingEditorBlockId]);

  const articleByUri = useMemo(() => {
    const map = new Map<string, ArticleSummary>();
    for (const article of articles) map.set(article.uri, article);
    return map;
  }, [articles]);

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
  const isBibWorkspaceFile = Boolean(
    activeFile?.kind === "file" && activeFile.name.toLowerCase().endsWith(".bib"),
  );
  const isImageWorkspaceFile = Boolean(
    activeFile && isWorkspaceImageFile(activeFile),
  );
  const projectBibFiles = useMemo(
    () => collectProjectBibFiles(files, activeFileId),
    [activeFileId, files],
  );
  const projectBibEntries = useMemo(() => {
    const merged = new Map<string, BibliographyEntry>();
    for (const file of projectBibFiles) {
      const entries = parseBibtexEntries(file.content ?? "");
      for (const entry of entries) {
        if (!merged.has(entry.key)) {
          merged.set(entry.key, entry);
        }
      }
    }
    return Array.from(merged.values());
  }, [projectBibFiles]);
  const activeBibByKey = useMemo(() => {
    const map = new Map<string, BibliographyEntry>();
    for (const entry of projectBibEntries) map.set(entry.key, entry);
    return map;
  }, [projectBibEntries]);
  const persistedBibByKey = useMemo(() => {
    const map = new Map<string, BibliographyEntry>();
    for (const entry of articleBibliography) map.set(entry.key, entry);
    return map;
  }, [articleBibliography]);

  const blockSourceText = useMemo(
    () => editorBlocksToSource(editorBlocks, sourceFormat),
    [editorBlocks, sourceFormat],
  );
  const bibSourceText = useMemo(() => bibEditorBlocksToSource(editorBlocks), [editorBlocks]);
  const sourceText = useMemo(() => {
    if (isImageWorkspaceFile) return activeFile?.content ?? "";
    return isBibWorkspaceFile ? bibSourceText : blockSourceText;
  }, [activeFile, bibSourceText, blockSourceText, isBibWorkspaceFile, isImageWorkspaceFile]);
  const citationKeys = useMemo(
    () => (isImageWorkspaceFile ? [] : extractCitationKeysFromText(sourceText)),
    [isImageWorkspaceFile, sourceText],
  );
  const resolvedBibliography = useMemo(() => {
    const resolved: BibliographyEntry[] = [];
    for (const key of citationKeys) {
      const fromBib = activeBibByKey.get(key);
      if (fromBib) {
        resolved.push(fromBib);
        continue;
      }
      const fromPersisted = persistedBibByKey.get(key);
      if (fromPersisted) resolved.push(fromPersisted);
    }
    return resolved;
  }, [activeBibByKey, citationKeys, persistedBibByKey]);
  const missingCitationKeys = useMemo(
    () =>
      citationKeys.filter(
        (key) => !activeBibByKey.has(key) && !persistedBibByKey.has(key),
      ),
    [activeBibByKey, citationKeys, persistedBibByKey],
  );
  const citationNumberByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < resolvedBibliography.length; i += 1) {
      map.set(resolvedBibliography[i].key, i + 1);
    }
    return map;
  }, [resolvedBibliography]);
  const renderCitationLookup = useMemo(() => {
    const map = new Map<string, BibliographyEntry>();
    for (const entry of resolvedBibliography) map.set(entry.key, entry);
    return map;
  }, [resolvedBibliography]);
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
  useEffect(() => {
    if (!activeFile || activeFile.kind !== "file" || !isImageWorkspaceFile) {
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
  }, [activeFile, isImageWorkspaceFile, resolveWorkspaceImageSrc]);

  const previewBlocks = useMemo(
    () => (isBibWorkspaceFile || isImageWorkspaceFile ? [] : parseSourceToBlocks(sourceText, sourceFormat)),
    [isBibWorkspaceFile, isImageWorkspaceFile, sourceFormat, sourceText],
  );
  const myArticles = useMemo(
    () => articles.filter((article) => article.authorDid === sessionDid),
    [articles, sessionDid],
  );

  const isLoggedIn = Boolean(sessionDid);
  const isExistingArticle = Boolean(currentDid && currentRkey);
  const canEditArticle = Boolean(isLoggedIn && (!isExistingArticle || currentAuthorDid === sessionDid));
  const canEditCurrentFile = Boolean(canEditArticle && activeFile?.kind === "file");
  const canEditTextCurrentFile = canEditCurrentFile && !isImageWorkspaceFile;
  const canPublishCurrentFile = canEditCurrentFile && !isBibWorkspaceFile && !isImageWorkspaceFile;
  const hasOpenDocument = Boolean((activeFile && activeFile.kind === "file") || activeArticleUri);
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

  const readOnlyMessage = !isLoggedIn
    ? "ログインしていないため閲覧専用です。"
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
    [loadFiles, sessionDid],
  );

  const openFile = useCallback(
    async (file: WorkspaceFile) => {
      setActiveFileId(file.id);
      setActiveArticleUri(file.linkedArticleUri ?? null);

      if (file.kind !== "file") {
        return;
      }

      const format = inferSourceFormat(file.name, file.sourceFormat);
      setSourceFormat(format);
      if (isWorkspaceImageFile(file)) {
        setEditorBlocks([]);
      } else if (file.name.toLowerCase().endsWith(".bib")) {
        setEditorBlocks(sourceToBibEditorBlocks(file.content ?? ""));
      } else {
        setEditorBlocks(sourceToEditorBlocks(file.content ?? "", format));
      }

      const linked = file.linkedArticleUri ? articleByUri.get(file.linkedArticleUri) : undefined;
      if (linked) {
        setCurrentDid(linked.did);
        setCurrentRkey(linked.rkey);
        setCurrentAuthorDid(linked.authorDid);
        setTitle(linked.title);
        setAuthorsText(formatAuthors(linked.authors));
        setBroadcastToBsky(Boolean(linked.announcementUri));
      } else if (file.linkedArticleDid && file.linkedArticleRkey) {
        setCurrentDid(file.linkedArticleDid);
        setCurrentRkey(file.linkedArticleRkey);
        setCurrentAuthorDid(sessionDid ?? null);
        setTitle(defaultTitleFromFileName(file.name));
        setAuthorsText(sessionDid ? `<${sessionDid}>` : "");
        setBroadcastToBsky(true);
      } else {
        setCurrentDid(null);
        setCurrentRkey(null);
        setCurrentAuthorDid(sessionDid ?? null);
        setTitle(defaultTitleFromFileName(file.name));
        setAuthorsText(sessionDid ? `<${sessionDid}>` : "");
        setBroadcastToBsky(true);
        setArticleBibliography([]);
      }

      if (linked || (file.linkedArticleDid && file.linkedArticleRkey)) {
        const detailDid = linked?.did ?? file.linkedArticleDid;
        const detailRkey = linked?.rkey ?? file.linkedArticleRkey;
        if (detailDid && detailRkey) {
          try {
            const response = await fetch(
              `/api/articles/${encodeURIComponent(detailDid)}/${encodeURIComponent(detailRkey)}`,
              { cache: "no-store" },
            );
            const data = (await response.json()) as {
              success?: boolean;
              article?: Partial<ArticleDetailPayload>;
            };
            if (response.ok && data.success && data.article) {
              setArticleBibliography(
                Array.isArray(data.article.bibliography) ? data.article.bibliography : [],
              );
            } else {
              setArticleBibliography([]);
            }
          } catch {
            setArticleBibliography([]);
          }
        }
      }

      setSelectedQuote("");
      setQuoteComment("");
      setShowMoreMenu(false);
      setActiveBlockId(null);
      setBlockMenuForId(null);
      setCitationMenu(null);
      setStatusMessage("");
    },
    [articleByUri, sessionDid],
  );

  const openArticle = useCallback(
    async (article: ArticleSummary) => {
      let linkedFile = files.find(
        (file) => file.kind === "file" && file.linkedArticleUri === article.uri,
      );
      if (!linkedFile && article.authorDid === sessionDid) {
        await syncLegacyArticles({ force: true, silent: true });
        const latestFiles = await loadFiles(sessionDid, setBusy, setStatusMessage);
        linkedFile = latestFiles.find(
          (file) => file.kind === "file" && file.linkedArticleUri === article.uri,
        );
      }
      if (linkedFile) {
        await openFile(linkedFile);
        return;
      }

      const response = await fetch(
        `/api/articles/${encodeURIComponent(article.did)}/${encodeURIComponent(article.rkey)}`,
        { cache: "no-store" },
      );
      const data = (await response.json()) as {
        success?: boolean;
        article?: Partial<ArticleDetailPayload>;
        error?: string;
      };
      if (!response.ok || !data.success || !data.article) {
        throw new Error(data.error ?? "Failed to open article");
      }

      const detail = data.article;
      const detailSourceFormat = detail.sourceFormat === "tex" ? "tex" : "markdown";
      const blocks = Array.isArray(detail.blocks) ? detail.blocks : [];
      const source = blocksToSource(blocks, detailSourceFormat);

      setActiveFileId(null);
      setActiveArticleUri(article.uri);
      setSourceFormat(detailSourceFormat);
      setEditorBlocks(sourceToEditorBlocks(source, detailSourceFormat));
      setCurrentDid(typeof detail.did === "string" ? detail.did : article.did);
      setCurrentRkey(typeof detail.rkey === "string" ? detail.rkey : article.rkey);
      setCurrentAuthorDid(
        typeof detail.authorDid === "string" ? detail.authorDid : article.authorDid,
      );
      setTitle(typeof detail.title === "string" ? detail.title : article.title);
      setAuthorsText(
        formatAuthors(Array.isArray(detail.authors) ? detail.authors : article.authors),
      );
      setBroadcastToBsky(
        detail.broadcasted === 1 ||
          (typeof detail.announcementUri === "string" && detail.announcementUri.length > 0) ||
          Boolean(article.announcementUri),
      );
      setArticleBibliography(
        Array.isArray(detail.bibliography) ? detail.bibliography : [],
      );
      setSelectedQuote("");
      setQuoteComment("");
      setShowMoreMenu(false);
      setActiveBlockId(null);
      setBlockMenuForId(null);
      setCitationMenu(null);
      setStatusMessage("");
    },
    [files, loadFiles, openFile, sessionDid, syncLegacyArticles],
  );

  useEffect(() => {
    void loadFiles(sessionDid, setBusy, setStatusMessage).catch((err: unknown) => {
      setStatusMessage(err instanceof Error ? err.message : "Failed to load files");
    });
  }, [loadFiles]);

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
  }, [editorBlocks]);

  const loadDiscussion = useCallback(async () => {
    if (!currentDid || !currentRkey) {
      setDiscussionRoot(null);
      setDiscussionPosts([]);
      return;
    }

    const query = selectedQuote ? `?quote=${encodeURIComponent(selectedQuote)}` : "";
    const response = await fetch(
      `/api/articles/${encodeURIComponent(currentDid)}/${encodeURIComponent(currentRkey)}/discussion${query}`,
      { cache: "no-store" },
    );

    const data = (await response.json()) as {
      success?: boolean;
      root?: DiscussionRoot | null;
      thread?: Array<Partial<DiscussionPost>>;
    };

    if (!response.ok || !data.success) {
      throw new Error("Failed to load discussion");
    }

    setDiscussionRoot(data.root ?? null);
    const normalizedThread = (data.thread ?? []).map((post) => ({
      uri: typeof post.uri === "string" ? post.uri : "",
      cid: typeof post.cid === "string" ? post.cid : null,
      handle: typeof post.handle === "string" ? post.handle : null,
      authorDid: typeof post.authorDid === "string" ? post.authorDid : "",
      text: typeof post.text === "string" ? post.text : "",
      quote: typeof post.quote === "string" ? post.quote : "",
      externalUri: typeof post.externalUri === "string" ? post.externalUri : "",
      createdAt:
        typeof post.createdAt === "string" ? post.createdAt : new Date().toISOString(),
      parentUri: typeof post.parentUri === "string" ? post.parentUri : null,
      depth: typeof post.depth === "number" ? Math.max(0, post.depth) : 1,
      source:
        post.source === "tap" || post.source === "live" || post.source === "merged"
          ? post.source
          : "tap",
      quoted: post.quoted === true,
      liked: post.liked === true,
      reposted: post.reposted === true,
    }));
    setDiscussionPosts(normalizedThread.filter((post) => post.uri));
  }, [currentDid, currentRkey, selectedQuote]);

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
    if (!sessionDid) {
      throw new Error("Login required");
    }

    const name =
      options?.name ?? window.prompt(kind === "folder" ? "Folder name" : "File name");
    if (!name) return;

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

  const createWorkspaceFileFromForm = async () => {
    const name = ensureFileExtension(newFileName, newFileType);
    if (!name) {
      setStatusMessage("File name is required.");
      return;
    }
    const format: SourceFormat = newFileType === "tex" ? "tex" : "markdown";
    await createWorkspaceItem("file", {
      name,
      format,
      content: "",
    });
    setShowNewFileForm(false);
    setNewFileName("");
    setNewFileType("markdown");
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
    if (!sessionDid) return;
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
  }, [activeFile, canEditTextCurrentFile, sourceFormat, sourceText]);

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
  }, [activeFile, canEditCurrentFile, isExistingArticle, title]);

  useEffect(() => {
    if (!isDirtyFile || !canEditTextCurrentFile) return;

    const timer = window.setTimeout(() => {
      void saveCurrentFile({ silent: true }).catch((err: unknown) => {
        setStatusMessage(err instanceof Error ? err.message : "Failed to autosave file");
      });
    }, 800);

    return () => window.clearTimeout(timer);
  }, [canEditTextCurrentFile, isDirtyFile, saveCurrentFile]);

  useEffect(() => {
    if (!isDirtyTitle || !canEditCurrentFile) return;

    const timer = window.setTimeout(() => {
      void persistTitleAsFileName({ silent: true }).catch((err: unknown) => {
        setStatusMessage(err instanceof Error ? err.message : "Failed to save file name");
      });
    }, 800);

    return () => window.clearTimeout(timer);
  }, [canEditCurrentFile, isDirtyTitle, persistTitleAsFileName]);

  const handlePublish = async () => {
    if (!canEditCurrentFile || !activeFile || activeFile.kind !== "file") {
      setStatusMessage("Select a file and ensure you have edit permission.");
      return;
    }
    if (isImageWorkspaceFile) {
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
        },
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
    if (!canEditCurrentFile || !currentDid || !currentRkey) {
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
        },
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

  const submitInlineComment = async () => {
    if (!sessionDid) {
      setStatusMessage("Login required to comment.");
      return;
    }
    if (!currentDid || !currentRkey) {
      setStatusMessage("Publish article before commenting.");
      return;
    }
    if (!selectedQuote.trim() || !quoteComment.trim()) {
      setStatusMessage("Quote and comment text are required.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(
        `/api/articles/${encodeURIComponent(currentDid)}/${encodeURIComponent(currentRkey)}/comments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quote: selectedQuote, text: quoteComment }),
        },
      );

      const data = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "Failed to post comment");
      }

      setQuoteComment("");
      setTab("discussion");
      await loadDiscussion();
      setStatusMessage("Posted inline discussion comment.");
    } finally {
      setBusy(false);
    }
  };

  const runEngagement = async (
    action: "like" | "repost" | "reply",
    post: DiscussionPost,
    text?: string,
  ) => {
    if (!sessionDid) {
      setStatusMessage("Login required.");
      return;
    }

    const response = await fetch("/api/bsky/engagement", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, uri: post.uri, cid: post.cid, text }),
    });

    const data = (await response.json()) as { success?: boolean; error?: string };
    if (!response.ok || !data.success) {
      throw new Error(data.error ?? "Failed to send engagement");
    }

    if (action === "reply") {
      setReplyDrafts((prev) => ({ ...prev, [post.uri]: "" }));
    }

    await loadDiscussion();
  };

  const updateCitationMenu = useCallback(
    (blockId: string, text: string, cursor: number) => {
      const trigger = detectCitationTrigger(text, cursor);
      if (!trigger) {
        setCitationMenu((prev) => (prev?.blockId === blockId ? null : prev));
        return;
      }
      setCitationMenu({
        blockId,
        start: trigger.start,
        end: trigger.end,
        query: trigger.query,
      });
      setCitationMenuIndex(0);
    },
    [],
  );

  const filteredCitationEntries = useMemo(() => {
    if (!citationMenu) return [] as BibliographyEntry[];
    const query = citationMenu.query.trim().toLowerCase();
    const searchPool = projectBibEntries.length > 0 ? projectBibEntries : articleBibliography;
    if (!query) return searchPool;
    return searchPool
      .filter((entry) => {
        const haystack = `${entry.key} ${entry.title ?? ""} ${entry.author ?? ""}`.toLowerCase();
        return haystack.includes(query);
      });
  }, [articleBibliography, citationMenu, projectBibEntries]);

  const applyCitationSuggestion = useCallback(
    (entry: BibliographyEntry) => {
      if (!citationMenu) return;
      const replacement = `[@${entry.key}]`;
      const targetId = citationMenu.blockId;

      setEditorBlocks((prev) =>
        prev.map((block) => {
          if (block.id !== targetId) return block;
          const before = block.text.slice(0, citationMenu.start);
          const after = block.text.slice(citationMenu.end);
          return {
            ...block,
            text: `${before}${replacement}${after}`,
          };
        }),
      );

      setCitationMenu(null);

      window.setTimeout(() => {
        const textarea = textareaRefs.current[targetId];
        if (!textarea) return;
        const nextPos = citationMenu.start + replacement.length;
        textarea.focus();
        textarea.setSelectionRange(nextPos, nextPos);
      }, 0);
    },
    [citationMenu],
  );

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
    [blockSourceText, isBibWorkspaceFile, isImageWorkspaceFile, sourceFormat],
  );

  const normalizeBibtexBlock = useCallback((raw: string): string => {
    const normalized = raw.replace(/\r\n?/g, "\n").trim();
    if (!normalized) return "";
    return formatBibtexSource(normalized);
  }, []);

  const formatBibtexBlockById = useCallback(
    (blockId: string, raw: string) => {
      const formatted = normalizeBibtexBlock(raw);
      setEditorBlocks((prev) =>
        prev.map((block) =>
          block.id === blockId && block.text !== formatted
            ? { ...block, kind: "paragraph", text: formatted }
            : block,
        ),
      );
    },
    [normalizeBibtexBlock],
  );

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

  const hasDraggedImageData = (event: DragEvent<HTMLElement>): boolean =>
    Array.from(event.dataTransfer.items ?? []).some(
      (item) => item.kind === "file" && item.type.startsWith("image/"),
    );
  const BLOCK_DRAG_MIME = "application/x-scholarview-editor-block";
  const hasDraggedEditorBlock = (event: DragEvent<HTMLElement>): boolean =>
    Array.from(event.dataTransfer.types ?? []).includes(BLOCK_DRAG_MIME) || Boolean(draggingEditorBlockId);

  const determineBlockDropPosition = (event: DragEvent<HTMLElement>): ImageDropPosition => {
    const rect = event.currentTarget.getBoundingClientRect();
    const offsetY = event.clientY - rect.top;
    return offsetY < rect.height / 2 ? "before" : "after";
  };

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

        const activeElement = document.activeElement;
        if (activeElement instanceof HTMLElement) {
          const fromFocusedElement =
            activeElement.closest<HTMLElement>("[data-editor-block-id]")?.dataset.editorBlockId;
          if (fromFocusedElement) {
            const blockIndex = editorBlocks.findIndex((block) => block.id === fromFocusedElement);
            if (blockIndex >= 0) return blockIndex + 1;
          }
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
      setBlockMoveDropTarget(null);
    }
  };

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
    ],
  );

  const updateBlock = (id: string, patch: Partial<EditorBlock>) => {
    setEditorBlocks((prev) => prev.map((block) => (block.id === id ? { ...block, ...patch } : block)));
  };

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
    [editorBlocks, selectionAnchorBlockId],
  );

  const insertBlockAfter = (
    index: number,
    kind: BlockKind = "paragraph",
    options?: { text?: string; selectionStart?: number; selectionEnd?: number },
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
    setCitationMenu(null);

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
  };

  const focusBlockByIndex = (
    index: number,
    options?: {
      position?: "start" | "end";
    },
  ) => {
    const block = editorBlocks[index];
    if (!block) return;
    setActiveBlockId(block.id);
    setSelectedBlockIds([block.id]);
    setSelectionAnchorBlockId(block.id);
    setBlockMenuForId(null);
    setCitationMenu(null);
    window.setTimeout(() => {
      const textarea = textareaRefs.current[block.id];
      if (!textarea) return;
      textarea.focus();
      const position = options?.position === "start" ? 0 : textarea.value.length;
      textarea.setSelectionRange(position, position);
      resizeTextarea(textarea);
    }, 0);
  };

  const activateBlockEditor = (blockId: string, position: "start" | "end" = "start") => {
    setActiveBlockId(blockId);
    setSelectedBlockIds([blockId]);
    setSelectionAnchorBlockId(blockId);
    setBlockMenuForId(null);
    setCitationMenu(null);
    const focusWithRetry = (attempt = 0) => {
      const textarea = textareaRefs.current[blockId];
      if (!textarea) {
        if (attempt < 6) {
          window.setTimeout(() => focusWithRetry(attempt + 1), 0);
        }
        return;
      }
      textarea.focus();
      const nextPosition = position === "end" ? textarea.value.length : 0;
      textarea.setSelectionRange(nextPosition, nextPosition);
      resizeTextarea(textarea);
    };
    window.setTimeout(() => {
      focusWithRetry();
    }, 0);
  };

  const moveBlockByDelta = (index: number, delta: -1 | 1) => {
    if (!canEditTextCurrentFile) return;
    const block = editorBlocks[index];
    if (!block) return;

    const idsToMove = selectedBlockIds.includes(block.id) ? selectedBlockIds : [block.id];

    setEditorBlocks((prev) => {
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
    setCitationMenu(null);
    setActiveBlockId(block.id);

    window.setTimeout(() => {
      const textarea = textareaRefs.current[block.id];
      if (!textarea) return;
      textarea.focus();
      resizeTextarea(textarea);
    }, 0);
  };

  const moveBlockByDrop = (draggedId: string, targetId: string, position: ImageDropPosition) => {
    if (!canEditTextCurrentFile) return;
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
    setCitationMenu(null);

    // Focus the specifically dragged block without resetting selection of others
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
        textarea.setSelectionRange(0, 0);
        resizeTextarea(textarea);
      };
      focusWithRetry();
    }, 0);
  };

  const handleEditorCanvasClick = (event: React.MouseEvent<HTMLElement>) => {
    if (!canEditTextCurrentFile) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target !== event.currentTarget) return;
    if (target.closest("[data-editor-block-id]")) return;
    if (target.closest("textarea,button,input,select,a,label,[role='button']")) return;

    if (editorBlocks.length === 0) {
      const created = { id: newId(), kind: "paragraph" as const, text: "" };
      setEditorBlocks([created]);
      setActiveBlockId(created.id);
      setSelectedBlockIds([created.id]);
      setSelectionAnchorBlockId(created.id);
      setBlockMenuForId(null);
      setCitationMenu(null);
      window.setTimeout(() => {
        const textarea = textareaRefs.current[created.id];
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(0, 0);
        resizeTextarea(textarea);
      }, 0);
      return;
    }

    focusBlockByIndex(editorBlocks.length - 1, { position: "end" });
  };

  const removeBlock = (index: number) => {
    setEditorBlocks((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((_, idx) => idx !== index);
      const fallback = next[Math.max(0, index - 1)];
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
  };

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

  const captureWindowSelection = () => {
    const selection = window.getSelection();
    if (!selection) return;
    const quote = selection.toString().trim();
    if (!quote) return;
    setSelectedQuote(quote.slice(0, 280));
  };

  const shouldShowStatus = Boolean(statusMessage);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_right,_#E9F4FF_0%,_#F8FAFC_45%)] p-4 md:p-6">
      <OnboardingTour />

      {shouldShowStatus ? (
        <p className="mb-3 rounded-md border bg-white px-3 py-2 text-sm text-slate-600">{statusMessage}</p>
      ) : null}

      <div className="grid min-h-[calc(100vh-4rem)] grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)_360px]">
        <aside data-tour-id="sidebar" className="rounded-xl border bg-white p-3 shadow-sm">
          <section className="mb-4 space-y-3 rounded-lg border bg-slate-50 p-3">
            <div>
              <h1 className="text-lg font-semibold text-slate-900">ScholarView Workspace</h1>
            </div>
            <form method="GET" action="/articles" className="flex gap-2">
              <input
                type="search"
                name="q"
                placeholder="Search published articles..."
                className="w-full rounded border px-2 py-1 text-xs outline-none focus:border-[#0085FF]"
              />
              <button type="submit" className="rounded border px-2 py-1 text-xs hover:bg-white">
                Search
              </button>
            </form>
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  window.localStorage.removeItem(TUTORIAL_STORAGE_KEY);
                  window.location.reload();
                }}
                className="rounded border px-2 py-1 text-xs hover:bg-white"
                title="Show tutorial"
              >
                ?
              </button>
              {sessionDid ? (
                <div className="flex items-center gap-2">
                  <span className="max-w-[8rem] truncate text-xs text-slate-700">@{accountHandle ?? sessionDid}</span>
                  <LogoutButton />
                </div>
              ) : (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowLoginBox((prev) => !prev)}
                    className="rounded border px-2 py-1 text-xs hover:bg-white"
                  >
                    Sign in
                  </button>
                  {showLoginBox ? (
                    <div className="absolute right-0 top-9 z-30 w-64 rounded-md border bg-white p-2 shadow-lg">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-xs font-semibold text-slate-700">Login</p>
                        <button
                          type="button"
                          onClick={() => setShowLoginBox(false)}
                          className="rounded px-1 text-xs text-slate-500 hover:bg-slate-100"
                          aria-label="Close login panel"
                        >
                          ×
                        </button>
                      </div>
                      <LoginForm />
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Files</h2>
              {sessionDid ? (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      void createWorkspaceItem("folder").catch((err: unknown) => {
                        setStatusMessage(err instanceof Error ? err.message : "Failed to create folder");
                      });
                    }}
                    className="rounded border px-2 py-0.5 text-xs"
                  >
                    +Dir
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowNewFileForm((prev) => !prev);
                    }}
                    className="rounded border px-2 py-0.5 text-xs"
                  >
                    +File
                  </button>
                </div>
              ) : null}
            </div>
            {sessionDid && showNewFileForm ? (
              <form
                className="mb-2 space-y-2 rounded border bg-slate-50 p-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void createWorkspaceFileFromForm().catch((err: unknown) => {
                    setStatusMessage(err instanceof Error ? err.message : "Failed to create file");
                  });
                }}
              >
                <input
                  value={newFileName}
                  onChange={(event) => setNewFileName(event.target.value)}
                  placeholder="File name"
                  className="w-full rounded border px-2 py-1 text-xs"
                  autoFocus
                />
                <div className="flex items-center gap-2">
                  <select
                    value={newFileType}
                    onChange={(event) => setNewFileType(event.target.value as NewFileType)}
                    className="min-w-0 flex-1 rounded border px-2 py-1 text-xs"
                  >
                    <option value="markdown">Markdown (.md)</option>
                    <option value="tex">TeX (.tex)</option>
                    <option value="bib">BibTeX (.bib)</option>
                  </select>
                  <button type="submit" className="rounded border px-2 py-1 text-xs">
                    Create
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowNewFileForm(false);
                      setNewFileName("");
                      setNewFileType("markdown");
                    }}
                    className="rounded border px-2 py-1 text-xs text-slate-600"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : null}

            {sessionDid ? (
              <FileTree
                files={files}
                activeFileId={activeFileId}
                onSelect={(file) => {
                  void openFile(file).catch((err: unknown) => {
                    setStatusMessage(err instanceof Error ? err.message : "Failed to open file");
                  });
                }}
                onToggleFolder={(file) => {
                  void fetch(`/api/workspace/files/${encodeURIComponent(file.id)}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ expanded: file.expanded === 1 ? 0 : 1 }),
                  })
                    .then(() => loadFiles(sessionDid, setBusy, setStatusMessage))
                    .catch((err: unknown) => {
                      setStatusMessage(err instanceof Error ? err.message : "Failed to toggle folder");
                    });
                }}
                onRename={(file) => {
                  void renameWorkspaceItem(file).catch((err: unknown) => {
                    setStatusMessage(err instanceof Error ? err.message : "Failed to rename item");
                  });
                }}
                onDelete={(file) => {
                  void deleteWorkspaceItem(file).catch((err: unknown) => {
                    setStatusMessage(err instanceof Error ? err.message : "Failed to delete item");
                  });
                }}
                onMove={(draggedId, target, position) => {
                  void handleMoveWorkspaceItem(draggedId, target, position).catch((err: unknown) => {
                    setStatusMessage(err instanceof Error ? err.message : "Failed to reorder file tree");
                  });
                }}
                draggable={Boolean(sessionDid)}
              />
            ) : (
              <p className="text-xs text-slate-500">Login to access your private workspace files.</p>
            )}
          </section>

          {sessionDid ? (
            <ArticleList
              title="My Articles"
              articles={myArticles}
              activeArticleUri={activeArticleUri}
              actionLabel="Link Existing"
              onAction={() => {
                void syncLegacyArticles({ force: true }).catch((err: unknown) => {
                  setStatusMessage(err instanceof Error ? err.message : "Failed to sync legacy articles");
                });
              }}
              onOpen={(article) => {
                void openArticle(article).catch((err: unknown) => {
                  setStatusMessage(err instanceof Error ? err.message : "Failed to open article");
                });
              }}
            />
          ) : null}

        </aside>

        <section
          data-tour-id="editor"
          className="min-w-0 rounded-xl border bg-white p-4 shadow-sm"
          onClick={handleEditorCanvasClick}
          onDragOver={(event) => {
            if (!canEditTextCurrentFile) return;
            if (hasDraggedEditorBlock(event)) {
              event.preventDefault();
              if (imageDropTarget !== null) {
                setImageDropTarget(null);
              }
              return;
            }
            if (isBibWorkspaceFile) return;
            if (!hasDraggedImageData(event)) return;
            event.preventDefault();
            if (imageDropTarget !== null) {
              setImageDropTarget(null);
            }
          }}
          onDragLeave={() => {
            if (imageDropTarget !== null) {
              setImageDropTarget(null);
            }
            if (blockMoveDropTarget !== null) {
              setBlockMoveDropTarget(null);
            }
          }}
          onDrop={(event) => {
            if (hasDraggedEditorBlock(event)) {
              event.preventDefault();
              setDraggingEditorBlockId(null);
              setBlockMoveDropTarget(null);
              return;
            }
            void handleImageDrop(event, imageDropTarget);
            setBlockMoveDropTarget(null);
          }}
        >
          {!hasOpenDocument ? (
            <div className="flex h-full min-h-[26rem] items-center justify-center rounded-xl border border-dashed text-sm text-slate-500">
              Select a file or article from the sidebar.
            </div>
          ) : (
            <>
              <div className="mb-4 flex items-start justify-between gap-3" data-tour-id="publish-flow">
                <div className="flex flex-1 flex-col">
                  <input
                    ref={titleRef}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onBlur={() => {
                      if (!title.trim()) {
                        if (activeFile?.kind === "file") {
                          setTitle(defaultTitleFromFileName(activeFile.name));
                        }
                        return;
                      }
                      void persistTitleAsFileName({ silent: true }).catch((err: unknown) => {
                        setStatusMessage(err instanceof Error ? err.message : "Failed to save file name");
                      });
                    }}
                    onKeyDown={(e) => {
                      if (isImeComposing(e)) return;
                      
                      if (e.key === "ArrowDown" || e.key === "Enter") {
                        e.preventDefault();
                        if (!title.trim() && activeFile?.kind === "file") {
                          setTitle(defaultTitleFromFileName(activeFile.name));
                        }
                        void persistTitleAsFileName({ silent: true }).catch(() => {});
                        setIsAuthorsFocused(true);
                        setTimeout(() => {
                          authorsRef.current?.focus();
                        }, 10);
                        return;
                      }
                    }}
                    readOnly={!canEditCurrentFile}
                    className="w-full border-none bg-transparent text-3xl font-semibold outline-none"
                    placeholder="Untitled"
                  />

                                                                        {canPublishCurrentFile && (
                                                                          <div className="mt-1">
                                                                            {isAuthorsFocused || !authorsText.trim() ? (
                                                                              <>
                                                                                <textarea
                                                                                  ref={authorsRef}
                                                                                  autoFocus={isAuthorsFocused}
                                                                                  value={authorsText}
                                                                                  onChange={(e) => setAuthorsText(e.target.value)}
                                                                                  onBlur={() => setIsAuthorsFocused(false)}
                                                                                                              onKeyDown={(e) => {
                                                                                                                if (isImeComposing(e)) return;
                                                                                  
                                                                                                                const atStart = e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === 0;
                                                                                                                const atEnd = e.currentTarget.selectionStart === e.currentTarget.value.length && e.currentTarget.selectionEnd === e.currentTarget.value.length;
                                                                                  
                                                                                                                if (e.key === "ArrowUp" && atStart) {
                                                                                                                  e.preventDefault();
                                                                                                                  e.stopPropagation();
                                                                                                                  titleRef.current?.focus();
                                                                                                                  return;
                                                                                                                }
                                                                                  
                                                                                                                if (e.key === "ArrowDown" || e.key === "Enter") {
                                                                                                                  if (e.key === "Enter" || atEnd) {
                                                                                                                    e.preventDefault();
                                                                                                                    e.stopPropagation();
                                                                                                                    
                                                                                                                    // まず本文にフォーカスを移動
                                                                                                                    if (editorBlocks.length > 0) {
                                                                                                                      focusBlockByIndex(0, { position: "start" });
                                                                                                                    }
                                                                                                                    
                                                                                                                    // その後で著者欄を閉じる
                                                                                                                    setIsAuthorsFocused(false);
                                                                                                                  }
                                                                                                                }
                                                                                                              }}
                                                                                  
                                                                                  readOnly={!canEditCurrentFile}
                                                                                  className="w-full resize-none border-none bg-transparent font-mono text-sm text-slate-500 outline-none"
                                                                                  placeholder="著者名 <did:plc:...> (所属) ※コンマやセミコロンで区切り"
                                                                                  rows={Math.max(1, authorsText.split("\n").length)}
                                                                                />
                                                                                                                    {authorsText.trim() && (
                                                                <div className="mt-1 flex flex-wrap gap-1 opacity-60">
                                                                  {parseAuthors(authorsText).map((a, i) => (
                                                                    <span
                                                                      key={i}
                                                                      className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
                                                                    >
                                                                      <span>{a.name || "Unknown"}</span>
                                                                      {a.affiliation && <span className="opacity-60">({a.affiliation})</span>}
                                                                      {a.did && <span className="text-[8px] text-blue-500">DID</span>}
                                                                    </span>
                                                                  ))}
                                                                </div>
                                                              )}
                                                            </>
                                                          ) : (
                                                            <div
                                                              onClick={() => setIsAuthorsFocused(true)}
                                                              className="flex min-h-[1.5rem] cursor-text flex-wrap gap-1 py-1"
                                                            >
                                                              {parseAuthors(authorsText).map((a, i) => (
                                                                <span
                                                                  key={i}
                                                                  className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
                                                                >
                                                                  <span>{a.name || "Unknown"}</span>
                                                                  {a.affiliation && <span className="opacity-60">({a.affiliation})</span>}
                                                                  {a.did && <span className="text-[8px] text-blue-500">DID</span>}
                                                                </span>
                                                              ))}
                                                            </div>
                                                          )}
                                                        </div>
                                                      )}
                                                    </div>

                <div className="relative flex items-center gap-2">
                  {canEditCurrentFile ? (
                    <span className="text-xs text-slate-500">
                      {savingFile ? "Saving..." : isDirtyFile || isDirtyTitle ? "Unsaved changes" : "Saved"}
                    </span>
                  ) : null}

                  {canPublishCurrentFile ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        void handlePublish().catch((err: unknown) => {
                          setStatusMessage(err instanceof Error ? err.message : "Failed to publish");
                        });
                      }}
                      className="rounded-md bg-[#0085FF] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      Publish
                    </button>
                  ) : null}

                  {canEditTextCurrentFile && !isBibWorkspaceFile ? (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setShowMoreMenu((prev) => !prev)}
                        className="rounded-md border px-3 py-2 text-sm"
                      >
                        More
                      </button>
                      {showMoreMenu ? (
                        <div className="absolute right-0 top-11 z-20 w-64 rounded-lg border bg-white p-3 shadow-lg">
                          {isBibWorkspaceFile ? (
                            <p className="mb-2 text-xs text-slate-500">BibTeX files use code view only.</p>
                          ) : (
                            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                              Format
                              <select
                                value={sourceFormat}
                                onChange={(e) => handleSourceFormatChange(e.target.value as SourceFormat)}
                                className="mt-1 w-full rounded-md border px-2 py-1 text-sm font-normal"
                              >
                                <option value="markdown">Markdown</option>
                                <option value="tex">TeX</option>
                              </select>
                            </label>
                          )}

                          <label className="mb-2 flex items-center gap-2 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              checked={broadcastToBsky}
                              onChange={(e) => setBroadcastToBsky(e.target.checked)}
                            />
                            Bluesky Sync
                          </label>

                          {!isBibWorkspaceFile ? (
                            <div className="mb-2 space-y-1">
                              <button
                                type="button"
                                onClick={() => handleExport("md")}
                                className="w-full rounded border px-2 py-1 text-left text-xs hover:bg-slate-50"
                              >
                                Export .md
                              </button>
                              <button
                                type="button"
                                onClick={() => handleExport("tex")}
                                className="w-full rounded border px-2 py-1 text-left text-xs hover:bg-slate-50"
                              >
                                Export .tex
                              </button>
                            </div>
                          ) : null}

                          {currentDid && currentRkey ? (
                            <button
                              type="button"
                              onClick={() => {
                                void handleUnpublish().catch((err: unknown) => {
                                  setStatusMessage(err instanceof Error ? err.message : "Failed to unpublish");
                                });
                              }}
                              className="rounded border border-red-300 px-2 py-1 text-xs text-red-700"
                            >
                              Unpublish
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>

              {readOnlyMessage ? (
                <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {readOnlyMessage}
                </div>
              ) : null}

              <div className="min-h-[18rem]">
                {isImageWorkspaceFile ? (
                  <div className="space-y-3">
                    <p className="text-xs text-slate-500">Image Preview</p>
                    <div className="flex min-h-[18rem] items-center justify-center rounded-md border bg-slate-50 p-3">
                      {activeImagePreviewSrc ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={activeImagePreviewSrc}
                          alt={activeFile?.name ?? "image"}
                          className="max-h-[70vh] w-auto max-w-full rounded border bg-white object-contain"
                        />
                      ) : (
                        <p className="text-sm text-slate-500">No image data.</p>
                      )}
                    </div>
                  </div>
                ) : isBibWorkspaceFile ? (
                  <div className="space-y-3">
                    <p className="text-xs text-slate-500">BibTeX Code View</p>
                    <div className="space-y-1">
                      {editorBlocks.map((block, index) => (
                        <div
                          key={block.id}
                          data-editor-block-id={block.id}
                          className={`group flex items-start gap-2 rounded-md px-0.5 py-0.5 ${
                            activeBlockId === block.id
                              ? "bg-slate-50/70"
                              : selectedBlockIds.includes(block.id)
                                ? "bg-blue-50/50"
                                : "hover:bg-slate-50/60"
                          }`}
                          style={{
                            opacity:
                              draggingEditorBlockId &&
                              (draggingEditorBlockId === block.id ||
                                (selectedBlockIds.includes(draggingEditorBlockId) &&
                                  selectedBlockIds.includes(block.id)))
                                ? 0.4
                                : 1,
                          }}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (!canEditCurrentFile) return;
                            const target = event.target;
                            if (
                              target instanceof HTMLElement &&
                              target.closest("button,input,select,textarea,a,label,[role='button']")
                            ) {
                              return;
                            }
                            setActiveBlockId(block.id);
                            setSelectedBlockIds([block.id]);
                            setSelectionAnchorBlockId(block.id);
                            activateBlockEditor(block.id, "end");
                          }}
                        >
                          <div className="relative mt-1 w-5 shrink-0">
                            {canEditCurrentFile &&
                            (selectedBlockIds.includes(block.id) || draggingEditorBlockId === block.id) ? (
                              <button
                                type="button"
                                draggable
                                onDragStart={(event) => {
                                  const ids = selectedBlockIds.includes(block.id) ? selectedBlockIds : [block.id];
                                  if (ids.length > 1) {
                                    const ghost = document.createElement("div");
                                    ghost.style.position = "absolute";
                                    ghost.style.top = "-2000px";
                                    ghost.style.left = "-2000px";
                                    ghost.style.width = "400px";
                                    ghost.style.pointerEvents = "none";
                                    ghost.style.zIndex = "1000";

                                    ids.slice(0, 5).forEach((id) => {
                                      const el = document.querySelector(`[data-editor-block-id="${id}"]`);
                                      if (el) {
                                        const clone = el.cloneNode(true) as HTMLElement;
                                        clone.style.opacity = "0.6";
                                        clone.style.marginBottom = "4px";
                                        clone.style.border = "1px solid #E2E8F0";
                                        clone.style.backgroundColor = "white";
                                        clone.style.borderRadius = "4px";
                                        clone.style.boxShadow = "0 2px 4px rgba(0,0,0,0.05)";
                                        const controls = clone.querySelector(".shrink-0");
                                        if (controls) (controls as HTMLElement).style.display = "none";
                                        ghost.appendChild(clone);
                                      }
                                    });

                                    if (ids.length > 5) {
                                      const more = document.createElement("div");
                                      more.innerText = `+ ${ids.length - 5} more blocks`;
                                      more.style.padding = "4px";
                                      more.style.fontSize = "10px";
                                      more.style.color = "#64748b";
                                      more.style.textAlign = "center";
                                      ghost.appendChild(more);
                                    }

                                    document.body.appendChild(ghost);
                                    event.dataTransfer.setDragImage(ghost, 20, 20);
                                    window.setTimeout(() => document.body.removeChild(ghost), 0);
                                  }
                                  setDraggingEditorBlockId(block.id);
                                  setBlockMoveDropTarget(null);
                                  setImageDropTarget(null);
                                  event.dataTransfer.setData(BLOCK_DRAG_MIME, block.id);
                                  event.dataTransfer.effectAllowed = "move";
                                }}
                                onDragEnd={() => {
                                  setDraggingEditorBlockId(null);
                                  setBlockMoveDropTarget(null);
                                }}
                                onClick={() => {
                                  setActiveBlockId(block.id);
                                  setBlockMenuForId((prev) => (prev === block.id ? null : block.id));
                                }}
                                className={`flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-600 ${
                                  draggingEditorBlockId === block.id ? "cursor-grabbing" : "cursor-grab"
                                }`}
                                title="Drag to move block"
                              >
                                ⋮⋮
                              </button>
                            ) : (
                              <div className="text-center text-[11px] text-slate-400">{index + 1}</div>
                            )}
                            {blockMenuForId === block.id ? (
                              <div className="absolute left-6 top-0 z-30 w-32 rounded-md border bg-white p-1 text-xs shadow-lg">
                                <button
                                  type="button"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => {
                                    removeBlock(index);
                                    setBlockMenuForId(null);
                                  }}
                                  className="block w-full rounded px-2 py-1 text-left text-red-600 hover:bg-red-50"
                                >
                                  Delete
                                </button>
                              </div>
                            ) : null}
                          </div>
                          <div className="min-w-0 w-full">
                            {canEditCurrentFile && activeBlockId === block.id ? (
                              <div className="relative max-w-full rounded border bg-white">
                                <div
                                  ref={(el) => {
                                    bibHighlightScrollRefs.current[block.id] = el;
                                  }}
                                  aria-hidden
                                  className="pointer-events-none absolute inset-0 overflow-x-auto px-2 py-1"
                                >
                                  <p className="whitespace-pre font-mono text-xs leading-6 text-slate-800">
                                    {block.text.length > 0
                                      ? renderBibtexHighlighted(block.text, `editor-bib-active-${block.id}`)
                                      : " "}
                                  </p>
                                </div>
                                <textarea
                                  data-editor-block-id={block.id}
                                  ref={(el) => {
                                    textareaRefs.current[block.id] = el;
                                    resizeTextarea(el);
                                  }}
                                  value={block.text}
                                  readOnly={!canEditCurrentFile}
                                  rows={1}
                                  wrap="off"
                                  spellCheck={false}
                                  onScroll={(event) => {
                                    const overlay = bibHighlightScrollRefs.current[block.id];
                                    if (!overlay) return;
                                    overlay.scrollLeft = event.currentTarget.scrollLeft;
                                    overlay.scrollTop = event.currentTarget.scrollTop;
                                  }}
                                  onFocus={() => {
                                    setActiveBlockId(block.id);
                                    setSelectedBlockIds((prev) => (prev.includes(block.id) ? prev : [block.id]));
                                    setSelectionAnchorBlockId((prev) => {
                                      // 関数型アップデートの中で、最新のselectedBlockIdsの状態を確認できないため
                                      // prevが存在し、かつそれが今のブロックではない場合はアンカーを維持する方針にする
                                      return prev || block.id;
                                    });
                                  }}
                                  onBlur={(event) => {
                                    const nextFocusedElement =
                                      event.relatedTarget instanceof HTMLElement ? event.relatedTarget : null;
                                    formatBibtexBlockById(block.id, event.currentTarget.value);
                                    window.setTimeout(() => {
                                      if (draggingEditorBlockIdRef.current === block.id) return;
                                      if (
                                        nextFocusedElement &&
                                        nextFocusedElement.closest(`[data-editor-block-id="${block.id}"]`)
                                      ) {
                                        return;
                                      }
                                      setActiveBlockId((prev) => (prev === block.id ? null : prev));
                                    }, 0);
                                  }}
                                  onChange={(event) => {
                                    updateBlock(block.id, { kind: "paragraph", text: event.target.value });
                                    resizeTextarea(event.target);
                                  }}
                                  onKeyDown={(event) => {
                                    if (!canEditCurrentFile) return;
                                    if (isImeComposing(event)) return;
                                    if ((event.metaKey || event.ctrlKey) && event.shiftKey) {
                                      if (event.key === "ArrowUp") {
                                        event.preventDefault();
                                        moveBlockByDelta(index, -1);
                                        return;
                                      }
                                      if (event.key === "ArrowDown") {
                                        event.preventDefault();
                                        moveBlockByDelta(index, 1);
                                        return;
                                      }
                                    }
                                    const {
                                      selectionStart,
                                      selectionEnd,
                                      selectionDirection: dir,
                                    } = event.currentTarget;
                                    const valueLength = event.currentTarget.value.length;
                                    const atEnd = selectionStart === valueLength && selectionEnd === valueLength;

                                    const canJumpUp = event.shiftKey
                                      ? selectionStart === 0 && (dir === "backward" || selectionEnd === 0)
                                      : selectionStart === 0 && selectionEnd === 0;
                                    const canJumpDown = event.shiftKey
                                      ? selectionEnd === valueLength &&
                                        (dir === "forward" || selectionStart === valueLength)
                                      : selectionStart === valueLength && selectionEnd === valueLength;

                                    if (event.key === "ArrowUp" && canJumpUp && index > 0) {
                                      event.preventDefault();
                                      if (event.shiftKey) {
                                        const prevId = editorBlocks[index - 1].id;
                                        updateSelectionRange(prevId, true);
                                        setActiveBlockId(prevId);
                                        window.setTimeout(() => {
                                          const prevTextarea = textareaRefs.current[prevId];
                                          if (prevTextarea) {
                                            prevTextarea.focus();
                                            // Set cursor to the end, no selection yet
                                            const len = prevTextarea.value.length;
                                            prevTextarea.setSelectionRange(len, len);
                                          }
                                        }, 0);
                                      } else {
                                        focusBlockByIndex(index - 1, { position: "end" });
                                      }
                                      return;
                                    }
                                    if (event.key === "ArrowDown" && canJumpDown && index < editorBlocks.length - 1) {
                                      event.preventDefault();
                                      if (event.shiftKey) {
                                        const nextId = editorBlocks[index + 1].id;
                                        updateSelectionRange(nextId, true);
                                        setActiveBlockId(nextId);
                                        window.setTimeout(() => {
                                          const nextTextarea = textareaRefs.current[nextId];
                                          if (nextTextarea) {
                                            nextTextarea.focus();
                                            // Set cursor to the start, no selection yet
                                            nextTextarea.setSelectionRange(0, 0);
                                          }
                                        }, 0);
                                      } else {
                                        focusBlockByIndex(index + 1, { position: "start" });
                                      }
                                      return;
                                    }
                                    if (
                                      event.key === "Enter" &&
                                      !event.shiftKey &&
                                      atEnd &&
                                      isClosedBibtexEntryBlock(block.text)
                                    ) {
                                      event.preventDefault();
                                      const template = createBibtexTemplate(sourceText);
                                      insertBlockAfter(index, "paragraph", template);
                                      return;
                                    }
                                    if (event.key === "Enter" && event.shiftKey) {
                                      event.preventDefault();
                                      const template = createBibtexTemplate(sourceText);
                                      insertBlockAfter(index, "paragraph", template);
                                      return;
                                    }
                                    if (
                                      event.key === "Backspace" &&
                                      block.text.length === 0 &&
                                      editorBlocks.length > 1
                                    ) {
                                      event.preventDefault();
                                      removeBlock(index);
                                    }
                                  }}
                                  placeholder="@article{citation_key, ...}"
                                  className="relative z-10 max-w-full w-full resize-none overflow-x-auto whitespace-pre bg-transparent px-2 py-1 font-mono text-xs leading-6 text-transparent caret-slate-800 outline-none selection:bg-sky-300/30 selection:text-transparent"
                                />
                              </div>
                            ) : (
                              <div
                                role={canEditCurrentFile ? "button" : undefined}
                                tabIndex={canEditCurrentFile ? 0 : undefined}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (!canEditCurrentFile) return;
                                  activateBlockEditor(block.id, "end");
                                }}
                                onKeyDown={(event) => {
                                  if (!canEditCurrentFile) return;
                                  if (event.key !== "Enter" && event.key !== " ") return;
                                  event.preventDefault();
                                  activateBlockEditor(block.id, "start");
                                }}
                                className={`min-h-[1.75rem] min-w-0 w-full rounded border bg-white px-2 py-1 ${
                                  canEditCurrentFile ? "cursor-text" : ""
                                }`}
                              >
                                {block.text.trim().length > 0 ? (
                                                                  <div className={`max-w-full overflow-x-auto ${selectedBlockIds.includes(block.id) ? "bg-[#B4D5FF]" : ""}`}>
                                                                    <p className="whitespace-pre font-mono text-xs leading-6 text-slate-800">
                                                                      {renderBibtexHighlighted(
                                                                        block.text,
                                                                        `editor-bib-block-preview-${block.id}`,
                                                                      )}
                                                                    </p>
                                                                  </div>                                ) : (
                                  <p className="font-mono text-xs text-slate-400">
                                    {"@article{citation_key, ...}"}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-slate-500">{parseBibtexEntries(sourceText).length} entries detected.</p>
                  </div>
                ) : (
                  <>
                    <div className="space-y-0.5">
                  {editorBlocks.map((block, index) => (
                    (() => {
                      const imageLine = block.kind === "paragraph" ? parseMarkdownImageLine(block.text) : null;
                      const imageAlign = imageLine ? imageAlignFromAttrs(imageLine.attrs) : "center";
                      return (
                    <div
                      key={block.id}
                      data-editor-block="true"
                      data-editor-block-id={block.id}
                      className={`group flex items-start gap-2 rounded-md px-0.5 py-0.5 ${
                        activeBlockId === block.id
                          ? "bg-slate-50/70"
                          : selectedBlockIds.includes(block.id)
                            ? "bg-blue-50/50"
                            : "hover:bg-slate-50/60"
                      } ${
                        blockMoveDropTarget?.blockId === block.id && blockMoveDropTarget.position === "before"
                          ? "border-t-2 border-emerald-500"
                          : blockMoveDropTarget?.blockId === block.id &&
                              blockMoveDropTarget.position === "after"
                            ? "border-b-2 border-emerald-500"
                            : imageDropTarget?.blockId === block.id && imageDropTarget.position === "before"
                              ? "border-t-2 border-[#0085FF]"
                              : imageDropTarget?.blockId === block.id &&
                                  imageDropTarget.position === "after"
                                ? "border-b-2 border-[#0085FF]"
                                : ""
                      }`}
                      style={{
                        opacity:
                          draggingEditorBlockId &&
                          (draggingEditorBlockId === block.id ||
                            (selectedBlockIds.includes(draggingEditorBlockId) &&
                              selectedBlockIds.includes(block.id)))
                            ? 0.4
                            : 1,
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!canEditCurrentFile) return;
                        const target = event.target;
                        if (
                          target instanceof HTMLElement &&
                          target.closest("button,input,select,textarea,a,label,[role='button']")
                        ) {
                          return;
                        }
                        setActiveBlockId(block.id);
                        setSelectedBlockIds([block.id]);
                        setSelectionAnchorBlockId(block.id);
                        activateBlockEditor(block.id, "end");
                      }}
                      onDragOver={(event) => {
                        if (!canEditTextCurrentFile) return;
                        if (hasDraggedEditorBlock(event)) {
                          const draggedId =
                            event.dataTransfer.getData(BLOCK_DRAG_MIME) || draggingEditorBlockId;
                          if (!draggedId || draggedId === block.id) return;
                          event.preventDefault();
                          event.stopPropagation();
                          const position = determineBlockDropPosition(event);
                          if (
                            blockMoveDropTarget?.blockId !== block.id ||
                            blockMoveDropTarget.position !== position
                          ) {
                            setBlockMoveDropTarget({ blockId: block.id, position });
                          }
                          if (imageDropTarget !== null) {
                            setImageDropTarget(null);
                          }
                          return;
                        }
                        if (isBibWorkspaceFile) return;
                        if (!hasDraggedImageData(event)) return;
                        event.preventDefault();
                        event.stopPropagation();
                        const position = determineBlockDropPosition(event);
                        if (
                          imageDropTarget?.blockId !== block.id ||
                          imageDropTarget.position !== position
                        ) {
                          setImageDropTarget({ blockId: block.id, position });
                        }
                      }}
                      onDrop={(event) => {
                        if (!canEditTextCurrentFile) return;
                        if (hasDraggedEditorBlock(event)) {
                          const draggedId =
                            event.dataTransfer.getData(BLOCK_DRAG_MIME) || draggingEditorBlockId;
                          const position = determineBlockDropPosition(event);
                          event.preventDefault();
                          event.stopPropagation();
                          if (draggedId && draggedId !== block.id) {
                            moveBlockByDrop(draggedId, block.id, position);
                          }
                          setDraggingEditorBlockId(null);
                          setBlockMoveDropTarget(null);
                          return;
                        }
                        if (isBibWorkspaceFile) return;
                        const position = determineBlockDropPosition(event);
                        event.stopPropagation();
                        void handleImageDrop(event, { blockId: block.id, position });
                      }}
                    >
                      <div className="relative mt-1 w-5 shrink-0">
                        {canEditCurrentFile &&
                        (selectedBlockIds.includes(block.id) || draggingEditorBlockId === block.id) ? (
                          <>
                            <button
                              type="button"
                              draggable
                              onDragStart={(event) => {
                                const ids = selectedBlockIds.includes(block.id) ? selectedBlockIds : [block.id];
                                if (ids.length > 1) {
                                  const ghost = document.createElement("div");
                                  ghost.style.position = "absolute";
                                  ghost.style.top = "-2000px";
                                  ghost.style.left = "-2000px";
                                  ghost.style.width = "400px";
                                  ghost.style.pointerEvents = "none";
                                  ghost.style.zIndex = "1000";

                                  ids.slice(0, 5).forEach((id) => {
                                    const el = document.querySelector(`[data-editor-block-id="${id}"]`);
                                    if (el) {
                                      const clone = el.cloneNode(true) as HTMLElement;
                                      clone.style.opacity = "0.6";
                                      clone.style.marginBottom = "4px";
                                      clone.style.border = "1px solid #E2E8F0";
                                      clone.style.backgroundColor = "white";
                                      clone.style.borderRadius = "4px";
                                      clone.style.boxShadow = "0 2px 4px rgba(0,0,0,0.05)";
                                      const controls = clone.querySelector(".shrink-0");
                                      if (controls) (controls as HTMLElement).style.display = "none";
                                      ghost.appendChild(clone);
                                    }
                                  });

                                  if (ids.length > 5) {
                                    const more = document.createElement("div");
                                    more.innerText = `+ ${ids.length - 5} more blocks`;
                                    more.style.padding = "4px";
                                    more.style.fontSize = "10px";
                                    more.style.color = "#64748b";
                                    more.style.textAlign = "center";
                                    ghost.appendChild(more);
                                  }

                                  document.body.appendChild(ghost);
                                  event.dataTransfer.setDragImage(ghost, 20, 20);
                                  window.setTimeout(() => document.body.removeChild(ghost), 0);
                                }
                                setDraggingEditorBlockId(block.id);
                                setBlockMoveDropTarget(null);
                                setImageDropTarget(null);
                                event.dataTransfer.setData(BLOCK_DRAG_MIME, block.id);
                                event.dataTransfer.effectAllowed = "move";
                              }}
                              onDragEnd={() => {
                                setDraggingEditorBlockId(null);
                                setBlockMoveDropTarget(null);
                              }}
                              onClick={() => {
                                setActiveBlockId(block.id);
                                setBlockMenuForId((prev) => (prev === block.id ? null : block.id));
                              }}
                              className={`flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-600 ${
                                draggingEditorBlockId === block.id ? "cursor-grabbing" : "cursor-grab"
                              }`}
                              title="Drag to move block"
                            >
                              ⋮⋮
                            </button>
                            {blockMenuForId === block.id ? (
                              <div className="absolute left-6 top-0 z-30 w-32 rounded-md border bg-white p-1 text-xs shadow-lg">
                                {([
                                  ["Text", "paragraph"],
                                  ["Heading 1", "h1"],
                                  ["Heading 2", "h2"],
                                  ["Heading 3", "h3"],
                                ] as const).map(([label, value]) => (
                                  <button
                                    key={value}
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => {
                                      updateBlock(block.id, { kind: value });
                                      setBlockMenuForId(null);
                                    }}
                                    className={`block w-full rounded px-2 py-1 text-left hover:bg-slate-100 ${
                                      block.kind === value ? "text-[#0085FF]" : "text-slate-700"
                                    }`}
                                  >
                                    {label}
                                  </button>
                                ))}
                                <button
                                  type="button"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => {
                                    removeBlock(index);
                                    setBlockMenuForId(null);
                                  }}
                                  className="mt-1 block w-full rounded px-2 py-1 text-left text-red-600 hover:bg-red-50"
                                >
                                  Delete
                                </button>
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <span className="block h-5 w-5" />
                        )}
                      </div>

                      <div className="w-full">
                        {canEditCurrentFile && activeBlockId === block.id ? (
                          <>
                            {imageLine ? (
                              <div className="mb-1 flex items-center gap-1 text-xs">
                                {(["left", "center", "right"] as const).map((align) => (
                                  <button
                                    key={align}
                                    type="button"
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => {
                                      updateBlock(block.id, {
                                        text: setImageAlignOnMarkdownLine(block.text, align),
                                      });
                                    }}
                                    className={`rounded border px-2 py-0.5 ${
                                      imageAlign === align
                                        ? "border-[#0085FF] bg-[#E7F2FF] text-[#0068CC]"
                                        : "text-slate-600 hover:bg-slate-50"
                                    }`}
                                  >
                                    {align === "left" ? "Left" : align === "right" ? "Right" : "Center"}
                                  </button>
                                ))}
                              </div>
                            ) : null}
                            <textarea
                              data-editor-block-id={block.id}
                              ref={(el) => {
                                textareaRefs.current[block.id] = el;
                                resizeTextarea(el);
                              }}
                              value={block.text}
                              readOnly={!canEditCurrentFile}
                              rows={1}
                              onFocus={() => {
                                setActiveBlockId(block.id);
                                setSelectedBlockIds((prev) => (prev.includes(block.id) ? prev : [block.id]));
                                setSelectionAnchorBlockId((prev) => prev || block.id);
                              }}
                              onBlur={(event) => {
                                const nextFocusedElement =
                                  event.relatedTarget instanceof HTMLElement ? event.relatedTarget : null;
                                window.setTimeout(() => {
                                  if (citationMenu?.blockId === block.id) return;
                                  if (draggingEditorBlockIdRef.current === block.id) return;
                                  if (
                                    nextFocusedElement &&
                                    nextFocusedElement.closest(`[data-editor-block-id="${block.id}"]`)
                                  ) {
                                    return;
                                  }
                                  setActiveBlockId((prev) => (prev === block.id ? null : prev));
                                }, 0);
                              }}
                              onChange={(e) => {
                                const nextValue = e.target.value;
                                const normalized = normalizeEditedBlockInput(
                                  block,
                                  nextValue,
                                  sourceFormat,
                                );
                                updateBlock(block.id, normalized);
                                resizeTextarea(e.target);
                                updateCitationMenu(block.id, normalized.text, e.target.selectionStart);
                              }}
                              onSelect={(e) => {
                                const target = e.currentTarget;
                                const quote = target.value.slice(target.selectionStart, target.selectionEnd).trim();
                                setSelectedQuote(quote.slice(0, 280));
                              }}
                              onKeyDown={(e) => {
                                if (!canEditCurrentFile) return;
                                if (isImeComposing(e)) return;
                                if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
                                  if (e.key === "ArrowUp") {
                                    e.preventDefault();
                                    moveBlockByDelta(index, -1);
                                    return;
                                  }
                                  if (e.key === "ArrowDown") {
                                    e.preventDefault();
                                    moveBlockByDelta(index, 1);
                                    return;
                                  }
                                }

                                const menuOpenForBlock =
                                  citationMenu?.blockId === block.id &&
                                  filteredCitationEntries.length > 0;
                                if (menuOpenForBlock && e.key === "ArrowDown") {
                                  e.preventDefault();
                                  setCitationMenuIndex(
                                    (prev) => (prev + 1) % filteredCitationEntries.length,
                                  );
                                  return;
                                }
                                if (menuOpenForBlock && e.key === "ArrowUp") {
                                  e.preventDefault();
                                  setCitationMenuIndex(
                                    (prev) =>
                                      (prev - 1 + filteredCitationEntries.length) %
                                      filteredCitationEntries.length,
                                  );
                                  return;
                                }
                                if (menuOpenForBlock && e.key === "Escape") {
                                  e.preventDefault();
                                  setCitationMenu(null);
                                  return;
                                }
                                if (menuOpenForBlock && e.key === "Enter" && !e.shiftKey) {
                                  e.preventDefault();
                                  const picked = filteredCitationEntries[citationMenuIndex];
                                  if (picked) {
                                    applyCitationSuggestion(picked);
                                  }
                                  return;
                                }

                                const {
                                  selectionStart,
                                  selectionEnd,
                                  selectionDirection: dir,
                                } = e.currentTarget;
                                const valueLength = e.currentTarget.value.length;

                                const canJumpUp = e.shiftKey
                                  ? selectionStart === 0 && (dir === "backward" || selectionEnd === 0)
                                  : selectionStart === 0 && selectionEnd === 0;
                                const canJumpDown = e.shiftKey
                                  ? selectionEnd === valueLength && (dir === "forward" || selectionStart === valueLength)
                                  : selectionStart === valueLength && selectionEnd === valueLength;

                                if (e.key === "ArrowUp" && canJumpUp) {
                                  if (index > 0) {
                                    e.preventDefault();
                                    if (e.shiftKey) {
                                      const prevId = editorBlocks[index - 1].id;
                                      updateSelectionRange(prevId, true);
                                      setActiveBlockId(prevId);
                                      window.setTimeout(() => {
                                        const prevTextarea = textareaRefs.current[prevId];
                                        if (prevTextarea) {
                                          prevTextarea.focus();
                                          // Set cursor to the end
                                          const len = prevTextarea.value.length;
                                          prevTextarea.setSelectionRange(len, len);
                                        }
                                      }, 0);
                                    } else {
                                      focusBlockByIndex(index - 1, { position: "end" });
                                    }
                                  } else if (!e.shiftKey) {
                                    // 最初のブロックから著者欄へ戻る
                                    e.preventDefault();
                                    setIsAuthorsFocused(true);
                                    setTimeout(() => {
                                      authorsRef.current?.focus();
                                      const len = authorsRef.current?.value.length ?? 0;
                                      authorsRef.current?.setSelectionRange(len, len);
                                    }, 10);
                                  }
                                  return;
                                }
                                if (e.key === "ArrowDown" && canJumpDown && index < editorBlocks.length - 1) {
                                  e.preventDefault();
                                  if (e.shiftKey) {
                                    const nextId = editorBlocks[index + 1].id;
                                    updateSelectionRange(nextId, true);
                                    setActiveBlockId(nextId);
                                    window.setTimeout(() => {
                                      const nextTextarea = textareaRefs.current[nextId];
                                      if (nextTextarea) {
                                        nextTextarea.focus();
                                        // Set cursor to the start
                                        nextTextarea.setSelectionRange(0, 0);
                                      }
                                    }, 0);
                                  } else {
                                    focusBlockByIndex(index + 1, { position: "start" });
                                  }
                                  return;
                                }

                                if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "m") {
                                  e.preventDefault();
                                  insertInlineMath(block.id);
                                  return;
                                }
                                if (e.key === "Enter" && !e.shiftKey) {
                                  e.preventDefault();
                                  insertBlockAfter(index, "paragraph");
                                  return;
                                }
                                if (
                                  e.key === "Backspace" &&
                                  block.text.length === 0 &&
                                  editorBlocks.length > 1
                                ) {
                                  e.preventDefault();
                                  removeBlock(index);
                                }
                              }}
                              placeholder={block.kind === "paragraph" ? "" : "Heading"}
                              className={`w-full resize-none border-none bg-transparent p-0 outline-none ${blockTextClass(
                                block.kind,
                              )} select-text`}
                            />
                            {citationMenu?.blockId === block.id ? (
                              <div className="mt-1 rounded-md border bg-white p-1 shadow-sm">
                                {filteredCitationEntries.length === 0 ? (
                                  <p className="px-2 py-1 text-xs text-slate-500">No citation match.</p>
                                ) : (
                                  <ul className="max-h-64 overflow-y-auto">
                                    {filteredCitationEntries.map((entry, idx) => (
                                      <li
                                        key={entry.key}
                                        ref={(el) => {
                                          if (idx === citationMenuIndex) {
                                            el?.scrollIntoView({ block: "nearest" });
                                          }
                                        }}
                                      >
                                        <button
                                          type="button"
                                          onMouseDown={(event) => event.preventDefault()}
                                          onClick={() => applyCitationSuggestion(entry)}
                                          className={`w-full rounded px-2 py-1 text-left text-xs ${
                                            idx === citationMenuIndex ? "bg-[#E7F2FF]" : "hover:bg-slate-50"
                                          }`}
                                        >
                                          <p className="font-mono text-[11px] text-slate-700">[@{entry.key}]</p>
                                          <p className="truncate text-slate-500">{entry.title ?? entry.author ?? "-"}</p>
                                        </button>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <div
                            role={canEditCurrentFile ? "button" : undefined}
                            tabIndex={canEditCurrentFile ? 0 : undefined}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (!canEditCurrentFile) return;
                              const target = event.target;
                              if (target instanceof HTMLElement && target.closest("a")) {
                                return;
                              }
                              activateBlockEditor(block.id, "end");
                            }}
                            onKeyDown={(event) => {
                              if (!canEditCurrentFile) return;
                              if (event.key !== "Enter" && event.key !== " ") return;
                              event.preventDefault();
                              activateBlockEditor(block.id, "start");
                            }}
                            className={`min-h-[1.5rem] w-full rounded px-0.5 py-0.5 ${
                              canEditCurrentFile ? "cursor-text" : ""
                            }`}
                          >
                            {block.text.trim().length > 0 ? (
                              block.kind === "paragraph" ? (
                                renderRichParagraphs(block.text, `editor-block-preview-${block.id}`, {
                                  citationLookup: renderCitationLookup,
                                  citationNumberByKey,
                                  referenceAnchorPrefix: "editor-ref",
                                  resolveImageSrc: resolveWorkspaceImageSrc,
                                  isSelected: selectedBlockIds.includes(block.id),
                                })
                              ) : (
                                <p className={`${blockTextClass(block.kind)} whitespace-pre-wrap`}>
                                  {renderInlineText(
                                    block.text,
                                    `editor-heading-preview-${block.id}`,
                                    {
                                      citationLookup: renderCitationLookup,
                                      citationNumberByKey,
                                      referenceAnchorPrefix: "editor-ref",
                                      isSelected: selectedBlockIds.includes(block.id),
                                    },
                                  )}
                                </p>
                              )
                            ) : (
                              block.kind === "paragraph" ? (
                                <p className="h-6" />
                              ) : (
                                <p className="text-sm text-slate-400">Heading</p>
                              )
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                      );
                    })()
                  ))}
                </div>

                {resolvedBibliography.length > 0 ? (
                  <section className="mt-4 rounded-md border p-3">
                    <p className="text-xs text-slate-500">References</p>
                    <ul className="mt-2 space-y-1 text-xs text-slate-700">
                      {formatBibliographyIEEE(resolvedBibliography).map((line, index) => (
                        <li
                          key={`${line}-${index}`}
                          id={referenceAnchorId("editor-ref", resolvedBibliography[index].key)}
                          className="scroll-mt-24"
                        >
                          {line}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {selectedQuote ? (
                  <div data-tour-id="selection-hook" className="mt-3 rounded-md border bg-white p-2">
                    <p className="line-clamp-2 text-xs text-slate-600">{selectedQuote}</p>
                    <button
                      type="button"
                      onClick={() => setTab("discussion")}
                      className="mt-2 rounded bg-[#0085FF] px-2 py-1 text-xs text-white"
                    >
                      Blueskyで熟議する
                    </button>
                  </div>
                ) : null}
                  </>
                )}
              </div>
            </>
          )}
        </section>

        <aside data-tour-id="right-panel" className="min-w-0 rounded-xl border bg-white p-3 shadow-sm">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Discussion</p>

          {tab === "preview" ? (
            <div className="space-y-3" onMouseUp={captureWindowSelection}>
              {isImageWorkspaceFile ? (
                <>
                  <p className="text-xs text-slate-500">Image Preview</p>
                  <div className="flex min-h-[18rem] items-center justify-center rounded-md border bg-slate-50 p-3">
                    {activeImagePreviewSrc ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={activeImagePreviewSrc}
                        alt={activeFile?.name ?? "image"}
                        className="max-h-[70vh] w-auto max-w-full rounded border bg-white object-contain"
                      />
                    ) : (
                      <p className="text-sm text-slate-500">No image data.</p>
                    )}
                  </div>
                </>
              ) : isBibWorkspaceFile ? (
                <>
                  <p className="text-xs text-slate-500">BibTeX Preview</p>
                  <div className="max-w-full overflow-x-auto overflow-y-auto rounded-md border bg-white p-3">
                    <p className="whitespace-pre font-mono text-xs leading-6 text-slate-800">
                      {sourceText.trim()
                        ? renderBibtexHighlighted(formatBibtexSource(sourceText), "preview-bib")
                        : "No entries yet."}
                    </p>
                  </div>
                </>
              ) : sourceFormat === "markdown" ? (
                <>
                  <p className="text-xs text-slate-500">Markdown Preview</p>
                  <div className="rounded-md border p-3 select-text">
                    {sourceText.trim() ? (
                      renderRichParagraphs(sourceText, "md-preview", {
                        citationLookup: renderCitationLookup,
                        citationNumberByKey,
                        referenceAnchorPrefix: "preview-ref",
                        resolveImageSrc: resolveWorkspaceImageSrc,
                      })
                    ) : (
                      <p className="text-sm text-slate-500">No blocks yet.</p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <p className="text-xs text-slate-500">TeX Preview ({previewBlocks.length} sections)</p>
                  {previewBlocks.length === 0 ? (
                    <p className="text-sm text-slate-500">No blocks yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {previewBlocks.map((block, idx) => {
                        const headingClass =
                          block.level <= 1
                            ? "text-2xl font-semibold"
                            : block.level === 2
                              ? "text-xl font-semibold"
                              : "text-lg font-semibold";
                        return (
                          <section key={`${block.heading}-${idx}`} className="rounded-md border p-3">
                            <p className={headingClass}>{block.heading}</p>
                            <div className="mt-2">
                              {renderRichParagraphs(block.content, `tex-${idx}`, {
                                citationLookup: renderCitationLookup,
                                citationNumberByKey,
                                referenceAnchorPrefix: "preview-ref",
                                resolveImageSrc: resolveWorkspaceImageSrc,
                              })}
                            </div>
                          </section>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
              {!isBibWorkspaceFile && !isImageWorkspaceFile && resolvedBibliography.length > 0 ? (
                <section className="rounded-md border p-3">
                  <p className="text-xs text-slate-500">References (IEEE)</p>
                  <ul className="mt-2 space-y-1 text-xs text-slate-700">
                    {formatBibliographyIEEE(resolvedBibliography).map((line, index) => (
                      <li
                        key={`${line}-${index}`}
                        id={referenceAnchorId("preview-ref", resolvedBibliography[index].key)}
                        className="scroll-mt-24"
                      >
                        {line}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {!isBibWorkspaceFile && !isImageWorkspaceFile && missingCitationKeys.length > 0 ? (
                <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900">
                  Missing bibliography keys: {missingCitationKeys.join(", ")}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3">
              {selectedQuote ? (
                <div className="rounded-md border bg-[#FFFCDB] p-2">
                  <p className="text-xs font-semibold text-slate-700">Highlighted quote</p>
                  <p className="mt-1 text-xs text-slate-600">{selectedQuote}</p>
                  <textarea
                    value={quoteComment}
                    onChange={(e) => setQuoteComment(e.target.value)}
                    placeholder="Post inline review comment"
                    rows={3}
                    className="mt-2 w-full rounded border bg-white px-2 py-1 text-xs"
                  />
                  <button
                    type="button"
                    disabled={!sessionDid || busy || !quoteComment.trim()}
                    onClick={() => {
                      void submitInlineComment().catch((err: unknown) => {
                        setStatusMessage(err instanceof Error ? err.message : "Failed to post comment");
                      });
                    }}
                    className="mt-2 rounded bg-[#0085FF] px-2 py-1 text-xs text-white disabled:opacity-50"
                  >
                    Post Quote Comment
                  </button>
                </div>
              ) : null}

              {discussionRoot ? (
                <div className="rounded-md border bg-slate-50 p-2">
                  <p className="text-xs font-semibold text-slate-500">Root Post</p>
                  <p className="mt-1 break-all text-sm text-slate-800">{discussionRoot.text}</p>
                </div>
              ) : (
                <p className="text-sm text-slate-500">No announcement thread yet.</p>
              )}

              <ul className="space-y-2">
                {discussionPosts.map((post) => (
                  <li
                    key={post.uri}
                    className={`rounded-md border p-2 ${post.quoted ? "border-amber-200 bg-amber-50/50" : ""}`}
                    style={{ marginLeft: `${Math.min(post.depth, 6) * 12}px` }}
                  >
                    <p className="text-xs text-slate-500">
                      @{post.handle ?? post.authorDid} · {timeAgo(post.createdAt)}
                    </p>
                    <div className="mt-1 flex items-center gap-1">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-600">
                        {post.source}
                      </span>
                      {post.quoted ? (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] uppercase text-amber-700">
                          quote
                        </span>
                      ) : null}
                    </div>
                    {post.quote ? (
                      <p className="mt-1 break-all rounded bg-[#FFFCDB] px-2 py-1 text-xs text-slate-600">
                        {post.quote}
                      </p>
                    ) : null}
                    <p className="mt-2 whitespace-pre-wrap break-all text-sm text-slate-800">{post.text}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={!sessionDid}
                        onClick={() => {
                          void runEngagement("like", post).catch((err: unknown) => {
                            setStatusMessage(err instanceof Error ? err.message : "Like failed");
                          });
                        }}
                        className={`rounded border px-2 py-1 text-xs disabled:opacity-50 ${
                          post.liked ? "border-[#0085FF] text-[#0085FF]" : ""
                        }`}
                      >
                        Like
                      </button>
                      <button
                        type="button"
                        disabled={!sessionDid}
                        onClick={() => {
                          void runEngagement("repost", post).catch((err: unknown) => {
                            setStatusMessage(err instanceof Error ? err.message : "Repost failed");
                          });
                        }}
                        className={`rounded border px-2 py-1 text-xs disabled:opacity-50 ${
                          post.reposted ? "border-[#0085FF] text-[#0085FF]" : ""
                        }`}
                      >
                        Repost
                      </button>
                      <input
                        value={replyDrafts[post.uri] ?? ""}
                        onChange={(e) =>
                          setReplyDrafts((prev) => ({
                            ...prev,
                            [post.uri]: e.target.value,
                          }))
                        }
                        placeholder="Reply..."
                        disabled={!sessionDid}
                        className="min-w-28 flex-1 rounded border px-2 py-1 text-xs disabled:opacity-50"
                      />
                      <button
                        type="button"
                        disabled={!sessionDid}
                        onClick={() => {
                          const text = (replyDrafts[post.uri] ?? "").trim();
                          if (!text) return;
                          void runEngagement("reply", post, text).catch((err: unknown) => {
                            setStatusMessage(err instanceof Error ? err.message : "Reply failed");
                          });
                        }}
                        className="rounded border px-2 py-1 text-xs disabled:opacity-50"
                      >
                        Reply
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
