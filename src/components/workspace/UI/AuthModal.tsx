"use client";

import React from "react";
import { LoginForm } from "@/components/LoginForm";

interface AuthModalProps {
  title: string;
  description: string;
  onCancel: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  title,
  description,
  onCancel,
}) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div>
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-indigo-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
              {title}
            </h3>
            <p className="text-xs text-slate-500 mt-1 font-medium">
              {description}
            </p>
          </div>
          <button onClick={onCancel} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        
        <div className="p-6">
          <LoginForm onGuestClick={onCancel} />
        </div>

        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-center">
          <button
            onClick={onCancel}
            className="text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors"
          >
            I'll do this later
          </button>
        </div>
      </div>
    </div>
  );
};
