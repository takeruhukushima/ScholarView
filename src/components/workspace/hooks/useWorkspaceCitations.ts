import { useState, useCallback, useMemo } from "react";
import { 
  WorkspaceFile, 
  EditorBlock,
  CitationMenuState
} from "@/lib/workspace/types";
import { 
  BibliographyEntry,
  extractCitationKeysFromText,
  parseBibtexEntries,
  formatBibtexSource
} from "@/lib/articles/citations";
import { 
  collectProjectBibFiles
} from "@/lib/workspace/file-logic";
import { 
  detectCitationTrigger
} from "@/lib/workspace/editor-logic";

interface UseWorkspaceCitationsProps {
  files: WorkspaceFile[];
  activeFileId: string | null;
  articleBibliography: BibliographyEntry[];
  sourceText: string;
  isImageWorkspaceFile: boolean;
  setEditorBlocks: React.Dispatch<React.SetStateAction<EditorBlock[]>>;
  textareaRefs: React.MutableRefObject<Record<string, HTMLTextAreaElement | null>>;
}

export function useWorkspaceCitations({
  files,
  activeFileId,
  articleBibliography,
  sourceText,
  isImageWorkspaceFile,
  setEditorBlocks,
  textareaRefs,
}: UseWorkspaceCitationsProps) {
  const [citationMenu, setCitationMenu] = useState<CitationMenuState | null>(null);
  const [citationMenuIndex, setCitationMenuIndex] = useState(0);

  const projectBibFiles = useMemo(
    () => collectProjectBibFiles(files, activeFileId),
    [activeFileId, files],
  );

  const projectBibEntries = useMemo(() => {
    const merged = new Map<string, BibliographyEntry>();
    for (const file of projectBibFiles) {
      const entries = parseBibtexEntries(file.content ?? "");
      for (const entry of entries) {
        if (!merged.has(entry.key)) {
          merged.set(entry.key, entry);
        }
      }
    }
    return Array.from(merged.values());
  }, [projectBibFiles]);

  const activeBibByKey = useMemo(() => {
    const map = new Map<string, BibliographyEntry>();
    for (const entry of projectBibEntries) map.set(entry.key, entry);
    return map;
  }, [projectBibEntries]);

  const persistedBibByKey = useMemo(() => {
    const map = new Map<string, BibliographyEntry>();
    for (const entry of articleBibliography) map.set(entry.key, entry);
    return map;
  }, [articleBibliography]);

  const citationKeys = useMemo(
    () => (isImageWorkspaceFile ? [] : extractCitationKeysFromText(sourceText)),
    [isImageWorkspaceFile, sourceText],
  );

  const resolvedBibliography = useMemo(() => {
    const resolved: BibliographyEntry[] = [];
    for (const key of citationKeys) {
      const fromBib = activeBibByKey.get(key);
      if (fromBib) {
        resolved.push(fromBib);
        continue;
      }
      const fromPersisted = persistedBibByKey.get(key);
      if (fromPersisted) resolved.push(fromPersisted);
    }
    return resolved;
  }, [activeBibByKey, citationKeys, persistedBibByKey]);

  const missingCitationKeys = useMemo(
    () =>
      citationKeys.filter(
        (key) => !activeBibByKey.has(key) && !persistedBibByKey.has(key),
      ),
    [activeBibByKey, citationKeys, persistedBibByKey],
  );

  const citationNumberByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < resolvedBibliography.length; i += 1) {
      map.set(resolvedBibliography[i].key, i + 1);
    }
    return map;
  }, [resolvedBibliography]);

  const renderCitationLookup = useMemo(() => {
    const map = new Map<string, BibliographyEntry>();
    for (const entry of resolvedBibliography) map.set(entry.key, entry);
    return map;
  }, [resolvedBibliography]);

  const updateCitationMenu = useCallback(
    (blockId: string, text: string, cursor: number) => {
      const trigger = detectCitationTrigger(text, cursor);
      if (!trigger) {
        setCitationMenu((prev) => (prev?.blockId === blockId ? null : prev));
        return;
      }
      setCitationMenu({
        blockId,
        start: trigger.start,
        end: trigger.end,
        query: trigger.query,
        format: trigger.format,
      });
      setCitationMenuIndex(0);
    },
    [],
  );

  const filteredCitationEntries = useMemo(() => {
    if (!citationMenu) return [] as BibliographyEntry[];
    const query = citationMenu.query.trim().toLowerCase();
    const searchPool = projectBibEntries.length > 0 ? projectBibEntries : articleBibliography;
    if (!query) return searchPool;
    return searchPool
      .filter((entry) => {
        const haystack = `${entry.key} ${entry.title ?? ""} ${entry.author ?? ""}`.toLowerCase();
        return haystack.includes(query);
      });
  }, [articleBibliography, citationMenu, projectBibEntries]);

  const applyCitationSuggestion = useCallback(
    (entry: BibliographyEntry) => {
      if (!citationMenu) return;
      
      let replacement = `[@${entry.key}]`;
      if (citationMenu.format === "latex") {
        replacement = `\\cite{${entry.key}}`;
      } else if (citationMenu.format === "latex-inline") {
        replacement = entry.key;
        // If we are in multi-cite mode and the next character isn't a closing brace, 
        // we might want to add one if it was completely missing. 
        // But more simply, let's just make sure the user can easily close it.
        // Actually, let's append a '}' if it's missing in the whole block's text 
        // after the current cursor or if the current token doesn't have it.
      }
      
      const targetId = citationMenu.blockId;

      setEditorBlocks((prev) =>
        prev.map((block) => {
          if (block.id !== targetId) return block;
          const before = block.text.slice(0, citationMenu.start);
          const after = block.text.slice(citationMenu.end);
          
          let finalText = `${before}${replacement}${after}`;
          
          // Auto-close brace if it's a \cite and missing closing brace
          if ((citationMenu.format === "latex" || citationMenu.format === "latex-inline") && !finalText.includes("}", citationMenu.start)) {
            finalText += "}";
          }
          
          return {
            ...block,
            text: finalText,
          };
        }),
      );

      setCitationMenu(null);

      window.setTimeout(() => {
        const textarea = textareaRefs.current[targetId];
        if (!textarea) return;
        const nextPos = citationMenu.start + replacement.length;
        textarea.focus();
        textarea.setSelectionRange(nextPos, nextPos);
      }, 0);
    },
    [citationMenu, setEditorBlocks, textareaRefs],
  );

  const normalizeBibtexBlock = useCallback((raw: string): string => {
    const normalized = raw.replace(/\r\n?/g, "\n").trim();
    if (!normalized) return "";
    return formatBibtexSource(normalized);
  }, []);

  const formatBibtexBlockById = useCallback(
    (blockId: string, raw: string) => {
      const formatted = normalizeBibtexBlock(raw);
      setEditorBlocks((prev) =>
        prev.map((block) =>
          block.id === blockId && block.text !== formatted
            ? { ...block, kind: "paragraph", text: formatted }
            : block,
        ),
      );
    },
    [normalizeBibtexBlock, setEditorBlocks],
  );

  return {
    citationMenu,
    setCitationMenu,
    citationMenuIndex,
    setCitationMenuIndex,
    projectBibEntries,
    resolvedBibliography,
    missingCitationKeys,
    citationNumberByKey,
    renderCitationLookup,
    updateCitationMenu,
    filteredCitationEntries,
    applyCitationSuggestion,
    normalizeBibtexBlock,
    formatBibtexBlockById,
  };
}
