// lib/tools/excelTool.ts
import ExcelJS from 'exceljs';
import path from 'path';
import fs from 'fs/promises';
import type { PlanStep, StepResult } from '../types';

const EXCEL_DIR = process.env.RENDER
  ? '/data/spreadsheets'
  : path.join(process.cwd(), 'data', 'spreadsheets');

async function ensureDir() {
  await fs.mkdir(EXCEL_DIR, { recursive: true });
}

interface ExcelWriteRequest {
  filename: string;
  sheetName?: string;
  headers?: string[];
  rows: Array<Record<string, string | number>>;
}

export async function writeExcelSheet(req: ExcelWriteRequest): Promise<StepResult> {
  await ensureDir();

  const filename = req.filename.endsWith('.xlsx') ? req.filename : `${req.filename}.xlsx`;
  const fullPath = path.join(EXCEL_DIR, filename);

  const workbook = new ExcelJS.Workbook();
  const sheetName = req.sheetName || 'Sheet1';

  let sheet = workbook.getWorksheet(sheetName);
  if (!sheet) sheet = workbook.addWorksheet(sheetName);

  const headers = req.headers || (req.rows[0] ? Object.keys(req.rows[0]) : []);
  if (sheet.rowCount === 0 && headers.length > 0) {
    sheet.addRow(headers);
  }

  for (const row of req.rows) {
    sheet.addRow(headers.map((h) => row[h] ?? ''));
  }

  await workbook.xlsx.writeFile(fullPath);
  console.log(`[excel] wrote ${req.rows.length} rows to ${fullPath}`);

  return {
    output: {
      file: fullPath,
      filename,
      rowsWritten: req.rows.length,
      sheets: [sheetName],
    },
  };
}

export async function readExcelSheet(filename: string, sheetName?: string): Promise<StepResult> {
  await ensureDir();

  const fname = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  const fullPath = path.join(EXCEL_DIR, fname);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(fullPath);

  const sheet = sheetName ? workbook.getWorksheet(sheetName) : workbook.worksheets[0];
  if (!sheet) throw new Error(`Sheet not found in ${fname}`);

  const rows: Record<string, string | number>[] = [];
  const headers = (sheet.getRow(1).values as any[]).slice(1);

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj: Record<string, string | number> = {};
    (row.values as any[]).slice(1).forEach((val, idx) => {
      obj[headers[idx] || `col${idx}`] = val as string | number;
    });
    rows.push(obj);
  });

  return {
    output: {
      file: fullPath,
      filename: fname,
      sheetName: sheet.name,
      rows,
    },
  };
}

export async function runExcelStep(step: PlanStep): Promise<StepResult> {
  const action = String(step.params.action || 'write');

  if (action === 'write' || action === 'create') {
    const rawRows = (step.params.rows as unknown[]) || [];
    const headers = (step.params.headers as string[]) || undefined;
    const filename = String(step.params.filename || 'data.xlsx');
    const sheetName = step.params.sheetName as string | undefined;

    // Normalize rows: support both array-of-objects and array-of-arrays
    if (rawRows.length > 0 && Array.isArray(rawRows[0])) {
      const rowsAsArrays = rawRows as Array<Array<string | number>>;
      const effectiveHeaders =
        headers || rowsAsArrays[0].map((_, i) => `Col${i + 1}`);
      const dataStart = headers ? 0 : 1;
      const rows = rowsAsArrays.slice(dataStart).map((arr) => {
        const obj: Record<string, string | number> = {};
        effectiveHeaders.forEach((h, i) => {
          obj[h] = arr[i] ?? '';
        });
        return obj;
      });
      return writeExcelSheet({ filename, sheetName, headers: effectiveHeaders, rows });
    }

    // Object form
    const rows = rawRows as Array<Record<string, string | number>>;
    return writeExcelSheet({ filename, sheetName, headers, rows });
  }

  if (action === 'read') {
    return readExcelSheet(
      String(step.params.filename || 'data.xlsx'),
      step.params.sheetName as string | undefined
    );
  }

  throw new Error(`Unknown excel action: ${action}`);
}