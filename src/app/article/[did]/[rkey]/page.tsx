"use client";

import Link from "next/link";
import { Suspense, useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";

import { ArticleViewer } from "@/components/ArticleViewer";
import {
  buildScholarViewArticleUrl,
  buildArticleEditPath,
} from "@/lib/articles/uri";
import { initializeAuth, getActiveDid, getActiveHandle } from "@/lib/auth/browser";
import { installClientFetchBridge } from "@/lib/client/fetch-bridge";
import type { 
  ArticleDetail, 
  ArticleSummary, 
  InlineCommentView, 
  WorkspaceFileNode,
  BskyInteractionAction
} from "@/lib/types";
import { 
  DiscussionRoot, 
  DiscussionPost, 
  WorkspaceFile,
  TreeDropPosition
} from "@/lib/workspace/types";

import { Sidebar } from "@/components/workspace/UI/Sidebar";
import { RightPanel } from "@/components/workspace/UI/RightPanel";
import { MobileNavBar } from "@/components/workspace/UI/MobileNavBar";

interface DiscussionPayload {
  success?: boolean;
  root?: DiscussionRoot;
  thread?: DiscussionPost[];
}

function ArticlePageClient() {
  const params = useParams<{ did: string; rkey: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const did = params.did ? decodeURIComponent(params.did) : "";
  const rkey = params.rkey ? decodeURIComponent(params.rkey) : "";
  const initialQuote = searchParams.get("quote");

  const [loading, setLoading] = useState(true);
  const [sessionDid, setSessionDid] = useState<string | null>(null);
  const [accountHandle, setAccountHandle] = useState<string | null>(null);
  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  
  const [discussionRoot, setDiscussionRoot] = useState<DiscussionRoot | null>(null);
  const [discussionPosts, setDiscussionPosts] = useState<DiscussionPost[]>([]);
  const [selectedQuote, setSelectedQuote] = useState("");
  const [quoteComment, setQuoteComment] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  
  const [statusMessage, setStatusMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"files" | "editor" | "discussion">("editor");

  useEffect(() => {
    installClientFetchBridge();
  }, []);

  const loadFiles = useCallback(async (targetDid: string | null, _setBusy?: (b: boolean) => void, _setStatusMessage?: (m: string) => void) => {
    try {
      const res = await fetch("/api/workspace/files", { cache: "no-store" });
      const data = (await res.json()) as { success?: boolean; files?: WorkspaceFileNode[] };
      if (res.ok && data.success && data.files) {
        const mappedFiles: WorkspaceFile[] = data.files.map(f => ({
          id: f.id,
          parentId: f.parentId,
          name: f.name,
          kind: f.kind,
          sourceFormat: f.sourceFormat,
          content: f.content,
          linkedArticleDid: f.linkedArticleDid,
          linkedArticleRkey: f.linkedArticleRkey,
          linkedArticleUri: f.linkedArticleUri,
          expanded: f.expanded,
          sortOrder: f.sortOrder
        }));
        setFiles(mappedFiles);
        return mappedFiles;
      }
      return [];
    } catch (err) {
      console.error("Failed to load files:", err);
      return [];
    }
  }, []);

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

  const loadDiscussion = useCallback(async () => {
    if (!did || !rkey) return;
    try {
      const res = await fetch(
        `/api/articles/${encodeURIComponent(did)}/${encodeURIComponent(
          rkey,
        )}/discussion${selectedQuote ? `?quote=${encodeURIComponent(selectedQuote)}` : ""}`,
        { cache: "no-store" },
      );
      const data = (await res.json()) as DiscussionPayload;
      if (res.ok && data.success) {
        setDiscussionRoot(data.root ?? null);
        setDiscussionPosts(data.thread ?? []);
      }
    } catch (err) {
      console.error("Failed to load discussion:", err);
    }
  }, [did, rkey, selectedQuote]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      installClientFetchBridge();

      if (!did || !rkey) {
        setError("Missing article parameters");
        setLoading(false);
        return;
      }

      try {
        const auth = await initializeAuth();
        if (cancelled) return;
        setSessionDid(auth.did);
        setAccountHandle(await getActiveHandle());

        if (auth.did) {
          void loadFiles(auth.did);
        }

        void refreshArticles();

        const articleRes = await fetch(`/api/articles/${encodeURIComponent(did)}/${encodeURIComponent(rkey)}`, {
          cache: "no-store",
        });

        const articleData = (await articleRes.json()) as {
          success?: boolean;
          article?: ArticleDetail;
          error?: string;
        };

        if (!articleRes.ok || !articleData.success || !articleData.article) {
          throw new Error(articleData.error ?? "Article not found");
        }

        if (!cancelled) {
          setArticle(articleData.article);
          void loadDiscussion();
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load article");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [did, rkey, loadFiles, refreshArticles, loadDiscussion]);

  const submitInlineComment = async () => {
    if (!selectedQuote || !quoteComment.trim() || !article) return;
    setBusy(true);
    setStatusMessage("Posting comment...");
    try {
      const res = await fetch(
        `/api/articles/${encodeURIComponent(article.did)}/${encodeURIComponent(
          article.rkey,
        )}/comments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: quoteComment,
            quote: selectedQuote,
          }),
        },
      );
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        throw new Error(data.error ?? "Failed to post comment");
      }
      setQuoteComment("");
      setSelectedQuote("");
      setStatusMessage("Comment posted!");
      void loadDiscussion();
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "Failed to post comment");
    } finally {
      setBusy(false);
    }
  };

  const runEngagement = async (
    action: BskyInteractionAction,
    post: DiscussionPost,
    text?: string,
  ) => {
    if (!sessionDid) return;
    setBusy(true);
    setStatusMessage(`${action === "like" ? "Liking" : action === "repost" ? "Reposting" : "Replying"}...`);
    try {
      const res = await fetch("/api/engagement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          uri: post.uri,
          cid: post.cid,
          text,
        }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        throw new Error(data.error ?? `Failed to ${action}`);
      }
      if (action === "reply") {
        setReplyDrafts(prev => {
          const next = { ...prev };
          delete next[post.uri];
          return next;
        });
      }
      setStatusMessage("Success!");
      void loadDiscussion();
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : `Failed to ${action}`);
    } finally {
      setBusy(false);
    }
  };

  const syncLegacyArticles = useCallback(
    async (options?: { force?: boolean }) => {
      if (!sessionDid) return 0;
      setBusy(true);
      setStatusMessage("Syncing with AT Protocol...");
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
          throw new Error(data.error ?? "Failed to sync articles");
        }
        const created = data.created ?? 0;
        await loadFiles(sessionDid);
        await refreshArticles();
        setStatusMessage(
          created > 0
            ? `Linked ${created} article(s) to the file tree`
            : "Articles synchronized",
        );
        return created;
      } catch (err: unknown) {
        setStatusMessage(err instanceof Error ? err.message : "Failed to sync articles");
        return 0;
      } finally {
        setBusy(false);
      }
    },
    [loadFiles, refreshArticles, sessionDid],
  );

  const openArticle = async (a: ArticleSummary) => {
    router.push(`/article/${encodeURIComponent(a.did)}/${encodeURIComponent(a.rkey)}`);
  };

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div className="text-sm font-medium text-zinc-600 animate-pulse">Loading article...</div>
      </div>
    );
  }

  if (!article || error) {
    return (
      <div className="flex min-h-screen w-full flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-4">
        <div className="w-full max-w-md rounded-2xl border border-red-200 bg-red-50 p-6 text-center shadow-sm">
          <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </div>
          <h2 className="mb-2 text-lg font-bold text-red-900">Error</h2>
          <p className="text-sm text-red-700">{error ?? "Article not found"}</p>
          <Link href="/" className="mt-6 inline-flex rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 transition-colors">
            Back to workspace
          </Link>
        </div>
      </div>
    );
  }

  const canEdit = sessionDid === article.authorDid;
  const canComment = Boolean(sessionDid && article.announcementUri);
  const canonicalUrl = buildScholarViewArticleUrl(article.did, article.rkey);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_right,_#E9F4FF_0%,_#F8FAFC_45%)] p-4 md:p-6 pb-20 lg:pb-6">
      {statusMessage && (
        <p className="mb-3 rounded-md border bg-white px-3 py-2 text-sm text-slate-600 shadow-sm animate-in fade-in slide-in-from-top-2">
          {statusMessage}
        </p>
      )}

      <div className="grid min-h-[calc(100vh-4rem)] grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)_360px] items-start">
        {/* Left Sidebar */}
        <div className={`${mobileView === "files" ? "block" : "hidden"} lg:block lg:sticky lg:top-6 lg:h-[calc(100vh-5rem)]`}>
          <Sidebar
            articles={articles}
            activeArticleUri={article.uri}
            openArticle={openArticle}
            syncLegacyArticles={syncLegacyArticles}
            onRefreshArticle={(article) => {
              void syncLegacyArticles({ force: true });
            }}
            files={files}
            activeFileId={null}
            openFile={async () => {}}
            renameWorkspaceItem={async () => {}}
            deleteWorkspaceItem={async () => {}}
            downloadWorkspaceItem={async () => {}}
            handleMoveWorkspaceItem={async () => {}}
            createWorkspaceItem={async () => {}}
            isLoggedIn={Boolean(sessionDid)}
            accountHandle={accountHandle}
            loadFiles={loadFiles}
            sessionDid={sessionDid}
            setBusy={setBusy}
            setStatusMessage={setStatusMessage}
          />
        </div>

        {/* Main Content */}
        <div className={`${mobileView === "editor" ? "block" : "hidden"} lg:block`}>
          <div className="rounded-xl border border-slate-200/60 bg-white p-6 shadow-sm min-h-[calc(100vh-5rem)] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-200">
            <div className="max-w-4xl mx-auto">
              <div className="mb-6 rounded-lg border border-slate-100 bg-slate-50/50 p-4 text-[11px] font-medium text-slate-500">
                <p>
                  Canonical:{" "}
                  <a
                    href={canonicalUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="break-all font-bold text-indigo-600 hover:underline"
                  >
                    {canonicalUrl}
                  </a>
                </p>
              </div>

              <ArticleViewer
                did={article.did}
                rkey={article.rkey}
                title={article.title}
                authors={article.authors}
                blocks={article.blocks}
                bibliography={article.bibliography}
                comments={[]} // Handled by RightPanel
                canComment={canComment}
                canEdit={canEdit}
                editHref={buildArticleEditPath(article.did, article.rkey)}
                initialHighlightQuote={initialQuote}
                onQuoteSelect={(q) => setSelectedQuote(q)}
                showComments={false}
                onRefresh={async () => {
                  await syncLegacyArticles({ force: true });
                  router.refresh();
                }}
              />
            </div>
          </div>
        </div>

        {/* Right Panel (Discussion) */}
        <div className={`${mobileView === "discussion" ? "block" : "hidden"} lg:block lg:sticky lg:top-6 lg:h-[calc(100vh-5rem)]`}>
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

export default function ArticlePage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen w-full items-center justify-center bg-zinc-50 dark:bg-zinc-950">
          <div className="text-sm font-medium text-zinc-600 animate-pulse">Loading article...</div>
        </div>
      }
    >
      <ArticlePageClient />
    </Suspense>
  );
}
