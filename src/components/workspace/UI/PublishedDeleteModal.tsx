import { useState } from "react";

interface PublishedDeleteModalProps {
  name: string;
  articleCount: number;
  busy: boolean;
  error?: string | null;
  onConfirm: (deleteAnnouncement: boolean) => void;
  onCancel: () => void;
}

export function PublishedDeleteModal({
  name,
  articleCount,
  busy,
  error,
  onConfirm,
  onCancel,
}: PublishedDeleteModalProps) {
  const [deleteAnnouncement, setDeleteAnnouncement] = useState(true);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="published-delete-title" className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="border-b border-red-100 bg-red-50 px-6 py-5">
          <h3 id="published-delete-title" className="text-base font-bold text-red-900">
            公開済みプロジェクトを完全に削除
          </h3>
          <p className="mt-1 text-xs font-medium text-red-700">この操作は取り消せません。</p>
        </div>
        <div className="space-y-4 px-6 py-5 text-sm text-slate-700">
          <p>「{name}」には公開済みの記事が{articleCount}件含まれています。</p>
          <div className="rounded-xl border border-red-100 bg-red-50/60 p-4">
            <p className="mb-2 font-bold text-red-900">次のデータをAT Protocolから削除します</p>
            <ul className="list-disc space-y-1 pl-5 text-xs text-red-800">
              <li>公開記事（sci.peer.article）</li>
              <li>paper project、collection、不要になったreference records</li>
              <li>この端末のworkspace file</li>
            </ul>
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-4">
            <input
              type="checkbox"
              checked={deleteAnnouncement}
              onChange={(event) => setDeleteAnnouncement(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-red-600"
            />
            <span>
              <span className="block font-bold text-slate-800">Blueskyの告知postも削除する</span>
              <span className="mt-1 block text-xs text-slate-500">
                オフにすると、告知postと既存discussionはBlueskyに残ります。
              </span>
            </span>
          </label>
          {error ? (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800">
              削除できませんでした：{error}
            </p>
          ) : null}
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-100 bg-slate-50 px-6 py-4">
          <button type="button" disabled={busy} onClick={onCancel} className="px-4 py-2 text-sm font-bold text-slate-600 disabled:opacity-50">
            Cancel
          </button>
          <button type="button" disabled={busy} onClick={() => onConfirm(deleteAnnouncement)} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-red-200 hover:bg-red-700 disabled:opacity-50">
            {busy ? "Deleting…" : "完全に削除する"}
          </button>
        </div>
      </div>
    </div>
  );
}
