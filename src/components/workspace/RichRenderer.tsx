import { Fragment, type ReactNode } from "react";
import { BibliographyEntry } from "@/lib/articles/citations";
import { linkHref, referenceAnchorId, renderMathHtml } from "@/lib/workspace/utils";

export function renderBibtexHighlighted(text: string, keyPrefix: string): ReactNode[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  return lines.map((line, lineIndex) => {
    const entryMatch = line.match(/^(\s*)@([A-Za-z]+)(\s*[{(]\s*)([^,\s]+)(.*)$/);
    if (entryMatch) {
      return (
        <Fragment key={`${keyPrefix}-line-${lineIndex}`}>
          {entryMatch[1]}
          <span className="text-slate-500">@</span>
          <span className="font-medium text-indigo-700">{entryMatch[2]}</span>
          {entryMatch[3]}
          <span className="font-medium text-emerald-700">{entryMatch[4]}</span>
          {entryMatch[5]}
          {lineIndex < lines.length - 1 ? <br /> : null}
        </Fragment>
      );
    }

    const fieldMatch = line.match(/^(\s*)([A-Za-z][A-Za-z0-9:_-]*)(\s*=\s*)(.*)$/);
    if (fieldMatch) {
      return (
        <Fragment key={`${keyPrefix}-line-${lineIndex}`}>
          {fieldMatch[1]}
          <span className="font-medium text-blue-700">{fieldMatch[2]}</span>
          {fieldMatch[3]}
          {fieldMatch[4]}
          {lineIndex < lines.length - 1 ? <br /> : null}
        </Fragment>
      );
    }

    return (
      <Fragment key={`${keyPrefix}-line-${lineIndex}`}>
        {line}
        {lineIndex < lines.length - 1 ? <br /> : null}
      </Fragment>
    );
  });
}

export function renderInlineText(
  text: string,
  keyPrefix: string,
  options?: {
    citationLookup?: Map<string, BibliographyEntry>;
    citationNumberByKey?: Map<string, number>;
    referenceAnchorPrefix?: string;
    isSelected?: boolean;
  },
): ReactNode[] {
  const nodes: ReactNode[] = [];
  const containerClass = options?.isSelected ? "bg-[#B4D5FF] text-inherit" : "";
  const tokenRegex =
    /(`[^`]+`|\$\$[\s\S]+?\$\$|\$(?:\\.|[^$\n])+\$|\[@[A-Za-z0-9:_-]+\]|\*\*[^*]+\*\*|_[^_]+_|\[[^\]]+\]\((https?:\/\/[^)\s]+)\)|https?:\/\/[^\s]+)/g;
  let cursor = 0;
  let matchIndex = 0;

  for (;;) {
    const match = tokenRegex.exec(text);
    if (!match) break;

    const key = `${keyPrefix}-${matchIndex}`;
    matchIndex += 1;

    if (match.index > cursor) {
      nodes.push(
        <span key={`${key}-pre`} className={containerClass}>
          {text.slice(cursor, match.index)}
        </span>,
      );
    }

    const token = match[0];

    if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code key={key} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.9em] text-slate-800">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("$$") && token.endsWith("$$")) {
      const expr = token.slice(2, -2).trim();
      const mathHtml = renderMathHtml(expr, true);
      if (mathHtml) {
        nodes.push(
          <span
            key={key}
            className="my-1 block overflow-x-auto rounded border border-blue-100 bg-blue-50 px-2 py-1"
            dangerouslySetInnerHTML={{ __html: mathHtml }}
          />,
        );
      } else {
        nodes.push(
          <span
            key={key}
            className="select-text rounded bg-blue-50 px-1.5 py-0.5 font-mono text-[0.9em] text-blue-900"
          >
            {expr}
          </span>,
        );
      }
    } else if (token.startsWith("$") && token.endsWith("$")) {
      const expr = token.slice(1, -1).trim();
      const mathHtml = renderMathHtml(expr, false);
      if (mathHtml) {
        nodes.push(
          <span
            key={key}
            className="inline-block align-middle"
            dangerouslySetInnerHTML={{ __html: mathHtml }}
          />,
        );
      } else {
        nodes.push(
          <span
            key={key}
            className="select-text rounded bg-blue-50 px-1.5 py-0.5 font-mono text-[0.9em] text-blue-900"
          >
            {expr}
          </span>,
        );
      }
    } else if (token.startsWith("[@") && token.endsWith("]")) {
      const keyValue = token.slice(2, -1);
      const matched = options?.citationLookup?.get(keyValue);
      const number = options?.citationNumberByKey?.get(keyValue);
      if (number) {
        const anchorPrefix = options?.referenceAnchorPrefix ?? "ref";
        const href = `#${referenceAnchorId(anchorPrefix, keyValue)}`;
        nodes.push(
          <a
            key={key}
            href={href}
            className="inline-flex rounded px-1 py-0.5 font-mono text-[0.85em] text-[#0085FF] hover:underline"
            title={matched?.title ?? keyValue}
          >
            [{number}]
          </a>,
        );
      } else {
        nodes.push(
          <span
            key={key}
            className="inline-flex rounded bg-amber-100 px-1.5 py-0.5 text-[0.85em] text-amber-900"
            title={matched?.title ?? `Missing citation: ${keyValue}`}
          >
            [?]
          </span>,
        );
      }
    } else if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("_") && token.endsWith("_")) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith("[")) {
      const linkMatch = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
      const href = linkMatch ? linkHref(linkMatch[2]) : null;
      if (linkMatch && href) {
        nodes.push(
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-[#0085FF] underline decoration-[#0085FF]/40 underline-offset-2"
          >
            {linkMatch[1]}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    } else {
      const href = linkHref(token);
      if (href) {
        nodes.push(
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-[#0085FF] underline decoration-[#0085FF]/40 underline-offset-2"
          >
            {token}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    }

    cursor = match.index + token.length;
  }

  if (cursor < text.length) {
    nodes.push(
      <span key={`${keyPrefix}-last`} className={containerClass}>
        {text.slice(cursor)}
      </span>,
    );
  }

  return nodes;
}

export function renderRichParagraphs(
  text: string,
  keyPrefix: string,
  options?: {
    citationLookup?: Map<string, BibliographyEntry>;
    citationNumberByKey?: Map<string, number>;
    referenceAnchorPrefix?: string;
    resolveImageSrc?: (input: string) => string;
    isSelected?: boolean;
  },
) {
  const nodes: ReactNode[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      nodes.push(
        <pre
          key={`${keyPrefix}-code-${i}`}
          className="overflow-x-auto rounded-md bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100"
        >
          {codeLines.join("\n")}
        </pre>,
      );
      continue;
    }

    if (line.startsWith("$$")) {
      const mathLines: string[] = [];
      const current = line.slice(2);
      if (current.endsWith("$$")) {
        mathLines.push(current.slice(0, -2));
        i += 1;
      } else {
        mathLines.push(current);
        i += 1;
        while (i < lines.length) {
          const candidate = lines[i];
          if (candidate.endsWith("$$")) {
            mathLines.push(candidate.slice(0, -2));
            i += 1;
            break;
          }
          mathLines.push(candidate);
          i += 1;
        }
      }

      nodes.push(
        <div
          key={`${keyPrefix}-math-${i}`}
          className="overflow-x-auto rounded-md border border-blue-100 bg-blue-50 px-3 py-2"
        >
          {(() => {
            const mathHtml = renderMathHtml(mathLines.join("\n").trim(), true);
            if (mathHtml) {
              return <span dangerouslySetInnerHTML={{ __html: mathHtml }} />;
            }
            return (
              <span className="font-mono text-xs text-blue-900">{mathLines.join("\n")}</span>
            );
          })()}
        </div>,
      );
      continue;
    }

    if (line.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }

      nodes.push(
        <blockquote
          key={`${keyPrefix}-quote-${i}`}
          className="border-l-2 border-slate-300 pl-3 text-slate-600"
        >
          {quoteLines.map((quoteLine, quoteIndex) => (
            <p key={`${keyPrefix}-quote-line-${quoteIndex}`}>
              {renderInlineText(
                quoteLine,
                `${keyPrefix}-quote-inline-${quoteIndex}`,
                {
                  citationLookup: options?.citationLookup,
                  citationNumberByKey: options?.citationNumberByKey,
                  referenceAnchorPrefix: options?.referenceAnchorPrefix,
                  isSelected: options?.isSelected,
                },
              )}
            </p>
          ))}
        </blockquote>,
      );
      continue;
    }

    // Markdown image detection logic (simplified from WorkspaceApp)
    const imageMatch = line.trim().match(/^!\[([^\]]*)\]\(([^)\s]+)\)(?:\{([^}]*)\})?$/);
    if (imageMatch) {
      const alt = imageMatch[1].trim();
      const rawSrc = imageMatch[2].trim();
      const attrs = (imageMatch[3] ?? "").trim();
      const labelMatch = attrs.match(/#([^\s}]+)/);
      const widthMatch = attrs.match(/width=([0-9.]+)/);
      const alignMatch = attrs.match(/\balign=(left|center|right)\b/i);
      const align = alignMatch ? alignMatch[1].toLowerCase() : "center";
      const src = options?.resolveImageSrc ? options.resolveImageSrc(rawSrc) : rawSrc;
      const width = widthMatch ? Number(widthMatch[1]) : 0.8;
      nodes.push(
        <figure
          key={`${keyPrefix}-img-${i}`}
          className={`space-y-1 ${
            align === "left" ? "text-left" : align === "right" ? "text-right" : "text-center"
          }`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt || "figure"}
            style={{
              maxWidth: `${Math.min(1, Math.max(0.1, width)) * 100}%`,
              marginLeft: align === "right" || align === "center" ? "auto" : undefined,
              marginRight: align === "left" || align === "center" ? "auto" : undefined,
            }}
            className="block rounded border"
          />
          {(alt || labelMatch) ? (
            <figcaption className="text-xs text-slate-600">
              {alt}
              {labelMatch ? <span className="ml-1 font-mono text-slate-500">({labelMatch[1]})</span> : null}
            </figcaption>
          ) : null}
        </figure>
      );
      i += 1;
      continue;
    }

    const unorderedItems: string[] = [];
    while (i < lines.length && /^[-*+]\s+/.test(lines[i])) {
      unorderedItems.push(lines[i].replace(/^[-*+]\s+/, ""));
      i += 1;
    }
    if (unorderedItems.length > 0) {
      nodes.push(
        <ul key={`${keyPrefix}-ul-${i}`} className="list-disc space-y-1 pl-6">
          {unorderedItems.map((item, itemIndex) => (
            <li key={`${keyPrefix}-ul-item-${itemIndex}`}>
              {renderInlineText(
                item,
                `${keyPrefix}-ul-inline-${itemIndex}`,
                {
                  citationLookup: options?.citationLookup,
                  citationNumberByKey: options?.citationNumberByKey,
                  referenceAnchorPrefix: options?.referenceAnchorPrefix,
                  isSelected: options?.isSelected,
                },
              )}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    const orderedItems: string[] = [];
    while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
      orderedItems.push(lines[i].replace(/^\d+\.\s+/, ""));
      i += 1;
    }
    if (orderedItems.length > 0) {
      nodes.push(
        <ol key={`${keyPrefix}-ol-${i}`} className="list-decimal space-y-1 pl-6">
          {orderedItems.map((item, itemIndex) => (
            <li key={`${keyPrefix}-ol-item-${itemIndex}`}>
              {renderInlineText(
                item,
                `${keyPrefix}-ol-inline-${itemIndex}`,
                {
                  citationLookup: options?.citationLookup,
                  citationNumberByKey: options?.citationNumberByKey,
                  referenceAnchorPrefix: options?.referenceAnchorPrefix,
                  isSelected: options?.isSelected,
                },
              )}
            </li>
          ))}
        </ol>
      );
      continue;
    }

    const paragraphLines: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^[-*+]\s+/.test(lines[i]) && !/^\d+\.\s+/.test(lines[i])) {
      if (lines[i].startsWith(">") || lines[i].startsWith("```") || lines[i].startsWith("$$")) {
        break;
      }
      paragraphLines.push(lines[i]);
      i += 1;
    }

    nodes.push(
      <p key={`${keyPrefix}-p-${i}`} className="whitespace-pre-wrap">
        {paragraphLines.map((paragraphLine, paragraphIndex) => (
          <Fragment key={`${keyPrefix}-p-line-${paragraphIndex}`}>
            {renderInlineText(
              paragraphLine,
              `${keyPrefix}-p-inline-${paragraphIndex}`,
              {
                citationLookup: options?.citationLookup,
                citationNumberByKey: options?.citationNumberByKey,
                referenceAnchorPrefix: options?.referenceAnchorPrefix,
                isSelected: options?.isSelected,
              }
            )}
            {paragraphIndex < paragraphLines.length - 1 ? <br /> : null}
          </Fragment>
        ))}
      </p>
    );
  }

  if (nodes.length === 0) {
    return <p className="text-sm text-slate-500">No content.</p>;
  }

  return <div className="select-text space-y-2 text-sm leading-6 text-slate-800">{nodes}</div>;
}
