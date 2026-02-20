"use client";

import { useState } from "react";

interface InlineCommentComposerProps {
  did: string;
  rkey: string;
  quote: string;
  onSubmitted: () => void;
}

export function InlineCommentComposer({
  did,
  rkey,
  quote,
  onSubmitted,
}: InlineCommentComposerProps) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const didParam = encodeURIComponent(did);
      const rkeyParam = encodeURIComponent(rkey);
      const response = await fetch(
        `/api/articles/${didParam}/${rkeyParam}/comments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, quote }),
        },
      );

      const data = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to create comment");
      }

      setText("");
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit comment");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Selected Text
        </p>
        <p className="rounded-md bg-amber-50 px-2 py-1 text-sm text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
          {quote}
        </p>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="この部分へのコメントを入力"
        className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
        disabled={loading}
      />

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={loading || !text.trim()}
        className="inline-flex items-center rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Posting..." : "Post Inline Comment"}
      </button>
    </form>
  );
}
