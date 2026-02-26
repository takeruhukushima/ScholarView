import { useCallback } from "react";
import { 
  WorkspaceFile, 
  ArticleDetailPayload, 
  EditorBlock,
  CitationMenuState
} from "@/lib/workspace/types";
import { SourceFormat, ArticleSummary } from "@/lib/types";
import { BibliographyEntry } from "@/lib/articles/citations";
import { inferSourceFormat, sourceToBibEditorBlocks, sourceToEditorBlocks, blocksToSource } from "@/lib/workspace/editor-logic";
import { formatAuthors } from "@/lib/articles/authors";
import { defaultTitleFromFileName } from "@/lib/workspace/file-logic";

interface UseWorkspaceNavigationProps {
  files: WorkspaceFile[];
  sessionDid: string | null;
  articleByUri: Map<string, ArticleSummary>;
  loadFiles: (did: string | null, setBusy: (b: boolean) => void, setStatusMessage: (m: string) => void) => Promise<WorkspaceFile[]>;
  syncLegacyArticles: (options?: { force?: boolean; silent?: boolean }) => Promise<number>;
  setActiveFileId: (id: string | null) => void;
  setActiveArticleUri: (uri: string | null) => void;
  setSourceFormat: (format: SourceFormat) => void;
  setEditorBlocks: (blocks: EditorBlock[]) => void;
  setCurrentDid: (did: string | null) => void;
  setCurrentRkey: (rkey: string | null) => void;
  setCurrentAuthorDid: (did: string | null) => void;
  setTitle: (title: string) => void;
  setAuthorsText: (text: string) => void;
  setBroadcastToBsky: (val: boolean) => void;
  setArticleBibliography: (bib: BibliographyEntry[]) => void;
  setSelectedQuote: (quote: string) => void;
  setQuoteComment: (comment: string) => void;
  setShowMoreMenu: (show: boolean) => void;
  setActiveBlockId: (id: string | null) => void;
  setBlockMenuForId: (id: string | null) => void;
  setCitationMenu: (state: CitationMenuState | null) => void;
  setStatusMessage: (msg: string) => void;
  setBusy: (busy: boolean) => void;
}

export function useWorkspaceNavigation({
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
}: UseWorkspaceNavigationProps) {

  const openFile = useCallback(
    async (file: WorkspaceFile) => {
      setActiveFileId(file.id);
      setActiveArticleUri(file.linkedArticleUri ?? null);

      if (file.kind !== "file") {
        return;
      }

      const format = inferSourceFormat(file.name, file.sourceFormat);
      setSourceFormat(format);
      
      const isImage = file.name.match(/\.(png|jpe?g|gif|webp|svg)$/i);
      if (isImage) {
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
    [articleByUri, sessionDid, setActiveFileId, setActiveArticleUri, setSourceFormat, setEditorBlocks, setCurrentDid, setCurrentRkey, setCurrentAuthorDid, setTitle, setAuthorsText, setBroadcastToBsky, setArticleBibliography, setSelectedQuote, setQuoteComment, setShowMoreMenu, setActiveBlockId, setBlockMenuForId, setCitationMenu, setStatusMessage],
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
    [files, loadFiles, openFile, sessionDid, syncLegacyArticles, setActiveFileId, setActiveArticleUri, setSourceFormat, setEditorBlocks, setCurrentDid, setCurrentRkey, setCurrentAuthorDid, setTitle, setAuthorsText, setBroadcastToBsky, setArticleBibliography, setSelectedQuote, setQuoteComment, setShowMoreMenu, setActiveBlockId, setBlockMenuForId, setCitationMenu, setStatusMessage, setBusy],
  );

  return {
    openFile,
    openArticle,
  };
}
