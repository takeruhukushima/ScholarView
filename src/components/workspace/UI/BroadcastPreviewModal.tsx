import React, { useState } from "react";

interface BroadcastPreviewModalProps {
  defaultText: string;
  defaultPostToBluesky?: boolean;
  isUpdate?: boolean;
  onConfirm: (text: string, postToBluesky: boolean) => void;
  onCancel: () => void;
}

export const BroadcastPreviewModal: React.FC<BroadcastPreviewModalProps> = ({
  defaultText,
  defaultPostToBluesky = true,
  isUpdate = false,
  onConfirm,
  onCancel,
}) => {
  const [text, setText] = useState(defaultText);
  const [postToBluesky, setPostToBluesky] = useState(defaultPostToBluesky);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div>
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-indigo-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
              {isUpdate ? "Update Broadcast" : "Broadcast to AT Protocol"}
            </h3>
            <p className="text-xs text-slate-500 mt-1 font-medium">
              Release the article and paper project to the AT Protocol Firehose.
            </p>
          </div>
          <button onClick={onCancel} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        
        <div className="p-6">
          <div className="mb-6 flex items-center gap-3 p-3 bg-indigo-50 border border-indigo-100 rounded-xl">
              <div className="flex flex-col gap-1">
                <label className="flex items-center gap-2 cursor-pointer group">
                  <div className="relative flex items-center">
                    <input
                      type="checkbox"
                      checked={postToBluesky}
                      onChange={(e) => setPostToBluesky(e.target.checked)}
                      className="peer h-5 w-5 cursor-pointer appearance-none rounded-md border border-slate-300 transition-all checked:border-indigo-600 checked:bg-indigo-600"
                    />
                    <svg xmlns="http://www.w3.org/2000/svg" className="absolute h-3.5 w-3.5 text-white opacity-0 transition-opacity peer-checked:opacity-100 left-0.5 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <span className="text-sm font-bold text-indigo-900 group-hover:text-indigo-700 transition-colors">
                    Also post an announcement to Bluesky
                  </span>
                </label>
                <p className="text-[10px] text-indigo-600/70 ml-7 leading-tight font-medium">
                  Optional. Broadcast to the AT Protocol works even when this is unchecked.
                </p>
              </div>
            </div>

          <div className={`${!postToBluesky ? "opacity-40 pointer-events-none grayscale-[0.5]" : ""} transition-all duration-300`}>
            <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">
              Bluesky Post Content
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={!postToBluesky}
              className="w-full h-32 p-3 text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500/50 resize-none transition-all"
              placeholder="What's happening?"
            />
            {text.includes("{{article_url}}") && (
              <div className="mt-3 flex items-center gap-2 text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg border border-amber-100">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                <span>The <code className="bg-amber-100/50 px-1 rounded font-bold text-[10px]">{"{{article_url}}"}</code> placeholder will be replaced with the link.</span>
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-bold text-slate-600 hover:text-slate-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(text, postToBluesky)}
            disabled={postToBluesky && !text.trim()}
            className="px-5 py-2 text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 active:scale-95 transition-all shadow-lg shadow-indigo-200 disabled:opacity-50 disabled:active:scale-100 flex items-center gap-2"
          >
            <span>{isUpdate ? "Confirm Update" : "Confirm Broadcast"}</span>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
      </div>
    </div>
  );
};
