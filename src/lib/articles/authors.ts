import type { ArticleAuthor } from "@/lib/types";

export function formatAuthors(authors: ArticleAuthor[]): string {
  return authors
    .map((a) => {
      let line = a.name;
      if (a.did) line += ` <${a.did}>`;
      if (a.affiliation) line += ` (${a.affiliation})`;
      return line;
    })
    .join("\n");
}

export function parseAuthors(text: string): ArticleAuthor[] {
  // 改行、コンマ、セミコロンで分割（ただし所属内のコンマなどは保持したいが、まずはシンプルに分割）
  // より高度にするなら正規表現でパターン抽出する
  const segments = text.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
  
  return segments.map((segment) => {
    let name = segment;
    let did: string | undefined;
    let affiliation: string | undefined;

    const didMatch = segment.match(/<([^>]+)>/);
    if (didMatch) {
      did = didMatch[1].trim();
      name = name.replace(didMatch[0], "").trim();
    }

    const affMatch = name.match(/\(([^)]+)\)/);
    if (affMatch) {
      affiliation = affMatch[1].trim();
      name = name.replace(affMatch[0], "").trim();
    }

    return { name: name.trim(), did, affiliation };
  });
}
