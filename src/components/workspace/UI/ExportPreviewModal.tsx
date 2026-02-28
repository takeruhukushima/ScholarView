import React from "react";
import { ExportPreview } from "../hooks/useWorkspacePublishing";

interface ExportPreviewModalProps {
  exportPreview: ExportPreview;
  confirmExport: () => void;
  cancelExport: () => void;
  toggleIncludeBibInExport: () => void;
}

export const ExportPreviewModal: React.FC<ExportPreviewModalProps> = ({
  exportPreview,
  confirmExport,
  cancelExport,
  toggleIncludeBibInExport,
}) => {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh] overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-200 text-left">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <h3 className="font-bold text-slate-800 flex items-center gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4 text-indigo-500"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export Preview
          </h3>
          <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
            {exportPreview.filename}
          </span>
        </div>

        <div className="flex-1 overflow-auto p-6 bg-slate-50/30">
          <div className="text-[12px] font-mono leading-relaxed text-slate-700 whitespace-pre-wrap">
            {exportPreview.content}
            {exportPreview.includeBib && exportPreview.bibSource && (
              <div className="mt-4 pt-4 border-t border-slate-200 border-dashed">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block opacity-60">
                  Included BibTeX entries
                </span>
                {exportPreview.bibSource}
              </div>
            )}
          </div>
        </div>

        <div className="p-4 border-t border-slate-100 space-y-4">
          {exportPreview.bibSource && (
            <label className="flex items-center gap-2 px-2 cursor-pointer group">
              <div
                className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                  exportPreview.includeBib
                    ? "bg-indigo-600 border-indigo-600"
                    : "border-slate-300 group-hover:border-indigo-400"
                }`}
              >
                {exportPreview.includeBib && (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-3 w-3 text-white"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="4"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
              <input
                type="checkbox"
                checked={exportPreview.includeBib}
                onChange={toggleIncludeBibInExport}
                className="hidden"
              />
              <span className="text-xs font-medium text-slate-600 select-none">
                Include all BibTeX entries from directory
              </span>
            </label>
          )}

          <div className="flex items-center justify-end gap-3">
            <button
              onClick={cancelExport}
              className="px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-50 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={confirmExport}
              className="px-6 py-2 text-xs font-black uppercase tracking-widest bg-indigo-600 text-white rounded-lg shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all active:scale-95"
            >
              Download
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
