"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { parseMarkdownToBlocks } from "@/lib/articles/blocks";
import { buildPaperPath } from "@/lib/articles/uri";

const MAX_TITLE_LENGTH = 300;

interface CreateArticleResponse {
  success: boolean;
  did: string;
  rkey: string;
}

export function ArticleComposer() {
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewBlocks = useMemo(() => parseMarkdownToBlocks(markdown), [markdown]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/articles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, markdown }),
      });

      const data = (await response.json()) as
        | CreateArticleResponse
        | { error?: string };

      if (!response.ok || !("success" in data) || !data.success) {
        throw new Error("error" in data && data.error ? data.error : "Failed");
      }

      setTitle("");
      setMarkdown("");

      router.push(buildPaperPath(data.did, data.rkey));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
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
          Markdown
        </label>
        <textarea
          value={markdown}
          onChange={(e) => setMarkdown(e.target.value)}
          rows={10}
          placeholder="# 実験概要\n\n## 手法\n..."
          className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-mono"
          disabled={loading}
        />
      </div>

      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Preview
        </p>

        {previewBlocks.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            見出し付きMarkdownを入力すると、投稿ブロックをプレビューできます。
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
        disabled={loading || !title.trim() || !markdown.trim()}
        className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Publishing..." : "Publish Article"}
      </button>
    </form>
  );
}
