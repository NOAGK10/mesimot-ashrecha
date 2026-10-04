import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import type { SourceTable } from '@org/shared';
import { invalid } from '../../lib/errors';
import { normalizeTable } from './parse';

/**
 * Reads tasks out of a Word document (.docx, also what Google Docs exports):
 *  - every table becomes a table, named after the heading or line just above it;
 *  - every run of bulleted or numbered items becomes a one-column table ("משימה").
 * Free text is ignored on purpose — turning prose into tasks would need AI (Phase 3, not built).
 */

type XmlNode = Record<string, unknown>;

const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: true, trimValues: false, processEntities: true });

const tagOf = (n: XmlNode) => Object.keys(n).find((k) => k !== ':@')!;
const childrenOf = (n: XmlNode): XmlNode[] => {
  const v = n[tagOf(n)];
  return Array.isArray(v) ? (v as XmlNode[]) : [];
};
const child = (n: XmlNode, tag: string) => childrenOf(n).find((c) => tagOf(c) === tag);

function textOf(n: XmlNode): string {
  const tag = tagOf(n);
  if (tag === '#text') return String(n['#text'] ?? '');
  if (tag === 'w:tab') return ' ';
  if (tag === 'w:br' || tag === 'w:cr') return '\n';
  if (tag === 'w:delText' || tag === 'w:instrText') return '';
  return childrenOf(n).map(textOf).join('');
}

const paragraphText = (p: XmlNode) => textOf(p).replace(/[ \t]+/g, ' ').trim();
const isListItem = (p: XmlNode) => {
  const pPr = child(p, 'w:pPr');
  return Boolean(pPr && child(pPr, 'w:numPr'));
};

function tableRows(tbl: XmlNode): string[][] {
  return childrenOf(tbl)
    .filter((r) => tagOf(r) === 'w:tr')
    .map((tr) =>
      childrenOf(tr)
        .filter((c) => tagOf(c) === 'w:tc')
        .map((tc) =>
          childrenOf(tc)
            .filter((x) => tagOf(x) === 'w:p' || tagOf(x) === 'w:tbl')
            .map((x) => (tagOf(x) === 'w:p' ? paragraphText(x) : textOf(x).trim()))
            .filter(Boolean)
            .join('\n'),
        ),
    );
}

export async function parseDocx(data: Buffer): Promise<{ tables: SourceTable[]; truncated: boolean }> {
  let xml: string | undefined;
  try {
    xml = await (await JSZip.loadAsync(data)).file('word/document.xml')?.async('string');
  } catch {
    // handled below
  }
  if (!xml) throw invalid('The file could not be read as a Word document (.docx)');

  const doc = (parser.parse(xml) as XmlNode[]).find((n) => tagOf(n) === 'w:document');
  const body = doc && child(doc, 'w:body');
  if (!body) throw invalid('The document has no content');

  const tables: SourceTable[] = [];
  let truncated = false;
  let lastLine = '';
  let list: string[] = [];
  const add = (fallback: string, rows: string[][]) => {
    const name = lastLine && lastLine.length <= 60 ? lastLine : `${fallback} ${tables.length + 1}`;
    const n = normalizeTable(name, rows);
    truncated ||= n.truncated;
    if (n.table.rows.length > 1 || (n.table.rows.length === 1 && fallback === 'טבלה')) tables.push(n.table);
  };
  const flushList = () => {
    if (list.length) add('רשימה', [['משימה'], ...list.map((item) => [item])]);
    list = [];
  };

  const walk = (nodes: XmlNode[]) => {
    for (const n of nodes) {
      const tag = tagOf(n);
      if (tag === 'w:p') {
        const text = paragraphText(n);
        if (isListItem(n)) {
          if (text) list.push(text);
        } else {
          flushList();
          if (text) lastLine = text;
        }
      } else if (tag === 'w:tbl') {
        flushList();
        add('טבלה', tableRows(n));
        lastLine = '';
      } else if (tag === 'w:sdt') {
        // Content controls (e.g. checklists) wrap ordinary paragraphs.
        const content = child(n, 'w:sdtContent');
        if (content) walk(childrenOf(content));
      }
    }
  };
  walk(childrenOf(body));
  flushList();

  if (tables.length === 0) throw invalid('No tables or bulleted lists were found in the document');
  return { tables, truncated };
}
