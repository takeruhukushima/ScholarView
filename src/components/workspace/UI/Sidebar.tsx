import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { WorkspaceFile, TreeDropPosition } from "@/lib/workspace/types";
import { ArticleSummary } from "@/lib/types";
import { buildArticlePath, extractDidAndRkey } from "@/lib/articles/uri";
import { ArticleList } from "../ArticleList";
import { FileTree } from "../FileTree";
import { LoginForm } from "@/components/LoginForm";
import { LogoutButton } from "@/components/LogoutButton";

interface SidebarProps {
  articles: ArticleSummary[];
  activeArticleUri: string | null;
  openArticle: (article: ArticleSummary) => Promise<void>;
  syncLegacyArticles: (options?: { force?: boolean }) => Promise<number>;
  files: WorkspaceFile[];
  activeFileId: string | null;
  openFile: (file: WorkspaceFile) => Promise<void>;
  renameWorkspaceItem: (file: WorkspaceFile) => Promise<void>;
  deleteWorkspaceItem: (file: WorkspaceFile) => Promise<void>;
  downloadWorkspaceItem: (file: WorkspaceFile) => Promise<void>;
  handleMoveWorkspaceItem: (draggedId: string, target: WorkspaceFile, position: TreeDropPosition) => Promise<void>;
  createWorkspaceItem: (kind: "folder" | "file") => Promise<void>;
  isLoggedIn: boolean;
  accountHandle?: string | null;
  loadFiles: (did: string | null, setBusy: (b: boolean) => void, setStatusMessage: (m: string) => void) => Promise<WorkspaceFile[]>;
  sessionDid: string | null;
  setBusy: (busy: boolean) => void;
  setStatusMessage: (msg: string) => void;
  onRefreshArticle?: (article: ArticleSummary) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  articles,
  activeArticleUri,
  openArticle,
  syncLegacyArticles,
  files,
  activeFileId,
  openFile,
  renameWorkspaceItem,
  deleteWorkspaceItem,
  downloadWorkspaceItem,
  handleMoveWorkspaceItem,
  createWorkspaceItem,
  isLoggedIn,
  accountHandle,
  loadFiles,
  sessionDid,
  setBusy,
  setStatusMessage,
  onRefreshArticle,
}) => {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const query = searchQuery.trim();
    if (!query) return;

    const directTarget = extractDidAndRkey(query);
    if (directTarget) {
      router.push(buildArticlePath(directTarget.did, directTarget.rkey));
    } else {
      router.push(`/articles?q=${encodeURIComponent(query)}`);
    }
    setSearchQuery("");
  };

  return (
    <div className="flex flex-col gap-6 overflow-hidden rounded-xl border border-slate-200/60 bg-white/80 p-4 shadow-sm backdrop-blur-md h-full">
      {/* Brand/Logo */}
      <div className="flex items-center gap-3 px-1">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-200">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-6 w-6"
          >
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
          </svg>
        </div>
        <div className="text-left">
          <h1 className="text-lg font-bold tracking-tight text-slate-900">ScholarView</h1>
          <p className="text-[10px] font-medium uppercase tracking-widest text-slate-400">
            DeSci Review Platform
          </p>
        </div>
      </div>

      {/* Search Input */}
      <form onSubmit={handleSearchSubmit} className="px-1">
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search or paste URL..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50/50 py-2 pl-8 pr-3 text-xs outline-none focus:border-indigo-500 focus:bg-white transition-all"
          />
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
      </form>

      {/* Workspace Section (Top) */}
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
        <div className="mb-3 flex items-center justify-between px-1 shrink-0">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Workspace
          </h2>
          <div className="flex gap-1">
            <button
              onClick={() => createWorkspaceItem("folder")}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-indigo-600 transition-colors"
              title="New Folder"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                <line x1="12" y1="11" x2="12" y2="17" />
                <line x1="9" y1="14" x2="15" y2="14" />
              </svg>
            </button>
            <button
              onClick={() => createWorkspaceItem("file")}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-indigo-600 transition-colors"
              title="New File"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="11" x2="12" y2="17" />
                <line x1="9" y1="14" x2="15" y2="14" />
              </svg>
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-200">
          <FileTree
            files={files}
            activeFileId={activeFileId}
            onSelect={openFile}
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
            onRename={renameWorkspaceItem}
            onDelete={deleteWorkspaceItem}
            onDownload={downloadWorkspaceItem}
            onMove={handleMoveWorkspaceItem}
            draggable={true}
          />
        </div>
      </div>

      {/* Published Articles Section (Bottom) */}
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden border-t border-slate-100 pt-6">
        <div className="flex-1 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-200 text-left">
          <ArticleList
            title="Peer Discussions"
            articles={articles}
            activeArticleUri={activeArticleUri}
            onOpen={openArticle}
            actionLabel={isLoggedIn ? "Sync" : undefined}
            onAction={() => {
              void syncLegacyArticles({ force: true });
            }}
            onRefreshArticle={onRefreshArticle}
          />
        </div>
      </div>

      {/* Documentation Section */}
      <div className="border-t border-slate-100 pt-4 px-1">
        <a
          href="https://scholar-view-docs.vercel.app/"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-400 hover:text-indigo-600 transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
          Documentation
        </a>
      </div>

      {/* User Session Footer */}
      {isLoggedIn ? (
        <div className="mt-auto flex items-center justify-between rounded-xl bg-slate-50/80 p-3 border border-slate-100">
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold ring-2 ring-white">
              {accountHandle?.[0]?.toUpperCase() ?? "U"}
            </div>
            <div className="flex flex-col overflow-hidden text-left">
              <span className="truncate text-xs font-bold text-slate-700">
                {accountHandle}
              </span>
              <span className="text-[10px] text-slate-400">Researcher</span>
            </div>
          </div>
          <LogoutButton />
        </div>
      ) : (
        <div className="mt-auto border-t border-slate-100 pt-6">
          <LoginForm />
        </div>
      )}
    </div>
  );
};
