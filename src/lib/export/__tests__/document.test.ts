import { describe, it, expect } from 'vitest';
import {
  blockContentMarkdownToTex,
  buildTexDocument,
  buildMarkdownDocument
} from '../document';

describe('export document logic', () => {
  describe('blockContentMarkdownToTex', () => {
    it('converts citations to \\cite{}', () => {
      const input = 'As seen in [@key1] and [@key2].';
      expect(blockContentMarkdownToTex(input)).toBe('As seen in \\cite{key1} and \\cite{key2}.');
    });

    it('converts markdown images to LaTeX figure environment', () => {
      const input = '![Figure Caption](image.png){#fig:1 width=0.5}';
      const output = blockContentMarkdownToTex(input);
      expect(output).toContain('\\begin{figure}[htbp]');
      expect(output).toContain('\\includegraphics[width=0.5\\linewidth]{image.png}');
      expect(output).toContain('\\caption{Figure Caption}');
      expect(output).toContain('\\label{fig:1}');
    });

    it('converts $$ display math to equation environment', () => {
      const input = `$$
E = mc^2
$$`;
      const output = blockContentMarkdownToTex(input);
      expect(output).toContain('\\begin{equation}');
      expect(output).toContain('E = mc^2');
      expect(output).toContain('\\end{equation}');
    });
  });

  describe('buildTexDocument', () => {
    it('builds a full LaTeX document snippet with sections', () => {
      const blocks = [
        { level: 1 as const, heading: 'Intro', content: 'Text [@k1]' }
      ];
      const bib = [{ key: 'k1', rawBibtex: '', author: 'A', title: 'T', year: '2020' }];
      const result = buildTexDocument(blocks, bib);
      expect(result.content).toContain('\\documentclass{article}');
      expect(result.content).toContain('\\begin{document}');
      expect(result.content).toContain('\\section{Intro}');
      expect(result.content).toContain('\\cite{k1}');
      expect(result.content).toContain('\\bibliographystyle{ieeetr}');
      expect(result.content).toContain('\\bibliography{references}');
      expect(result.content).toContain('\\end{document}');
    });
  });

  describe('buildMarkdownDocument', () => {
    it('builds a markdown document with references', () => {
      const blocks = [
        { level: 1 as const, heading: 'Intro', content: 'Text \\cite{k1}' }
      ];
      const bib = [{ key: 'k1', rawBibtex: '', author: 'A', title: 'T', year: '2020' }];
      const result = buildMarkdownDocument(blocks, bib);
      expect(result.content).toContain('---');
      expect(result.content).toContain('bibliography: references.bib');
      expect(result.content).toContain('# Intro');
      expect(result.content).toContain('Text [@k1]');
      expect(result.content).toContain('## References');
    });
  });
});
