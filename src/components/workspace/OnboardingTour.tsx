import { useState, useEffect, useMemo } from "react";

interface OnboardingTourProps {
  storageKey: string;
}

export function OnboardingTour({ storageKey }: OnboardingTourProps) {
  const steps = useMemo(
    () => [
      { target: "sidebar", text: "左サイドバーでファイルを選択します。" },
      { target: "editor", text: "中央でNotion風のブロック編集を行います。" },
      { target: "publish-flow", text: "保存してからPublishするとarticleとして公開されます。" },
      { target: "right-panel", text: "右パネルでプレビューと熟議を確認します。" },
    ],
    [],
  );

  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const done = window.localStorage.getItem(storageKey);
    if (!done) {
      const timer = window.setTimeout(() => setOpen(true), 0);
      return () => window.clearTimeout(timer);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!open) return;

    const updateRect = () => {
      const step = steps[stepIndex];
      if (!step) return;
      const element = document.querySelector(`[data-tour-id="${step.target}"]`);
      if (!(element instanceof HTMLElement)) {
        setRect(null);
        return;
      }
      setRect(element.getBoundingClientRect());
    };

    updateRect();
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);

    return () => {
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
    };
  }, [open, stepIndex, steps]);

  const finish = () => {
    window.localStorage.setItem(storageKey, "done");
    setOpen(false);
    setStepIndex(0);
  };

  if (!open) return null;
  const step = steps[stepIndex];

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/45" />
      {rect ? (
        <div
          className="pointer-events-none fixed z-50 rounded-xl border-2 border-[#0085FF] shadow-[0_0_0_9999px_rgba(15,23,42,0.45)]"
          style={{
            left: rect.left - 6,
            top: rect.top - 6,
            width: rect.width + 12,
            height: rect.height + 12,
          }}
        />
      ) : null}
      <div className="fixed inset-x-4 bottom-6 z-50 mx-auto w-full max-w-xl rounded-xl border bg-white p-4 shadow-2xl">
        <p className="text-sm font-semibold text-slate-900">Tutorial {stepIndex + 1}/{steps.length}</p>
        <p className="mt-2 text-sm text-slate-600">{step.text}</p>
        <div className="mt-4 flex items-center justify-between">
          <button type="button" onClick={finish} className="text-xs text-slate-500 hover:text-slate-700">
            Skip
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStepIndex((prev) => Math.max(prev - 1, 0))}
              disabled={stepIndex === 0}
              className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-40"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => {
                if (stepIndex >= steps.length - 1) {
                  finish();
                  return;
                }
                setStepIndex((prev) => prev + 1);
              }}
              className="rounded-md bg-[#0085FF] px-3 py-1.5 text-sm text-white"
            >
              {stepIndex >= steps.length - 1 ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
