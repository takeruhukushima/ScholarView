import { useState, useCallback } from "react";
import { DiscussionRoot, DiscussionPost } from "@/lib/workspace/types";

interface UseWorkspaceDiscussionProps {
  sessionDid: string | null;
  currentDid: string | null;
  currentRkey: string | null;
  setBusy: (busy: boolean) => void;
  setStatusMessage: (msg: string) => void;
  setTab: (tab: "preview" | "discussion") => void;
}

export function useWorkspaceDiscussion({
  sessionDid,
  currentDid,
  currentRkey,
  setBusy,
  setStatusMessage,
  setTab,
}: UseWorkspaceDiscussionProps) {
  const [discussionRoot, setDiscussionRoot] = useState<DiscussionRoot | null>(null);
  const [discussionPosts, setDiscussionPosts] = useState<DiscussionPost[]>([]);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [selectedQuote, setSelectedQuote] = useState("");
  const [quoteComment, setQuoteComment] = useState("");

  const loadDiscussion = useCallback(async () => {
    if (!currentDid || !currentRkey) {
      setDiscussionRoot(null);
      setDiscussionPosts([]);
      return;
    }

    const query = selectedQuote ? `?quote=${encodeURIComponent(selectedQuote)}` : "";
    const response = await fetch(
      `/api/articles/${encodeURIComponent(currentDid)}/${encodeURIComponent(
        currentRkey
      )}/discussion${query}`,
      { cache: "no-store" }
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
    })) as DiscussionPost[];
    
    setDiscussionPosts(normalizedThread.filter((post) => post.uri));
  }, [currentDid, currentRkey, selectedQuote]);

  const submitInlineComment = useCallback(async () => {
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
        `/api/articles/${encodeURIComponent(currentDid)}/${encodeURIComponent(
          currentRkey
        )}/comments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quote: selectedQuote, text: quoteComment }),
        }
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
  }, [
    sessionDid,
    currentDid,
    currentRkey,
    selectedQuote,
    quoteComment,
    loadDiscussion,
    setBusy,
    setStatusMessage,
    setTab,
  ]);

  const runEngagement = useCallback(
    async (action: "like" | "repost" | "reply", post: DiscussionPost, text?: string) => {
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
    },
    [sessionDid, loadDiscussion, setStatusMessage]
  );

  const captureWindowSelection = useCallback(() => {
    const selection = window.getSelection();
    if (!selection) return;
    const quote = selection.toString().trim();
    if (!quote) return;
    setSelectedQuote(quote.slice(0, 280));
  }, []);

  return {
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
    captureWindowSelection,
  };
}
