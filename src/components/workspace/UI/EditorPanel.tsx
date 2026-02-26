import React from "react";
import { 
  WorkspaceFile, 
  EditorBlock, 
  CitationMenuState,
  BlockMoveDropTarget,
  ImageDropPosition,
  RightTab
} from "@/lib/workspace/types";
import { SourceFormat } from "@/lib/types";
import { 
  blockTextClass, 
  isImeComposing, 
  referenceAnchorId,
  resizeTextarea
} from "@/lib/workspace/utils";
import { 
  defaultTitleFromFileName 
} from "@/lib/workspace/file-logic";
import { 
  normalizeEditedBlockInput 
} from "@/lib/workspace/editor-logic";
import { 
  imageAlignFromAttrs, 
  parseMarkdownImageLine, 
  setImageAlignOnMarkdownLine 
} from "@/lib/workspace/image-logic";
import { 
  formatBibliographyIEEE,
  BibliographyEntry
} from "@/lib/articles/citations";
import { 
  parseAuthors 
} from "@/lib/articles/authors";
import { 
  renderRichParagraphs, 
  renderInlineText,
  renderBibtexHighlighted
} from "../RichRenderer";

interface EditorPanelProps {
  // Document State
  hasOpenDocument: boolean;
  activeFile: WorkspaceFile | null;
  title: string;
  setTitle: (val: string) => void;
  authorsText: string;
  setAuthorsText: (val: string) => void;
  isAuthorsFocused: boolean;
  setIsAuthorsFocused: (val: boolean) => void;
  editorBlocks: EditorBlock[];
  activeBlockId: string | null;
  
  // Permissions & Flags
  canEditCurrentFile: boolean;
  canEditTextCurrentFile: boolean;
  canPublishCurrentFile: boolean;
  isImageWorkspaceFile: boolean;
  isBibWorkspaceFile: boolean;
  isDirtyFile: boolean;
  isDirtyTitle: boolean;
  savingFile: boolean;
  busy: boolean;
  broadcastToBsky: boolean;
  setBroadcastToBsky: (val: boolean) => void;
  sourceFormat: SourceFormat;
  currentDid: string | null;
  currentRkey: string | null;
  readOnlyMessage: string | null;
  
  // Actions
  handlePublish: () => Promise<void>;
  handleUnpublish: () => Promise<void>;
  handleExport: (target: "md" | "tex") => void;
  handleSourceFormatChange: (format: SourceFormat) => void;
  persistTitleAsFileName: (options?: { silent?: boolean }) => Promise<WorkspaceFile | null>;
  updateBlock: (id: string, patch: Partial<EditorBlock>) => void;
  insertBlockAfter: (index: number, kind: "paragraph" | "h1" | "h2" | "h3") => void;
  removeBlock: (index: number) => void;
  focusBlockByIndex: (index: number, options?: { position: "start" | "end" }) => void;
  activateBlockEditor: (id: string, position?: "start" | "end") => void;
  insertInlineMath: (id: string) => void;
  setStatusMessage: (msg: string) => void;
  setTab: (tab: RightTab) => void;
  
  // Citations
  citationMenu: CitationMenuState | null;
  citationMenuIndex: number;
  filteredCitationEntries: BibliographyEntry[];
  applyCitationSuggestion: (entry: BibliographyEntry) => void;
  renderCitationLookup: Map<string, BibliographyEntry>;
  citationNumberByKey: Map<string, number>;
  resolvedBibliography: BibliographyEntry[];
  updateCitationMenu: (id: string, text: string, cursor: number) => void;
  selectedQuote: string;
  
  // Media & DnD
  activeImagePreviewSrc: string | null;
  resolveWorkspaceImageSrc: (input: string) => string;
  handleImageDrop: (event: React.DragEvent<HTMLElement>, insertAt?: { blockId: string; position: ImageDropPosition } | null) => Promise<void>;
  imageDropTarget: { blockId: string; position: ImageDropPosition } | null;
  setImageDropTarget: (val: { blockId: string; position: ImageDropPosition } | null) => void;
  draggingEditorBlockId: string | null;
  setDraggingEditorBlockId: (val: string | null) => void;
  blockMoveDropTarget: BlockMoveDropTarget | null;
  setBlockMoveDropTarget: (val: BlockMoveDropTarget | null) => void;
  moveBlockByDrop: (draggedId: string, targetId: string, position: ImageDropPosition) => void;
  
  // Refs & Menus
  titleRef: React.RefObject<HTMLInputElement | null>;
  authorsRef: React.RefObject<HTMLTextAreaElement | null>;
  textareaRefs: React.MutableRefObject<Record<string, HTMLTextAreaElement | null>>;
  bibHighlightScrollRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
  showMoreMenu: boolean;
  setShowMoreMenu: React.Dispatch<React.SetStateAction<boolean>>;
  
  // BibTeX
  formatBibtexBlockById: (id: string, raw: string) => void;
}

export const EditorPanel: React.FC<EditorPanelProps> = ({
  hasOpenDocument,
  activeFile,
  title,
  setTitle,
  authorsText,
  setAuthorsText,
  isAuthorsFocused,
  setIsAuthorsFocused,
  editorBlocks,
  activeBlockId,
  canEditCurrentFile,
  canEditTextCurrentFile,
  canPublishCurrentFile,
  isImageWorkspaceFile,
  isBibWorkspaceFile,
  isDirtyFile,
  isDirtyTitle,
  savingFile,
  busy,
  broadcastToBsky,
  setBroadcastToBsky,
  sourceFormat,
  currentDid,
  currentRkey,
  readOnlyMessage,
  handlePublish,
  handleUnpublish,
  handleExport,
  handleSourceFormatChange,
  persistTitleAsFileName,
  updateBlock,
  insertBlockAfter,
  removeBlock,
  focusBlockByIndex,
  activateBlockEditor,
  insertInlineMath,
  setStatusMessage,
  setTab,
  citationMenu,
  citationMenuIndex,
  filteredCitationEntries,
  applyCitationSuggestion,
  renderCitationLookup,
  citationNumberByKey,
  resolvedBibliography,
  updateCitationMenu,
  selectedQuote,
  activeImagePreviewSrc,
  resolveWorkspaceImageSrc,
  handleImageDrop,
  imageDropTarget,
  setImageDropTarget,
  draggingEditorBlockId,
  setDraggingEditorBlockId,
  blockMoveDropTarget,
  setBlockMoveDropTarget,
  moveBlockByDrop,
  titleRef,
  authorsRef,
  textareaRefs,
  bibHighlightScrollRefs,
  showMoreMenu,
  setShowMoreMenu,
  formatBibtexBlockById,
}) => {
  
  const hasDraggedImageData = (event: React.DragEvent<HTMLElement>): boolean =>
    Array.from(event.dataTransfer.items ?? []).some(
      (item) => item.kind === "file" && item.type.startsWith("image/"),
    );

  const BLOCK_DRAG_MIME = "application/x-scholarview-editor-block";
  const hasDraggedEditorBlock = (event: React.DragEvent<HTMLElement>): boolean =>
    Array.from(event.dataTransfer.types ?? []).includes(BLOCK_DRAG_MIME) || Boolean(draggingEditorBlockId);

  const determineBlockDropPosition = (event: React.DragEvent<HTMLElement>): ImageDropPosition => {
    const rect = event.currentTarget.getBoundingClientRect();
    const offsetY = event.clientY - rect.top;
    return offsetY < rect.height / 2 ? "before" : "after";
  };

  const handleEditorCanvasClick = (event: React.MouseEvent) => {
    if (event.target === event.currentTarget && canEditTextCurrentFile) {
      if (editorBlocks.length > 0) {
        focusBlockByIndex(editorBlocks.length - 1, { position: "end" });
      }
    }
  };

  return (
    <section
      data-tour-id="editor"
      className="min-w-0 rounded-xl border border-slate-200/60 bg-white p-6 shadow-sm overflow-y-auto h-[calc(100vh-5rem)] scrollbar-thin scrollbar-thumb-slate-200"
      onClick={handleEditorCanvasClick}
      onDragOver={(event) => {
        if (!canEditTextCurrentFile) return;
        if (hasDraggedEditorBlock(event)) {
          event.preventDefault();
          if (imageDropTarget !== null) setImageDropTarget(null);
          return;
        }
        if (!hasDraggedImageData(event)) return;
        event.preventDefault();
        if (imageDropTarget !== null) setImageDropTarget(null);
      }}
      onDragLeave={() => {
        if (imageDropTarget !== null) setImageDropTarget(null);
        if (blockMoveDropTarget !== null) setBlockMoveDropTarget(null);
      }}
      onDrop={(event) => {
        if (hasDraggedEditorBlock(event)) {
          event.preventDefault();
          setDraggingEditorBlockId(null);
          setBlockMoveDropTarget(null);
          return;
        }
        void handleImageDrop(event, imageDropTarget);
        setBlockMoveDropTarget(null);
      }}
    >
      {!hasOpenDocument ? (
        <div className="flex h-full min-h-[26rem] flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-100 bg-slate-50/30 text-slate-400">
          <div className="mb-4 rounded-full bg-slate-100 p-4">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
          </div>
          <p className="text-sm font-medium">No document open</p>
          <p className="text-[11px] uppercase tracking-wider mt-1 opacity-60">Select from the sidebar to begin</p>
        </div>
      ) : (
        <div className="max-w-4xl mx-auto">
          <div className="mb-8 flex items-start justify-between gap-6" data-tour-id="publish-flow">
            <div className="flex flex-1 flex-col gap-2">
              <input
                ref={titleRef}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => {
                  if (!title.trim()) {
                    if (activeFile?.kind === "file") {
                      setTitle(defaultTitleFromFileName(activeFile.name));
                    }
                    return;
                  }
                  void persistTitleAsFileName({ silent: true }).catch((err: unknown) => {
                    setStatusMessage(err instanceof Error ? err.message : "Failed to save file name");
                  });
                }}
                onKeyDown={(e) => {
                  if (isImeComposing(e)) return;
                  if (e.key === "ArrowDown" || e.key === "Enter") {
                    e.preventDefault();
                    if (!title.trim() && activeFile?.kind === "file") {
                      setTitle(defaultTitleFromFileName(activeFile.name));
                    }
                    void persistTitleAsFileName({ silent: true }).catch(() => {});
                    setIsAuthorsFocused(true);
                    setTimeout(() => authorsRef.current?.focus(), 10);
                    return;
                  }
                }}
                readOnly={!canEditCurrentFile}
                className="w-full border-none bg-transparent text-4xl font-bold tracking-tight text-slate-900 outline-none placeholder:text-slate-200"
                placeholder="Article Title..."
              />

              {canPublishCurrentFile && (
                <div className="mt-2 min-h-[2rem]">
                  {isAuthorsFocused || !authorsText.trim() ? (
                    <>
                      <textarea
                        ref={authorsRef}
                        autoFocus={isAuthorsFocused}
                        value={authorsText}
                        onChange={(e) => setAuthorsText(e.target.value)}
                        onBlur={() => setIsAuthorsFocused(false)}
                        onKeyDown={(e) => {
                          if (isImeComposing(e)) return;
                          const atStart = e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === 0;
                          const atEnd = e.currentTarget.selectionStart === e.currentTarget.value.length && e.currentTarget.selectionEnd === e.currentTarget.value.length;
                          if (e.key === "ArrowUp" && atStart) {
                            e.preventDefault();
                            titleRef.current?.focus();
                            return;
                          }
                          if (e.key === "ArrowDown" || e.key === "Enter") {
                            if (e.key === "Enter" || atEnd) {
                              e.preventDefault();
                              if (editorBlocks.length > 0) focusBlockByIndex(0, { position: "start" });
                              setIsAuthorsFocused(false);
                            }
                          }
                        }}
                        readOnly={!canEditCurrentFile}
                        className="w-full resize-none border-none bg-transparent font-mono text-sm text-indigo-600 outline-none placeholder:text-slate-300"
                        placeholder="Authors: Name <did:plc:...> (Affiliation), ..."
                        rows={Math.max(1, authorsText.split("\n").length)}
                      />
                      {authorsText.trim() && (
                        <div className="mt-2 flex flex-wrap gap-1.5 opacity-80">
                          {parseAuthors(authorsText).map((a, i) => (
                            <span key={i} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-600 border border-indigo-100">
                              <span>{a.name || "Anonymous"}</span>
                              {a.affiliation && <span className="opacity-60 font-normal">({a.affiliation})</span>}
                            </span>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <div onClick={() => setIsAuthorsFocused(true)} className="flex min-h-[1.5rem] cursor-text flex-wrap gap-1.5 py-1">
                      {parseAuthors(authorsText).map((a, i) => (
                        <span key={i} className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-600 border border-slate-100">
                          <span>{a.name || "Anonymous"}</span>
                          {a.affiliation && <span className="opacity-60 font-normal">({a.affiliation})</span>}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="relative flex items-center gap-3 shrink-0 pt-2">
              {canEditCurrentFile && (
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-slate-50 border border-slate-100">
                  <div className={`h-1.5 w-1.5 rounded-full ${savingFile ? "bg-amber-400 animate-pulse" : isDirtyFile || isDirtyTitle ? "bg-slate-300" : "bg-emerald-500"}`}></div>
                  <span className="text-[10px] font-bold uppercase tracking-tighter text-slate-500">
                    {savingFile ? "Syncing" : isDirtyFile || isDirtyTitle ? "Draft" : "Saved"}
                  </span>
                </div>
              )}

              {canPublishCurrentFile && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void handlePublish().catch((err: unknown) => {
                      setStatusMessage(err instanceof Error ? err.message : "Failed to publish");
                    });
                  }}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-indigo-200 hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-50"
                >
                  Broadcast
                </button>
              )}

              {canEditTextCurrentFile && !isBibWorkspaceFile && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowMoreMenu((prev) => !prev)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:bg-slate-50 transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
                  </button>
                  {showMoreMenu && (
                    <div className="absolute right-0 top-10 z-30 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-xl ring-1 ring-black/5 animate-in fade-in slide-in-from-top-2">
                      <div className="p-2 border-b border-slate-50 mb-1">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Settings</p>
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between px-2 py-1.5">
                          <span className="text-xs text-slate-600 font-medium">Format</span>
                          <select
                            value={sourceFormat}
                            onChange={(e) => handleSourceFormatChange(e.target.value as SourceFormat)}
                            className="text-xs font-bold text-indigo-600 bg-indigo-50 rounded px-1.5 py-0.5 outline-none"
                          >
                            <option value="markdown">Markdown</option>
                            <option value="tex">TeX</option>
                          </select>
                        </div>
                        <label className="flex items-center justify-between px-2 py-1.5 hover:bg-slate-50 rounded-lg cursor-pointer transition-colors">
                          <span className="text-xs text-slate-600 font-medium">Bluesky Sync</span>
                          <input
                            type="checkbox"
                            checked={broadcastToBsky}
                            onChange={(e) => setBroadcastToBsky(e.target.checked)}
                            className="h-3 w-3 rounded text-indigo-600 focus:ring-indigo-500"
                          />
                        </label>
                      </div>
                      <div className="mt-2 p-2 border-t border-slate-50 space-y-1">
                        <button onClick={() => handleExport("md")} className="w-full text-left px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50 rounded-lg transition-colors flex items-center justify-between">
                          Export Markdown <span className="opacity-40">.md</span>
                        </button>
                        <button onClick={() => handleExport("tex")} className="w-full text-left px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50 rounded-lg transition-colors flex items-center justify-between">
                          Export LaTeX <span className="opacity-40">.tex</span>
                        </button>
                      </div>
                      {currentDid && currentRkey && (
                        <div className="mt-1 p-1">
                          <button
                            type="button"
                            onClick={() => {
                              void handleUnpublish().catch((err: unknown) => {
                                setStatusMessage(err instanceof Error ? err.message : "Failed to unpublish");
                              });
                            }}
                            className="w-full text-left px-2 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded-lg transition-colors font-bold"
                          >
                            Unpublish Article
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {readOnlyMessage && (
            <div className="mb-6 flex items-center gap-2 rounded-xl border border-amber-100 bg-amber-50/50 px-4 py-3 text-[13px] font-medium text-amber-900 shadow-sm">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              {readOnlyMessage}
            </div>
          )}

          <div className="min-h-[24rem]">
            {isImageWorkspaceFile ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 px-1">
                  <div className="h-1.5 w-1.5 rounded-full bg-indigo-500"></div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Image Asset View</p>
                </div>
                <div className="flex min-h-[24rem] items-center justify-center rounded-2xl border-2 border-slate-100 bg-slate-50/30 p-8 shadow-inner">
                  {activeImagePreviewSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={activeImagePreviewSrc}
                      alt={activeFile?.name ?? "image"}
                      className="max-h-[70vh] w-auto max-w-full rounded-xl border-4 border-white bg-white object-contain shadow-2xl"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-3 text-slate-300">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                      <p className="text-sm font-medium italic">Loading image data...</p>
                    </div>
                  )}
                </div>
              </div>
            ) : isBibWorkspaceFile ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between px-1">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">BibTeX Source Library</p>
                  <span className="text-[10px] font-medium text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full border border-slate-100">
                    {editorBlocks.length} entries
                  </span>
                </div>
                <div className="space-y-2">
                  {editorBlocks.map((block, index) => (
                    <div
                      key={block.id}
                      data-editor-block-id={block.id}
                      className="group relative"
                    >
                      {canEditTextCurrentFile ? (
                        <div className="relative rounded-xl border border-slate-100 bg-white transition-all focus-within:ring-2 focus-within:ring-indigo-500/20 focus-within:border-indigo-500/50">
                          {/* Highlight Layer (Background) */}
                          <div
                            ref={(el) => { if (bibHighlightScrollRefs.current) bibHighlightScrollRefs.current[block.id] = el; }}
                            aria-hidden
                            className="pointer-events-none absolute inset-0 overflow-x-auto overflow-y-hidden px-4 py-3"
                          >
                            <div className="whitespace-pre font-mono text-[13px] leading-relaxed text-slate-800">
                              {block.text.length > 0
                                ? renderBibtexHighlighted(block.text, `editor-bib-active-${block.id}`)
                                : <span className="opacity-20 italic text-slate-400">{"@article{key, ...}"}</span>}
                            </div>
                          </div>
                          {/* Input Layer (Foreground, Transparent) */}
                          <textarea
                            ref={(el) => {
                              textareaRefs.current[block.id] = el;
                              if (el) resizeTextarea(el);
                            }}
                            value={block.text}
                            onChange={(e) => {
                              updateBlock(block.id, { text: e.target.value });
                              if (textareaRefs.current[block.id]) resizeTextarea(textareaRefs.current[block.id]!);
                            }}
                            onScroll={(e) => {
                              const overlay = bibHighlightScrollRefs.current[block.id];
                              if (overlay) {
                                const scrollLeft = e.currentTarget.scrollLeft;
                                requestAnimationFrame(() => {
                                  overlay.scrollLeft = scrollLeft;
                                });
                              }
                            }}
                            onBlur={(e) => {
                              formatBibtexBlockById(block.id, e.target.value);
                            }}
                            onKeyDown={(e) => {
                              if (isImeComposing(e)) return;
                              if (e.key === "Enter" && e.shiftKey) {
                                e.preventDefault();
                                insertBlockAfter(index, "paragraph");
                              }
                              if (e.key === "Backspace" && block.text.length === 0 && editorBlocks.length > 1) {
                                e.preventDefault();
                                removeBlock(index);
                              }
                            }}
                            rows={1}
                            wrap="off"
                            spellCheck={false}
                            className="relative z-10 w-full resize-none overflow-x-auto whitespace-pre bg-transparent px-4 py-3 font-mono text-[13px] leading-relaxed text-transparent caret-indigo-600 outline-none selection:bg-indigo-500/20 selection:text-transparent"
                          />
                        </div>
                      ) : (
                        <div className="rounded-xl border border-slate-100 bg-slate-50/30 p-4">
                          <div className="max-w-full overflow-x-auto whitespace-pre font-mono text-[13px] leading-relaxed text-slate-800">
                            {renderBibtexHighlighted(block.text, `editor-bib-readonly-${block.id}`)}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                {editorBlocks.map((block, index) => (
                  <div
                    key={block.id}
                    data-editor-block-id={block.id}
                    className="relative group transition-all"
                    onDragOver={(event) => {
                      if (!canEditTextCurrentFile || !hasDraggedEditorBlock(event)) return;
                      event.preventDefault();
                      const pos = determineBlockDropPosition(event);
                      setBlockMoveDropTarget({ blockId: block.id, position: pos });
                    }}
                    onDrop={(event) => {
                      if (!canEditTextCurrentFile) return;
                      if (hasDraggedEditorBlock(event)) {
                        event.preventDefault();
                        const draggedId = event.dataTransfer.getData(BLOCK_DRAG_MIME) || draggingEditorBlockId;
                        if (draggedId && draggedId !== block.id) {
                          const pos = determineBlockDropPosition(event);
                          moveBlockByDrop(draggedId, block.id, pos);
                        }
                        setDraggingEditorBlockId(null);
                        setBlockMoveDropTarget(null);
                      }
                    }}
                  >
                    {blockMoveDropTarget?.blockId === block.id && blockMoveDropTarget.position === "before" && (
                      <div className="h-1 bg-indigo-500 rounded-full my-1 shadow-[0_0_8px_rgba(79,70,229,0.4)] animate-in fade-in zoom-in-y duration-200" />
                    )}

                    <div className={`relative rounded-lg transition-all ${
                      canEditTextCurrentFile ? "hover:bg-slate-50/50" : ""
                    }`}>
                      {/* Block Controls (Floating Left) */}
                      {canEditTextCurrentFile && (
                        <div className="absolute -left-7 top-1/2 -translate-y-1/2 flex flex-col items-center opacity-0 group-hover:opacity-100 transition-all focus-within:opacity-100">
                          <button
                            draggable
                            onDragStart={(e) => {
                              setDraggingEditorBlockId(block.id);
                              e.dataTransfer.setData(BLOCK_DRAG_MIME, block.id);
                              e.dataTransfer.effectAllowed = "move";
                            }}
                            onDragEnd={() => {
                              setDraggingEditorBlockId(null);
                              setBlockMoveDropTarget(null);
                            }}
                            className="p-1 text-slate-300 hover:text-indigo-400 cursor-grab active:cursor-grabbing transition-colors"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>
                          </button>
                        </div>
                      )}

                      <div className="px-1 py-1">
                        {canEditTextCurrentFile && activeBlockId === block.id ? (
                          <>
                            <textarea
                              ref={(el) => { textareaRefs.current[block.id] = el; }}
                              value={block.text}
                              onChange={(e) => {
                                const nextValue = e.target.value;
                                const normalized = normalizeEditedBlockInput(
                                  block,
                                  nextValue,
                                  sourceFormat,
                                );
                                updateBlock(block.id, normalized);
                                resizeTextarea(e.target);
                                updateCitationMenu(block.id, normalized.text, e.target.selectionStart);
                              }}
                              onFocus={() => activateBlockEditor(block.id)}
                              onKeyDown={(e) => {
                                if (isImeComposing(e)) return;

                                if (citationMenu?.blockId === block.id) {
                                  if (e.key === "ArrowDown") {
                                    e.preventDefault();
                                    return;
                                  }
                                  if (e.key === "ArrowUp") {
                                    e.preventDefault();
                                    return;
                                  }
                                  if (e.key === "Enter" || e.key === "Tab") {
                                    e.preventDefault();
                                    if (filteredCitationEntries[citationMenuIndex]) {
                                      applyCitationSuggestion(filteredCitationEntries[citationMenuIndex]);
                                    }
                                    return;
                                  }
                                  if (e.key === "Escape") {
                                    return;
                                  }
                                }

                                const isAtStart = e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === 0;
                                const isAtEnd = e.currentTarget.selectionStart === e.currentTarget.value.length && e.currentTarget.selectionEnd === e.currentTarget.value.length;

                                if (e.key === "ArrowUp" && isAtStart) {
                                  e.preventDefault();
                                  if (index === 0) {
                                    setIsAuthorsFocused(true);
                                    setTimeout(() => authorsRef.current?.focus(), 10);
                                  } else {
                                    focusBlockByIndex(index - 1, { position: "end" });
                                  }
                                  return;
                                }
                                if (e.key === "ArrowDown" && isAtEnd) {
                                  e.preventDefault();
                                  focusBlockByIndex(index + 1, { position: "start" });
                                  return;
                                }
                                if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "m") {
                                  e.preventDefault();
                                  insertInlineMath(block.id);
                                  return;
                                }
                                if (e.key === "Enter" && !e.shiftKey) {
                                  e.preventDefault();
                                  insertBlockAfter(index, "paragraph");
                                  return;
                                }
                                if (e.key === "Backspace" && block.text.length === 0 && editorBlocks.length > 1) {
                                  e.preventDefault();
                                  removeBlock(index);
                                }
                              }}
                              placeholder={block.kind === "paragraph" ? "" : "Heading"}
                              className={`w-full resize-none border-none bg-transparent p-0 outline-none ${blockTextClass(block.kind)} select-text`}
                            />
                            {citationMenu?.blockId === block.id && (
                              <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-1 shadow-2xl ring-1 ring-black/5">
                                {filteredCitationEntries.length === 0 ? (
                                  <p className="px-3 py-2 text-[11px] italic text-slate-400">No matching literature found.</p>
                                ) : (
                                  <ul className="max-h-64 overflow-y-auto">
                                    {filteredCitationEntries.map((entry, idx) => (
                                      <li
                                        key={entry.key}
                                        ref={(el) => {
                                          if (idx === citationMenuIndex) el?.scrollIntoView({ block: "nearest" });
                                        }}
                                      >
                                        <button
                                          type="button"
                                          onMouseDown={(event) => event.preventDefault()}
                                          onClick={() => applyCitationSuggestion(entry)}
                                          className={`w-full rounded-lg px-3 py-2 text-left transition-colors ${
                                            idx === citationMenuIndex ? "bg-indigo-50 text-indigo-700" : "hover:bg-slate-50 text-slate-600"
                                          }`}
                                        >
                                          <div className="flex items-center justify-between">
                                            <p className="font-mono text-[10px] font-bold opacity-70 tracking-wider uppercase">@{entry.key}</p>
                                            <span className="text-[9px] bg-white border border-slate-100 rounded px-1 px-0.5">REF</span>
                                          </div>
                                          <p className="truncate text-[11px] font-medium mt-0.5">{entry.title ?? entry.author ?? "Untitled Source"}</p>
                                        </button>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            )}
                          </>
                        ) : (
                          <div
                            role={canEditCurrentFile ? "button" : undefined}
                            tabIndex={canEditCurrentFile ? 0 : undefined}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (!canEditCurrentFile) return;
                              const target = event.target;
                              if (target instanceof HTMLElement && target.closest("a")) return;
                              activateBlockEditor(block.id, "end");
                            }}
                            onKeyDown={(event) => {
                              if (!canEditCurrentFile) return;
                              if (event.key !== "Enter" && event.key !== " ") return;
                              event.preventDefault();
                              activateBlockEditor(block.id, "start");
                            }}
                            className={`min-h-[1.5rem] w-full rounded px-0.5 py-0.5 ${canEditCurrentFile ? "cursor-text" : ""}`}
                          >
                            {block.text.trim().length > 0 ? (
                              block.kind === "paragraph" ? (
                                renderRichParagraphs(block.text, `editor-block-preview-${block.id}`, {
                                  citationLookup: renderCitationLookup,
                                  citationNumberByKey,
                                  referenceAnchorPrefix: "editor-ref",
                                  resolveImageSrc: resolveWorkspaceImageSrc,
                                })
                              ) : (
                                <p className={`${blockTextClass(block.kind)} whitespace-pre-wrap`}>
                                  {renderInlineText(block.text, `editor-heading-preview-${block.id}`, {
                                    citationLookup: renderCitationLookup,
                                    citationNumberByKey,
                                    referenceAnchorPrefix: "editor-ref",
                                  })}
                                </p>
                              )
                            ) : (
                              block.kind === "paragraph" ? <p className="h-6" /> : <p className="text-sm text-slate-300 italic">Enter heading...</p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {blockMoveDropTarget?.blockId === block.id && blockMoveDropTarget.position === "after" && (
                      <div className="h-1 bg-indigo-500 rounded-full my-1 shadow-[0_0_8px_rgba(79,70,229,0.4)] animate-in fade-in zoom-in-y duration-200" />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* References Footer */}
          {!isBibWorkspaceFile && !isImageWorkspaceFile && resolvedBibliography.length > 0 && (
            <section className="mt-12 pt-8 border-t border-slate-100">
              <div className="flex items-center gap-2 mb-4 px-1">
                <div className="h-1.5 w-1.5 rounded-full bg-slate-400"></div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Bibliographic References</p>
              </div>
              <ul className="space-y-3 px-1">
                {formatBibliographyIEEE(resolvedBibliography).map((line, index) => (
                  <li
                    key={`${line}-${index}`}
                    id={referenceAnchorId("editor-ref", resolvedBibliography[index].key)}
                    className="text-[12px] leading-relaxed text-slate-500 scroll-mt-24 list-none pl-6 -indent-6"
                  >
                    <span className="inline-block w-6 text-slate-400 font-mono font-bold">[{index + 1}]</span>
                    {line.replace(/^\[\d+\]\s*/, "")}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Highlight Selection Hook */}
          {selectedQuote && (
            <div data-tour-id="selection-hook" className="mt-8 rounded-2xl border border-indigo-100 bg-indigo-50/20 p-4 shadow-sm animate-in slide-in-from-bottom-4 duration-500 text-left">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse"></div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-600">Contextual Discussion</p>
              </div>
              <p className="text-[13px] italic leading-relaxed text-slate-600 px-1 border-l-2 border-indigo-200 ml-1">&quot;{selectedQuote}&quot;</p>
              <button
                type="button"
                onClick={() => setTab("discussion")}
                className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all flex items-center gap-2"
              >
                <span>Initiate Peer Review</span>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
