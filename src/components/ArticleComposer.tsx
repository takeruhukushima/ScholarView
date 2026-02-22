"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { parseMarkdownToBlocks, parseTexToBlocks } from "@/lib/articles/blocks";
import { buildPaperPath } from "@/lib/articles/uri";
import type { SourceFormat } from "@/lib/types";

const MAX_TITLE_LENGTH = 300;

interface CreateArticleResponse {
  success: boolean;
  did: string;
  rkey: string;
}

interface DraftArticle {
  id: string;
  title: string;
  content: string;
  sourceFormat: SourceFormat;
  createdAt: string;
  updatedAt: string;
}

interface ArticleComposerProps {
  mode?: "create" | "edit";
  did?: string;
  rkey?: string;
  initialTitle?: string;
  initialContent?: string;
  initialSourceFormat?: SourceFormat;
  onSubmitted?: () => void;
}

function formatDraftLabel(draft: DraftArticle): string {
  const date = new Date(draft.updatedAt).toLocaleString();
  return `${draft.title} (${draft.sourceFormat}, ${date})`;
}

export function ArticleComposer({
  mode = "create",
  did,
  rkey,
  initialTitle = "",
  initialContent = "",
  initialSourceFormat = "markdown",
  onSubmitted,
}: ArticleComposerProps) {
  const router = useRouter();

  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [sourceFormat, setSourceFormat] = useState<SourceFormat>(initialSourceFormat);
  const [broadcastToBsky, setBroadcastToBsky] = useState(false);

  const [loading, setLoading] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [drafts, setDrafts] = useState<DraftArticle[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string>("");

  const previewBlocks = useMemo(
    () =>
      sourceFormat === "tex"
        ? parseTexToBlocks(content)
        : parseMarkdownToBlocks(content),
    [content, sourceFormat],
  );

  const loadDrafts = useCallback(async () => {
    if (mode !== "create") return;
    try {
      const response = await fetch("/api/drafts", { cache: "no-store" });
      const data = (await response.json()) as {
        success?: boolean;
        drafts?: DraftArticle[];
      };
      if (response.ok && data.success && data.drafts) {
        setDrafts(data.drafts);
      }
    } catch {
      // noop
    }
  }, [mode]);

  useEffect(() => {
    void loadDrafts();
  }, [loadDrafts]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const endpoint =
        mode === "edit" && did && rkey
          ? `/api/articles/${encodeURIComponent(did)}/${encodeURIComponent(rkey)}`
          : "/api/articles";

      const method = mode === "edit" ? "PUT" : "POST";
      const payload = {
        title,
        sourceFormat,
        broadcastToBsky,
        ...(sourceFormat === "tex" ? { tex: content } : { markdown: content }),
      };

      const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as
        | CreateArticleResponse
        | { success?: boolean; error?: string };

      if (!response.ok || !("success" in data) || !data.success) {
        throw new Error("error" in data && data.error ? data.error : "Failed");
      }

      if (mode === "edit") {
        onSubmitted?.();
        if (did && rkey) {
          router.push(buildPaperPath(did, rkey));
        }
        router.refresh();
        return;
      }

      setTitle("");
      setContent("");
      setBroadcastToBsky(false);

      if ("did" in data && "rkey" in data) {
        router.push(buildPaperPath(data.did, data.rkey));
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveDraft() {
    if (mode !== "create") return;
    setSavingDraft(true);
    setError(null);

    try {
      const response = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedDraftId || undefined,
          title,
          content,
          sourceFormat,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        draftId?: string;
      };

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to save draft");
      }

      if (data.draftId) {
        setSelectedDraftId(data.draftId);
      }
      await loadDrafts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save draft");
    } finally {
      setSavingDraft(false);
    }
  }

  function handleLoadDraft() {
    const draft = drafts.find((d) => d.id === selectedDraftId);
    if (!draft) return;

    setTitle(draft.title);
    setContent(draft.content);
    setSourceFormat(draft.sourceFormat);
  }

  async function handleDeleteDraft() {
    if (!selectedDraftId) return;

    try {
      const response = await fetch(
        `/api/drafts/${encodeURIComponent(selectedDraftId)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        throw new Error("Failed to delete draft");
      }

      setSelectedDraftId("");
      await loadDrafts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete draft");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {mode === "create" ? (
        <div className="space-y-2 rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Drafts
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedDraftId}
              onChange={(e) => setSelectedDraftId(e.target.value)}
              className="min-w-64 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
            >
              <option value="">Select draft</option>
              {drafts.map((draft) => (
                <option key={draft.id} value={draft.id}>
                  {formatDraftLabel(draft)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleLoadDraft}
              disabled={!selectedDraftId}
              className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm disabled:opacity-50"
            >
              Load
            </button>
            <button
              type="button"
              onClick={handleDeleteDraft}
              disabled={!selectedDraftId}
              className="rounded-lg border border-red-300 px-3 py-2 text-sm text-red-700 disabled:opacity-50"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={savingDraft || !title.trim() || !content.trim()}
              className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm disabled:opacity-50"
            >
              {savingDraft ? "Saving..." : "Save Draft"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="space-y-1">
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Title
        </label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={MAX_TITLE_LENGTH}
          placeholder="実験計画・論文タイトル"
          className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
          disabled={loading}
        />
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {title.length}/{MAX_TITLE_LENGTH}
        </p>
      </div>

      <div className="space-y-1">
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Source Format
        </label>
        <select
          value={sourceFormat}
          onChange={(e) => setSourceFormat(e.target.value as SourceFormat)}
          className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
          disabled={loading}
        >
          <option value="markdown">Markdown</option>
          <option value="tex">TeX</option>
        </select>
      </div>

      {mode === "create" ? (
        <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={broadcastToBsky}
            onChange={(e) => setBroadcastToBsky(e.target.checked)}
          />
          Blueskyに告知を投稿する
        </label>
      ) : null}

      <div className="space-y-1">
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {sourceFormat === "tex" ? "TeX" : "Markdown"}
        </label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={12}
          placeholder={
            sourceFormat === "tex"
              ? "\\section{概要}"
              : "# 実験概要\n\n## 手法\n..."
          }
          className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-mono"
          disabled={loading}
        />
      </div>

      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Preview Blocks
        </p>

        {previewBlocks.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            テキストを入力すると、投稿ブロックをプレビューできます。
          </p>
        ) : (
          <div className="space-y-3">
            {previewBlocks.map((block, idx) => (
              <div key={`${block.heading}-${idx}`} className="space-y-1">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {"#".repeat(block.level)} {block.heading}
                </p>
                <p className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
                  {block.content || "(empty)"}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={loading || !title.trim() || !content.trim()}
        className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading
          ? mode === "edit"
            ? "Updating..."
            : "Publishing..."
          : mode === "edit"
            ? "Update Article"
            : "Publish Article"}
      </button>
    </form>
  );
}
