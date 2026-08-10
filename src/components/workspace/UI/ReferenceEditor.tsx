import React from "react";

import type { CslReference } from "@/lib/articles/csl";

const TYPES = [
  "article-journal",
  "paper-conference",
  "preprint",
  "chapter",
  "book",
  "thesis",
  "report",
  "dataset",
  "software",
  "webpage",
  "manuscript",
] as const;

function initialReference(): CslReference {
  return { type: "article-journal", title: "", contributors: [] };
}

function parseReferenceJson(source: string): CslReference {
  const value = JSON.parse(source) as unknown;
  if (!value || typeof value !== "object") throw new Error("CSL-JSON must be an object");
  const record = value as Record<string, unknown>;
  if (typeof record.type !== "string" || !record.type.trim()) throw new Error("type is required");
  if (typeof record.title !== "string" || !record.title.trim()) throw new Error("title is required");
  if (record.contributors !== undefined && !Array.isArray(record.contributors)) {
    throw new Error("contributors must be an array");
  }
  return value as CslReference;
}

export function ReferenceEditor({
  onAdd,
}: {
  onAdd: (reference: CslReference) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [reference, setReference] = React.useState<CslReference>(initialReference);
  const [jsonSource, setJsonSource] = React.useState(() => JSON.stringify(initialReference(), null, 2));
  const [jsonMode, setJsonMode] = React.useState(false);
  const [error, setError] = React.useState("");

  const update = (next: CslReference) => {
    setReference(next);
    setJsonSource(JSON.stringify(next, null, 2));
    setError("");
  };

  const add = () => {
    try {
      const parsed = jsonMode ? parseReferenceJson(jsonSource) : parseReferenceJson(JSON.stringify(reference));
      onAdd(parsed);
      const empty = initialReference();
      setReference(empty);
      setJsonSource(JSON.stringify(empty, null, 2));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invalid CSL-JSON");
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100"
      >
        + CSL reference
      </button>
    );
  }

  const contributors = reference.contributors ?? [];
  return (
    <section className="space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/30 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black text-slate-700">CSL-JSON reference</p>
          <p className="text-[10px] text-slate-500">フォームとJSONは同じreferenceを編集します。</p>
        </div>
        <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-[11px] font-bold">
          <button type="button" onClick={() => setJsonMode(false)} className={`rounded-md px-2 py-1 ${!jsonMode ? "bg-indigo-600 text-white" : "text-slate-500"}`}>Form</button>
          <button type="button" onClick={() => setJsonMode(true)} className={`rounded-md px-2 py-1 ${jsonMode ? "bg-indigo-600 text-white" : "text-slate-500"}`}>JSON</button>
        </div>
      </div>

      {jsonMode ? (
        <textarea
          value={jsonSource}
          onChange={(event) => {
            setJsonSource(event.target.value);
            try {
              const parsed = parseReferenceJson(event.target.value);
              setReference(parsed);
              setError("");
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "Invalid CSL-JSON");
            }
          }}
          rows={16}
          spellCheck={false}
          className="w-full rounded-lg border border-slate-200 bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-100 outline-none focus:border-indigo-400"
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-[11px] font-bold text-slate-600">Type
            <select value={reference.type} onChange={(event) => update({ ...reference, type: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal">
              {TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-bold text-slate-600">Year
            <input type="number" value={reference.issued?.year ?? ""} onChange={(event) => update({ ...reference, issued: event.target.value ? { year: Number(event.target.value) } : undefined })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal" />
          </label>
          <label className="md:col-span-2 text-[11px] font-bold text-slate-600">Title
            <input value={reference.title} onChange={(event) => update({ ...reference, title: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal" />
          </label>
          <label className="md:col-span-2 text-[11px] font-bold text-slate-600">Container title
            <input value={reference.containerTitle ?? ""} onChange={(event) => update({ ...reference, containerTitle: event.target.value || undefined })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal" />
          </label>
          <label className="text-[11px] font-bold text-slate-600">DOI
            <input value={reference.doi ?? ""} onChange={(event) => update({ ...reference, doi: event.target.value || undefined })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal" />
          </label>
          <label className="text-[11px] font-bold text-slate-600">URL
            <input value={reference.url ?? ""} onChange={(event) => update({ ...reference, url: event.target.value || undefined })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal" />
          </label>
          <div className="space-y-2 md:col-span-2">
            <div className="flex items-center justify-between"><span className="text-[11px] font-bold text-slate-600">Authors</span><button type="button" onClick={() => update({ ...reference, contributors: [...contributors, { role: "author", family: "", given: "", sequence: contributors.length }] })} className="text-[11px] font-bold text-indigo-600">+ author</button></div>
            {contributors.map((contributor, index) => (
              <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <input placeholder="Family" value={contributor.family ?? ""} onChange={(event) => update({ ...reference, contributors: contributors.map((item, i) => i === index ? { ...item, family: event.target.value, sequence: index } : item) })} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
                <input placeholder="Given" value={contributor.given ?? ""} onChange={(event) => update({ ...reference, contributors: contributors.map((item, i) => i === index ? { ...item, given: event.target.value, sequence: index } : item) })} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
                <button type="button" aria-label="Remove author" onClick={() => update({ ...reference, contributors: contributors.filter((_, i) => i !== index) })} className="px-2 text-slate-400 hover:text-red-500">×</button>
              </div>
            ))}
          </div>
          <details className="md:col-span-2">
            <summary className="cursor-pointer text-[11px] font-bold text-slate-500">JSON preview</summary>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-950 p-3 text-[11px] text-slate-100">{jsonSource}</pre>
          </details>
        </div>
      )}
      {error && <p className="text-xs font-medium text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 text-xs font-bold text-slate-500">Close</button>
        <button type="button" onClick={add} disabled={Boolean(error)} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">Add to library</button>
      </div>
    </section>
  );
}
