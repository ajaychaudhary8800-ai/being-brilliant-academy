import { inflateRawSync } from "node:zlib";
import { AppError } from "./http.js";

export type SpreadsheetUpload = { name: string; base64: string };
export type SpreadsheetRow = Record<string, string | number | boolean | null>;

const MAX_UPLOAD = 5 * 1024 * 1024;
const MAX_ENTRY = 10 * 1024 * 1024;

function invalid(message: string) {
  return new AppError(422, "INVALID_SPREADSHEET", message);
}

function decodeEntities(value: string) {
  return value.replace(/&#x([0-9a-f]+);|&#(\d+);|&(amp|lt|gt|quot|apos);/gi, (_match, hex, decimal, named) => {
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    if (decimal) return String.fromCodePoint(Number.parseInt(decimal, 10));
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[String(named).toLowerCase()] ?? "";
  });
}

function textNodes(xml: string) {
  return [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map(match => decodeEntities(match[1].replace(/<[^>]+>/g, ""))).join("");
}

function records(matrix: Array<Array<string | number | boolean | null>>): SpreadsheetRow[] {
  const populated = matrix.filter(row => row.some(value => value !== null && String(value).trim() !== ""));
  if (populated.length < 2) throw invalid("The spreadsheet must contain a header row and at least one data row");
  const headers = populated[0].map(value => String(value ?? "").replace(/^\uFEFF/, "").trim());
  if (headers.some(header => !header)) throw invalid("Every imported column must have a header");
  const normalized = headers.map(header => header.toLowerCase().replace(/[^a-z0-9]+/g, ""));
  if (new Set(normalized).size !== normalized.length) throw invalid("Spreadsheet headers must be unique");
  return populated.slice(1).map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? null])));
}

function csvMatrix(text: string) {
  const rows: string[][] = [];
  let row: string[] = [], value = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { value += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else value += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(value); value = ""; }
    else if (character === "\n") { row.push(value.replace(/\r$/, "")); rows.push(row); row = []; value = ""; }
    else value += character;
  }
  if (quoted) throw invalid("The CSV file contains an unterminated quoted value");
  if (value || row.length) { row.push(value.replace(/\r$/, "")); rows.push(row); }
  return rows;
}

function spreadsheetXmlMatrix(xml: string) {
  const rows: Array<Array<string | null>> = [];
  for (const rowMatch of xml.matchAll(/<Row\b[^>]*>([\s\S]*?)<\/Row>/gi)) {
    const row: Array<string | null> = [];
    for (const cellMatch of rowMatch[1].matchAll(/<Cell\b([^>]*)>([\s\S]*?)<\/Cell>/gi)) {
      const index = /(?:ss:)?Index="(\d+)"/i.exec(cellMatch[1]);
      if (index) while (row.length < Number(index[1]) - 1) row.push(null);
      const data = /<Data\b[^>]*>([\s\S]*?)<\/Data>/i.exec(cellMatch[2]);
      row.push(data ? decodeEntities(data[1].replace(/<[^>]+>/g, "")) : null);
    }
    rows.push(row);
  }
  return rows;
}

function zipEntry(archive: Buffer, wanted: string) {
  let eocd = -1;
  for (let index = archive.length - 22; index >= Math.max(0, archive.length - 65_557); index -= 1) {
    if (archive.readUInt32LE(index) === 0x06054b50) { eocd = index; break; }
  }
  if (eocd < 0) throw invalid("The XLSX archive is incomplete");
  const entries = archive.readUInt16LE(eocd + 10);
  let offset = archive.readUInt32LE(eocd + 16);
  for (let count = 0; count < entries; count += 1) {
    if (offset + 46 > archive.length || archive.readUInt32LE(offset) !== 0x02014b50) throw invalid("The XLSX directory is invalid");
    const method = archive.readUInt16LE(offset + 10), compressedSize = archive.readUInt32LE(offset + 20), uncompressedSize = archive.readUInt32LE(offset + 24), nameLength = archive.readUInt16LE(offset + 28), extraLength = archive.readUInt16LE(offset + 30), commentLength = archive.readUInt16LE(offset + 32), localOffset = archive.readUInt32LE(offset + 42);
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (name === wanted) {
      if (uncompressedSize > MAX_ENTRY) throw invalid("The XLSX worksheet is too large");
      if (localOffset + 30 > archive.length || archive.readUInt32LE(localOffset) !== 0x04034b50) throw invalid("The XLSX worksheet entry is invalid");
      const localName = archive.readUInt16LE(localOffset + 26), localExtra = archive.readUInt16LE(localOffset + 28), start = localOffset + 30 + localName + localExtra, end = start + compressedSize;
      if (end > archive.length) throw invalid("The XLSX worksheet entry is truncated");
      const compressed = archive.subarray(start, end);
      const output = method === 0 ? Buffer.from(compressed) : method === 8 ? inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY }) : null;
      if (!output) throw invalid("The XLSX compression method is not supported");
      if (output.length > MAX_ENTRY || uncompressedSize && output.length !== uncompressedSize) throw invalid("The XLSX worksheet size is invalid");
      return output.toString("utf8");
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

function xlsxMatrix(archive: Buffer) {
  const worksheet = zipEntry(archive, "xl/worksheets/sheet1.xml");
  if (!worksheet) throw invalid("The first XLSX worksheet could not be found");
  const sharedXml = zipEntry(archive, "xl/sharedStrings.xml");
  const shared = sharedXml ? [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)].map(match => textNodes(match[1])) : [];
  const rows: Array<Array<string | number | boolean | null>> = [];
  for (const rowMatch of worksheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
    const row: Array<string | number | boolean | null> = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
      const reference = /\br="([A-Z]+)\d+"/i.exec(cellMatch[1])?.[1]?.toUpperCase();
      let column = 0;
      if (reference) for (const character of reference) column = column * 26 + character.charCodeAt(0) - 64;
      column = column ? column - 1 : row.length;
      while (row.length < column) row.push(null);
      const type = /\bt="([^"]+)"/i.exec(cellMatch[1])?.[1];
      const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/i.exec(cellMatch[2])?.[1] ?? "";
      const value = type === "s" ? shared[Number(raw)] ?? "" : type === "inlineStr" ? textNodes(cellMatch[2]) : type === "b" ? raw === "1" : raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : decodeEntities(raw);
      row[column] = value;
    }
    rows.push(row);
  }
  return rows;
}

function decodeBase64(base64: string) {
  const compact = base64.replace(/\s/g, "");
  if (!compact || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 !== 0) throw invalid("The uploaded file is not valid base64 data");
  const data = Buffer.from(compact, "base64");
  if (!data.length || data.length > MAX_UPLOAD) throw invalid("Import files must be between 1 byte and 5 MB");
  return data;
}

export function parseSpreadsheetUpload(upload: SpreadsheetUpload): SpreadsheetRow[] {
  const extension = upload.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (!extension || !["csv", "json", "xls", "xlsx"].includes(extension)) throw invalid("Use a CSV, JSON, XLS, or XLSX file");
  const data = decodeBase64(upload.base64);
  if (extension === "json") {
    let parsed: unknown;
    try { parsed = JSON.parse(data.toString("utf8")); } catch { throw invalid("The JSON file is invalid"); }
    const rows = Array.isArray(parsed) ? parsed : (parsed as { rows?: unknown })?.rows;
    if (!Array.isArray(rows) || !rows.length || rows.some(row => !row || typeof row !== "object" || Array.isArray(row))) throw invalid("JSON imports must contain a non-empty array of row objects");
    return rows as SpreadsheetRow[];
  }
  if (extension === "csv") return records(csvMatrix(data.toString("utf8")));
  if (extension === "xls") return records(spreadsheetXmlMatrix(data.toString("utf8")));
  return records(xlsxMatrix(data));
}

export function normalizedSpreadsheetRow(row: SpreadsheetRow) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase().replace(/[^a-z0-9]+/g, ""), value]));
}
