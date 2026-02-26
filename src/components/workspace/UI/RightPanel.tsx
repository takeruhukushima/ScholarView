import React from "react";
import { 
  WorkspaceFile, 
  DiscussionRoot, 
  DiscussionPost
} from "@/lib/workspace/types";
import { 
  timeAgo 
} from "@/lib/workspace/utils";

interface RightPanelProps {
  selectedQuote: string;
  quoteComment: string;
  setQuoteComment: (val: string) => void;
  submitInlineComment: () => Promise<void>;
  discussionRoot: DiscussionRoot | null;
  discussionPosts: DiscussionPost[];
  replyDrafts: Record<string, string>;
  setReplyDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  runEngagement: (action: "like" | "repost" | "reply", post: DiscussionPost, text?: string) => Promise<void>;
  sessionDid: string | null;
  busy: boolean;
  setStatusMessage: (msg: string) => void;
}

export const RightPanel: React.FC<RightPanelProps> = ({
  selectedQuote,
  quoteComment,
  setQuoteComment,
  submitInlineComment,
  discussionRoot,
  discussionPosts,
  replyDrafts,
  setReplyDrafts,
  runEngagement,
  sessionDid,
  busy,
  setStatusMessage,
}) => {
  return (
    <aside data-tour-id="right-panel" className="sticky top-6 flex h-[calc(100vh-5rem)] flex-col min-w-0 rounded-xl border border-slate-200/60 bg-white/80 p-4 shadow-sm backdrop-blur-md overflow-hidden">
      <div className="flex items-center justify-between mb-4 px-1 shrink-0 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 1 1-7.6-10.6 8.38 8.38 0 0 1 3.8.9L21 3z"/></svg>
          </div>
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
            Peer Debate
          </h2>
        </div>
        <div className="flex items-center gap-1">
          <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">Live Network</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-200">
        <div className="space-y-6">
          {selectedQuote ? (
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/30 p-4 space-y-3 shadow-sm text-left">
              <div className="flex items-center gap-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-600">Selected Argument</p>
              </div>
              <p className="text-[13px] italic leading-relaxed text-slate-700 bg-white/80 p-3 rounded-lg border border-indigo-50/50">
                &quot;{selectedQuote}&quot;
              </p>
              <div className="space-y-2">
                <textarea
                  value={quoteComment}
                  onChange={(e) => setQuoteComment(e.target.value)}
                  placeholder="Contribute to the open review..."
                  rows={3}
                  className="w-full rounded-lg border border-slate-200 bg-white p-3 text-sm focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all placeholder:text-slate-400"
                />
                <button
                  type="button"
                  disabled={!sessionDid || busy || !quoteComment.trim()}
                  onClick={() => {
                    void submitInlineComment().catch((err: unknown) => {
                      setStatusMessage(err instanceof Error ? err.message : "Failed to post comment");
                    });
                  }}
                  className="w-full rounded-lg bg-indigo-600 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-200 hover:bg-indigo-700 active:scale-[0.98] transition-all disabled:opacity-50"
                >
                  Post Peer Comment
                </button>
              </div>
            </div>
          ) : null}

          <div className="space-y-4 text-left">
            <p className="px-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">Engagement Thread</p>
            {discussionRoot ? (
              <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 space-y-2 border-l-4 border-l-indigo-500">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Root Thesis</p>
                <p className="break-words text-sm font-medium text-slate-800 leading-relaxed">{discussionRoot.text}</p>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 p-8 flex flex-col items-center justify-center text-center">
                <div className="text-slate-300 mb-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 1 1-7.6-10.6 8.38 8.38 0 0 1 3.8.9L21 3z"/></svg>
                </div>
                <p className="text-xs text-slate-400 italic">No community debate started yet.</p>
              </div>
            )}

            <ul className="space-y-4">
              {discussionPosts.map((post) => (
                <li
                  key={post.uri}
                  className={`group rounded-xl border border-slate-100 bg-white p-4 shadow-sm transition-all hover:shadow-md ${post.quoted ? "border-l-4 border-l-amber-400" : ""}`}
                  style={{ marginLeft: `${Math.min(post.depth, 6) * 8}px` }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[11px] font-bold text-indigo-600">
                      @{post.handle ?? post.authorDid.slice(0, 15)}
                    </p>
                    <p className="text-[10px] text-slate-400">{timeAgo(post.createdAt)}</p>
                  </div>
                  
                  <div className="flex gap-1.5 mb-2">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-bold uppercase text-slate-500">
                      {post.source}
                    </span>
                    {post.quoted && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold uppercase text-amber-600">
                        critique
                      </span>
                    )}
                  </div>

                  {post.quote && (
                    <div className="mb-3 border-l-2 border-amber-200 bg-amber-50/30 p-2 text-[12px] italic text-slate-600 rounded-r-lg">
                      &quot;{post.quote}&quot;
                    </div>
                  )}
                  
                  <p className="text-sm text-slate-700 leading-relaxed break-words">{post.text}</p>
                  
                  <div className="mt-4 flex flex-wrap items-center gap-3 pt-3 border-t border-slate-50">
                    <button
                      type="button"
                      disabled={!sessionDid}
                      onClick={() => {
                        void runEngagement("like", post).catch((err: unknown) => {
                          setStatusMessage(err instanceof Error ? err.message : "Like failed");
                        });
                      }}
                      className={`flex items-center gap-1 text-[10px] font-bold transition-colors ${
                        post.liked ? "text-pink-500" : "text-slate-400 hover:text-slate-600"
                      }`}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill={post.liked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                      {post.liked ? "Empathesized" : "Empathesize"}
                    </button>
                    <button
                      type="button"
                      disabled={!sessionDid}
                      onClick={() => {
                        void runEngagement("repost", post).catch((err: unknown) => {
                          setStatusMessage(err instanceof Error ? err.message : "Repost failed");
                        });
                      }}
                      className={`flex items-center gap-1 text-[10px] font-bold transition-colors ${
                        post.reposted ? "text-emerald-500" : "text-slate-400 hover:text-slate-600"
                      }`}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
                      {post.reposted ? "Amplified" : "Amplify"}
                    </button>
                  </div>
                  
                  {sessionDid && (
                    <div className="mt-3 flex gap-2">
                      <input
                        value={replyDrafts[post.uri] ?? ""}
                        onChange={(e) =>
                          setReplyDrafts((prev) => ({
                            ...prev,
                            [post.uri]: e.target.value,
                          }))
                        }
                        placeholder="Respond to this argument..."
                        className="flex-1 rounded-lg border border-slate-100 bg-slate-50 px-3 py-1.5 text-[11px] outline-none focus:border-indigo-300 transition-all"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const text = (replyDrafts[post.uri] ?? "").trim();
                          if (!text) return;
                          void runEngagement("reply", post, text).catch((err: unknown) => {
                            setStatusMessage(err instanceof Error ? err.message : "Reply failed");
                          });
                        }}
                        className="rounded-lg bg-slate-800 px-3 py-1 text-[10px] font-bold text-white hover:bg-black active:scale-[0.95] transition-all"
                      >
                        Reply
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </aside>
  );
};
