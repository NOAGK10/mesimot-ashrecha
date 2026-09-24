import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import type { SourceTable } from '@org/shared';
import { invalid } from '../../lib/errors';

export const MAX_ROWS = 2000;
export const MAX_COLS = 40;

/** Trims empty trailing rows/columns and caps the size so previews stay small. */
export function normalizeTable(name: string, raw: string[][]): { table: SourceTable; truncated: boolean } {
  const rows = raw.map((r) => r.slice(0, MAX_COLS).map((c) => (c ?? '').toString().trim()));
  while (rows.length && rows[rows.length - 1]!.every((c) => c === '')) rows.pop();
  const width = Math.max(0, ...rows.map((r) => r.reduce((w, c, i) => (c ? i + 1 : w), 0)));
  const truncated = rows.length > MAX_ROWS || raw.some((r) => r.length > MAX_COLS);
  return {
    table: { name, rows: rows.slice(0, MAX_ROWS).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? '')) },
    truncated,
  };
}

export function parseCsv(name: string, text: string): { table: SourceTable; truncated: boolean } {
  const result = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: false });
  return normalizeTable(name, result.data);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Formats a cell the way a person reads it; dates become DD/MM/YYYY so one parser handles every source. */
function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v instanceof Date) return `${pad(v.getUTCDate())}/${pad(v.getUTCMonth() + 1)}/${v.getUTCFullYear()}`;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return cell.text ?? '';
}

export async function parseXlsx(data: Buffer): Promise<{ tables: SourceTable[]; truncated: boolean }> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data as unknown as ArrayBuffer);
  } catch {
    throw invalid('The file could not be read as an Excel workbook (.xlsx)');
  }
  let truncated = false;
  const tables: SourceTable[] = [];
  wb.eachSheet((ws) => {
    const raw: string[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      if (rowNumber > MAX_ROWS + 1) return;
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        if (col <= MAX_COLS) cells[col - 1] = cellText(cell);
      });
      raw[rowNumber - 1] = cells;
    });
    const n = normalizeTable(ws.name, Array.from(raw, (r) => r ?? []));
    truncated ||= n.truncated || ws.rowCount > MAX_ROWS;
    tables.push(n.table);
  });
  return { tables, truncated };
}

export async function parseUpload(filename: string, data: Buffer): Promise<{ tables: SourceTable[]; truncated: boolean }> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.tsv') || lower.endsWith('.txt')) {
    const { table, truncated } = parseCsv(filename.replace(/\.[^.]+$/, ''), data.toString('utf8'));
    return { tables: [table], truncated };
  }
  if (lower.endsWith('.xlsx')) return parseXlsx(data);
  if (lower.endsWith('.xls')) throw invalid('Old .xls files are not supported. Save the file as .xlsx or CSV and try again.');
  throw invalid('Supported files: Excel (.xlsx) and CSV');
}
