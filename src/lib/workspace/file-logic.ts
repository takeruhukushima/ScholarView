import { NewFileType, WorkspaceFile } from "./types";

export function defaultTitleFromFileName(name: string): string {
  const noExt = name.replace(/\.[^.]+$/, "").trim();
  return noExt || "Untitled";
}

export function composeFileNameFromTitle(title: string, currentName: string): string {
  const trimmed = title.trim();
  if (!trimmed) return "";

  const extMatch = currentName.match(/(\.[A-Za-z0-9]+)$/);
  const ext = extMatch?.[1] ?? "";
  if (!ext) return trimmed;

  const base = trimmed.toLowerCase().endsWith(ext.toLowerCase())
    ? trimmed.slice(0, trimmed.length - ext.length).trim()
    : trimmed;
  if (!base) return "";
  return `${base}${ext}`;
}

export function makeFileTree(files: WorkspaceFile[]) {
  const byParent = new Map<string | null, WorkspaceFile[]>();
  for (const file of files) {
    const siblings = byParent.get(file.parentId) ?? [];
    siblings.push(file);
    byParent.set(file.parentId, siblings);
  }

  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }

  type TreeNode = { file: WorkspaceFile; path: string; children: TreeNode[] };

  function walk(parentId: string | null, parentPath: string): TreeNode[] {
    const siblings = byParent.get(parentId) ?? [];
    return siblings.map((file) => {
      const path = `${parentPath}/${file.name}`.replace(/\/{2,}/g, "/");
      return {
        file,
        path,
        children: walk(file.id, path),
      };
    });
  }

  return walk(null, "");
}

export function ensureFileExtension(name: string, type: NewFileType): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  if (/\.[A-Za-z0-9]+$/.test(trimmed)) return trimmed;
  if (type === "tex") return `${trimmed}.tex`;
  if (type === "bib") return `${trimmed}.bib`;
  return `${trimmed}.md`;
}

export function findProjectRootFolderId(files: WorkspaceFile[], activeFileId: string | null): string | null {
  const byId = new Map<string, WorkspaceFile>();
  for (const file of files) {
    byId.set(file.id, file);
  }
  if (!activeFileId) return null;

  const activeFile = byId.get(activeFileId);
  if (!activeFile) return null;

  let folderId: string | null = activeFile.kind === "folder" ? activeFile.id : activeFile.parentId;
  if (!folderId) return null;

  while (folderId) {
    const nextParentId: string | null = byId.get(folderId)?.parentId ?? null;
    if (!nextParentId) return folderId;
    folderId = nextParentId;
  }

  return null;
}

export function isDescendantOfFolder(
  byId: Map<string, WorkspaceFile>,
  parentId: string | null,
  ancestorFolderId: string,
): boolean {
  let cursor = parentId;
  while (cursor) {
    if (cursor === ancestorFolderId) return true;
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return false;
}

export function collectProjectBibFiles(files: WorkspaceFile[], activeFileId: string | null): WorkspaceFile[] {
  const byId = new Map<string, WorkspaceFile>();
  for (const file of files) {
    byId.set(file.id, file);
  }
  const bibFiles = files
    .filter((file) => file.kind === "file" && file.name.toLowerCase().endsWith(".bib"))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  if (bibFiles.length === 0) return [];

  const projectRootFolderId = findProjectRootFolderId(files, activeFileId);
  if (!projectRootFolderId) {
    return bibFiles.filter((file) => file.parentId === null);
  }

  return bibFiles.filter((file) => isDescendantOfFolder(byId, file.parentId, projectRootFolderId));
}

export function buildFilePathMap(files: WorkspaceFile[]): Map<string, string> {
  const byId = new Map<string, WorkspaceFile>();
  for (const file of files) {
    byId.set(file.id, file);
  }

  const memo = new Map<string, string>();
  const resolve = (id: string): string => {
    const cached = memo.get(id);
    if (cached) return cached;
    const file = byId.get(id);
    if (!file) return "";
    const parentPath = file.parentId ? resolve(file.parentId) : "";
    const path = `${parentPath}/${file.name}`.replace(/\/{2,}/g, "/");
    memo.set(id, path);
    return path;
  };

  for (const file of files) {
    resolve(file.id);
  }
  return memo;
}

export function normalizeWorkspacePath(input: string): string {
  const cleaned = input.trim().replace(/\\/g, "/");
  if (!cleaned) return "/";
  const noFragment = cleaned.split("#")[0] ?? "";
  const noQuery = noFragment.split("?")[0] ?? "";
  const parts = noQuery.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (stack.length > 0) {
        stack.pop();
      }
      continue;
    }
    stack.push(part);
  }
  return `/${stack.join("/")}`.replace(/\/{2,}/g, "/");
}

export function dirnameWorkspacePath(path: string): string {
  const normalized = normalizeWorkspacePath(path);
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 1) return "/";
  return `/${parts.slice(0, -1).join("/")}`;
}

export function resolveWorkspacePathFromDocument(input: string, documentPath: string | null): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("workspace://")) return null;
  if (trimmed.startsWith("data:")) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return null;
  if (trimmed.startsWith("#")) return null;

  if (trimmed.startsWith("/")) {
    return normalizeWorkspacePath(trimmed);
  }

  const base = dirnameWorkspacePath(documentPath ?? "/");
  return normalizeWorkspacePath(`${base}/${trimmed}`);
}
