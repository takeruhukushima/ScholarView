interface ReferenceSyncNoticeModalProps {
  fileName: string;
  onClose: () => void;
}

export function ReferenceSyncNoticeModal({ fileName, onClose }: ReferenceSyncNoticeModalProps) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="reference-sync-title" className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="border-b border-indigo-100 bg-indigo-50 px-6 py-5">
          <h3 id="reference-sync-title" className="font-bold text-indigo-950">このファイルはまだローカルです</h3>
        </div>
        <div className="space-y-3 px-6 py-5 text-sm text-slate-700">
          <p>「{fileName}」は、articleを次回Broadcastまたは更新したときにAT Protocolへ反映されます。</p>
          <p className="text-xs text-slate-500">
            文献はpub.paper.referenceとして保存され、別browserでは同じ配置にファイルを再生成します。
          </p>
        </div>
        <div className="flex justify-end border-t border-slate-100 bg-slate-50 px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700">
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
