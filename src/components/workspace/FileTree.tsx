import { useMemo, useState, DragEvent } from "react";
import { WorkspaceFile, TreeDropPosition } from "@/lib/workspace/types";
import { makeFileTree } from "@/lib/workspace/file-logic";

interface FileTreeProps {
  files: WorkspaceFile[];
  activeFileId: string | null;
  onSelect: (file: WorkspaceFile) => void;
  onToggleFolder: (file: WorkspaceFile) => void;
  onRename?: (file: WorkspaceFile) => void;
  onDelete: (file: WorkspaceFile) => void;
  onMove?: (draggedId: string, target: WorkspaceFile, position: TreeDropPosition) => void;
  onDownload?: (file: WorkspaceFile) => void;
  draggable?: boolean;
}

export function FileTree({
  files,
  activeFileId,
  onSelect,
  onToggleFolder,
  onRename,
  onDelete,
  onMove,
  onDownload,
  draggable,
}: FileTreeProps) {
  const tree = useMemo(() => makeFileTree(files), [files]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const renderNode = (node: ReturnType<typeof makeFileTree>[number], depth: number) => {
    const isFolder = node.file.kind === "folder";
    const isActive = activeFileId === node.file.id;
    const expanded = node.file.expanded === 1;

    const getDropPosition = (event: DragEvent<HTMLDivElement>): TreeDropPosition => {
      const rect = event.currentTarget.getBoundingClientRect();
      const offsetY = event.clientY - rect.top;
      if (isFolder && offsetY >= rect.height * 0.25 && offsetY <= rect.height * 0.75) {
        return "inside";
      }
      return offsetY < rect.height / 2 ? "before" : "after";
    };

    return (
      <li key={node.file.id}>
        <div
          className={`group relative flex items-center gap-2 rounded-md px-2 py-1 text-sm ${
            isActive ? "bg-[#E7F2FF]" : "hover:bg-slate-100"
          } ${
            dragOverKey === `${node.file.id}:before`
              ? "border-t-2 border-[#0085FF]"
              : dragOverKey === `${node.file.id}:after`
                ? "border-b-2 border-[#0085FF]"
                : dragOverKey === `${node.file.id}:inside`
                  ? "bg-[#E7F2FF] ring-1 ring-inset ring-[#0085FF]"
                : ""
          }`}
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          draggable={Boolean(draggable)}
          onDragStart={(event) => {
            if (!draggable) return;
            setDraggingId(node.file.id);
            event.dataTransfer.setData("text/plain", node.file.id);
            event.dataTransfer.effectAllowed = "move";
            setOpenMenuId(null);
          }}
          onDragEnd={() => {
            setDraggingId(null);
            setDragOverKey(null);
          }}
          onDragOver={(event) => {
            if (!onMove || !draggable) return;
            const dragId = event.dataTransfer.getData("text/plain") || draggingId;
            if (!dragId || dragId === node.file.id) return;
            event.preventDefault();
            const position = getDropPosition(event);
            setDragOverKey(`${node.file.id}:${position}`);
          }}
          onDrop={(event) => {
            if (!onMove || !draggable) return;
            const dragId = event.dataTransfer.getData("text/plain") || draggingId;
            if (!dragId || dragId === node.file.id) {
              setDragOverKey(null);
              setDraggingId(null);
              return;
            }
            event.preventDefault();
            const position = getDropPosition(event);
            onMove(dragId, node.file, position);
            setDragOverKey(null);
            setDraggingId(null);
          }}
        >
          {isFolder ? (
            <button
              type="button"
              onClick={() => onToggleFolder(node.file)}
              className="w-4 shrink-0 text-xs text-slate-500"
            >
              {expanded ? "▾" : "▸"}
            </button>
          ) : (
            <span className="w-4 shrink-0 text-xs text-slate-400">•</span>
          )}

          <button
            type="button"
            onClick={() => onSelect(node.file)}
            className="min-w-0 flex-1 truncate text-left"
            title={node.path}
          >
            {node.file.name}
          </button>

          {node.file.kind === "file" && node.file.linkedArticleUri ? (
            <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700">pub</span>
          ) : null}

          <div className="relative ml-auto flex items-center shrink-0">
            <button
              id={`menu-trigger-${node.file.id}`}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpenMenuId(openMenuId === node.file.id ? null : node.file.id);
              }}
              className={`rounded px-1.5 py-0.5 text-xs text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 ${
                openMenuId === node.file.id ? "opacity-100 bg-slate-200 text-slate-700" : "opacity-0 group-hover:opacity-100"
              }`}
              title="More actions"
              aria-label="More actions"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
            </button>
            
            {openMenuId === node.file.id && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenMenuId(null);
                  }}
                />
                <div 
                  className={`absolute right-0 z-50 w-32 rounded-lg border border-slate-200 bg-white py-1 shadow-lg ring-1 ring-black/5 animate-in fade-in zoom-in-95 duration-100 ${
                    typeof window !== 'undefined' && 
                    (document.getElementById(`menu-trigger-${node.file.id}`)?.getBoundingClientRect().bottom ?? 0) > window.innerHeight - 200 
                      ? "bottom-full mb-1" 
                      : "top-full mt-1"
                  }`}
                >
                  {onDownload && node.file.kind === "file" && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenuId(null);
                        onDownload(node.file);
                      }}
                      className="flex w-full items-center px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 transition-colors text-left"
                    >
                      Download
                    </button>
                  )}
                  {onRename && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenuId(null);
                        onRename(node.file);
                      }}
                      className="flex w-full items-center px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 transition-colors text-left"
                    >
                      Rename
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenMenuId(null);
                      onDelete(node.file);
                    }}
                    className="flex w-full items-center px-3 py-1.5 text-xs text-red-600 font-medium hover:bg-red-50 transition-colors text-left"
                  >
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {isFolder && expanded && node.children.length > 0 ? (
          <ul className="space-y-0.5">{node.children.map((child) => renderNode(child, depth + 1))}</ul>
        ) : null}
      </li>
    );
  };

  if (tree.length === 0) {
    return <p className="text-xs text-slate-500">No files yet.</p>;
  }

  return (
    <ul className="space-y-0.5 pb-32">
      {tree.map((node) => renderNode(node, 0))}
    </ul>
  );
}
