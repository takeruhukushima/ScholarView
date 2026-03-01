import React from "react";

interface MobileNavBarProps {
  mobileView: "files" | "editor" | "discussion";
  setMobileView: (view: "files" | "editor" | "discussion") => void;
}

export function MobileNavBar({ mobileView, setMobileView }: MobileNavBarProps) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t border-slate-200 bg-white/90 p-2 pb-6 backdrop-blur-lg lg:hidden">
      <button
        onClick={() => setMobileView("files")}
        className={`flex flex-col items-center gap-1 rounded-lg px-4 py-1 transition-colors ${
          mobileView === "files" ? "text-indigo-600" : "text-slate-400"
        }`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
        <span className="text-[10px] font-bold uppercase tracking-wider">
          Files
        </span>
      </button>
      <button
        onClick={() => setMobileView("editor")}
        className={`flex flex-col items-center gap-1 rounded-lg px-4 py-1 transition-colors ${
          mobileView === "editor" ? "text-indigo-600" : "text-slate-400"
        }`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <path d="M12 19l7-7 3 3-7 7-3-3z" />
          <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
          <path d="M2 2l7.5 1.5" />
        </svg>
        <span className="text-[10px] font-bold uppercase tracking-wider">
          Editor
        </span>
      </button>
      <button
        onClick={() => setMobileView("discussion")}
        className={`flex flex-col items-center gap-1 rounded-lg px-4 py-1 transition-colors ${
          mobileView === "discussion" ? "text-indigo-600" : "text-slate-400"
        }`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 1 1-7.6-10.6 8.38 8.38 0 0 1 3.8.9L21 3z" />
        </svg>
        <span className="text-[10px] font-bold uppercase tracking-wider">
          Debate
        </span>
      </button>
    </nav>
  );
}
