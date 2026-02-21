import type { SourceFormat } from "@/lib/db";
import { getWorkspaceFileByPath } from "@/lib/db/queries";

const MAX_DEPTH_DEFAULT = 5;

export interface ImportDiagnostic {
  code: "invalid_path" | "not_found" | "not_file" | "cycle" | "max_depth";
  path: string;
  message: string;
}

export interface ResolveWorkspaceImportsResult {
  resolvedText: string;
  diagnostics: ImportDiagnostic[];
}

function normalizePath(rawPath: string): string | null {
  const trimmed = rawPath.trim();
  if (!trimmed) return null;

  const normalized = trimmed.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  if (normalized.includes("..")) {
    return null;
  }

  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function getPatterns(sourceFormat: SourceFormat): RegExp[] {
  if (sourceFormat === "tex") {
    return [/\\input\{([^}]+)\}/g, /\{\{import:\s*([^}]+)\s*\}\}/g];
  }

  return [/\{\{import:\s*([^}]+)\s*\}\}/g, /\\input\{([^}]+)\}/g];
}

async function resolvePattern(
  input: string,
  regex: RegExp,
  sourceFormat: SourceFormat,
  ownerDid: string,
  depth: number,
  stack: string[],
  diagnostics: ImportDiagnostic[],
): Promise<string> {
  let cursor = 0;
  let output = "";

  for (;;) {
    const match = regex.exec(input);
    if (!match) break;

    output += input.slice(cursor, match.index);
    cursor = match.index + match[0].length;

    const rawPath = match[1] ?? "";
    const normalizedPath = normalizePath(rawPath);
    if (!normalizedPath) {
      diagnostics.push({
        code: "invalid_path",
        path: rawPath,
        message: "Import path is invalid",
      });
      output += match[0];
      continue;
    }

    if (depth >= MAX_DEPTH_DEFAULT) {
      diagnostics.push({
        code: "max_depth",
        path: normalizedPath,
        message: "Import nesting exceeded max depth",
      });
      output += match[0];
      continue;
    }

    if (stack.includes(normalizedPath)) {
      diagnostics.push({
        code: "cycle",
        path: normalizedPath,
        message: "Cyclic import detected",
      });
      output += match[0];
      continue;
    }

    const resolvedFile = await getWorkspaceFileByPath(normalizedPath, ownerDid);
    if (!resolvedFile) {
      diagnostics.push({
        code: "not_found",
        path: normalizedPath,
        message: "Import target not found",
      });
      output += match[0];
      continue;
    }

    if (resolvedFile.kind !== "file") {
      diagnostics.push({
        code: "not_file",
        path: normalizedPath,
        message: "Import target is not a file",
      });
      output += match[0];
      continue;
    }

    const childFormat = resolvedFile.sourceFormat ?? sourceFormat;
    const childText = resolvedFile.content ?? "";
    const child = await resolveWorkspaceImports({
      text: childText,
      sourceFormat: childFormat,
      ownerDid,
      depth: depth + 1,
      stack: [...stack, normalizedPath],
      diagnostics,
    });
    output += child.resolvedText;
  }

  output += input.slice(cursor);
  return output;
}

interface ResolveWorkspaceImportsInput {
  text: string;
  sourceFormat: SourceFormat;
  ownerDid: string;
  depth?: number;
  stack?: string[];
  diagnostics?: ImportDiagnostic[];
}

export async function resolveWorkspaceImports(
  input: ResolveWorkspaceImportsInput,
): Promise<ResolveWorkspaceImportsResult> {
  const diagnostics = input.diagnostics ?? [];
  const depth = input.depth ?? 0;
  const stack = input.stack ?? [];

  let resolved = input.text;
  const patterns = getPatterns(input.sourceFormat);
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    resolved = await resolvePattern(
      resolved,
      pattern,
      input.sourceFormat,
      input.ownerDid,
      depth,
      stack,
      diagnostics,
    );
  }

  return {
    resolvedText: resolved,
    diagnostics,
  };
}
