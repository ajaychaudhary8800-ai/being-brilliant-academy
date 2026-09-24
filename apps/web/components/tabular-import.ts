type TabularRow = Record<string, unknown>;

const decoder = new TextDecoder();

function normalizeHeader(value: unknown) {
  const text = String(value ?? "").replace(/^\uFEFF/, "").trim();
  if (!text) return "";
  const parts = text.split(/[\s_-]+/).filter(Boolean);
  if (parts.length > 1) return parts[0].toLowerCase() + parts.slice(1).map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join("");
  if (/^[A-Z0-9]+$/.test(text)) return text.toLowerCase();
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function numericField(key: string) {
  return /(paise|amount|rate|bps|level|days|minutes|seconds|position|sequence|capacity|count|maxPeriodsPerDay|maxPeriodsPerWeek|academicYearStartMonth)$/i.test(key);
}

function coerce(value: unknown, key: string) {
  const dateField = /(date|at)$/i.test(key);
  if (typeof value !== "string") {
    if (typeof value === "number" && dateField && value > 1 && value < 100000) {
      return new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86400000)).toISOString().slice(0, 10);
    }
    if (typeof value === "number" && !numericField(key)) return String(value);
    return value;
  }
  const text = value.trim();
  if (!text) return undefined;
  if (/^(true|false)$/i.test(text)) return text.toLowerCase() === "true";
  if (/^-?(?:\d+|\d*\.\d+)$/.test(text)) {
    const number = Number(text);
    if (Number.isFinite(number)) {
      if (dateField && number > 1 && number < 100000) {
        return new Date(Date.UTC(1899, 11, 30) + Math.round(number * 86400000)).toISOString().slice(0, 10);
      }
      if (numericField(key)) return number;
    }
  }
  return text;
}

function rowsToObjects(rows: unknown[][]): TabularRow[] {
  const headers = (rows[0] ?? []).map(normalizeHeader);
  if (!headers.length || headers.some((header, index) => !header || headers.indexOf(header) !== index)) {
    throw new Error("The first row must contain unique column headers.");
  }
  return rows.slice(1).filter(row => row.some(value => String(value ?? "").trim() !== "")).map(row => {
    const record: TabularRow = {};
    headers.forEach((header, index) => {
      const value = coerce(row[index], header);
      if (value !== undefined) record[header] = value;
    });
    return record;
  });
}

export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { cell += '"'; index++; }
        else quoted = false;
      } else cell += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted field.");
  if (cell.length || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  return rowsToObjects(rows);
}

function u16(view: DataView, offset: number) { return view.getUint16(offset, true); }
function u32(view: DataView, offset: number) { return view.getUint32(offset, true); }

type ZipEntry = { name: string; method: number; compressedSize: number; localOffset: number };

function zipEntries(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  const lower = Math.max(0, bytes.length - 65557);
  for (let offset = bytes.length - 22; offset >= lower; offset--) {
    if (u32(view, offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error("Invalid XLSX file: ZIP directory not found.");
  const total = u16(view, eocd + 10), directoryOffset = u32(view, eocd + 16);
  const entries = new Map<string, ZipEntry>();
  let cursor = directoryOffset;
  for (let index = 0; index < total; index++) {
    if (u32(view, cursor) !== 0x02014b50) throw new Error("Invalid XLSX file: central directory is corrupt.");
    const method = u16(view, cursor + 10), compressedSize = u32(view, cursor + 20);
    const nameLength = u16(view, cursor + 28), extraLength = u16(view, cursor + 30), commentLength = u16(view, cursor + 32);
    const localOffset = u32(view, cursor + 42);
    const name = decoder.decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));
    entries.set(name, { name, method, compressedSize, localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return { entries, view };
}

async function unzipEntry(bytes: Uint8Array, view: DataView, entry: ZipEntry) {
  const offset = entry.localOffset;
  if (u32(view, offset) !== 0x04034b50) throw new Error("Invalid XLSX file: local ZIP header is corrupt.");
  const nameLength = u16(view, offset + 26), extraLength = u16(view, offset + 28);
  const start = offset + 30 + nameLength + extraLength;
  const compressed = bytes.slice(start, start + entry.compressedSize);
  if (entry.method === 0) return decoder.decode(compressed);
  if (entry.method !== 8) throw new Error("Unsupported XLSX compression method.");
  if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot decompress XLSX files. Use CSV or JSON instead.");
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw" as any));
  return decoder.decode(new Uint8Array(await new Response(stream).arrayBuffer()));
}

function cellColumn(reference: string) {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? "A";
  let value = 0;
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64;
  return value - 1;
}

function xmlText(node: Element) {
  return Array.from(node.getElementsByTagName("t")).map(item => item.textContent ?? "").join("");
}

async function parseXlsx(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { entries, view } = zipEntries(bytes);
  const sharedEntry = entries.get("xl/sharedStrings.xml");
  const shared: string[] = [];
  if (sharedEntry) {
    const xml = new DOMParser().parseFromString(await unzipEntry(bytes, view, sharedEntry), "application/xml");
    for (const item of Array.from(xml.getElementsByTagName("si"))) shared.push(xmlText(item));
  }
  const sheetEntry = [...entries.values()].filter(entry => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name))[0];
  if (!sheetEntry) throw new Error("XLSX file does not contain a worksheet.");
  const xml = new DOMParser().parseFromString(await unzipEntry(bytes, view, sheetEntry), "application/xml");
  if (xml.getElementsByTagName("parsererror").length) throw new Error("XLSX worksheet XML is invalid.");
  const rows: unknown[][] = [];
  for (const rowNode of Array.from(xml.getElementsByTagName("row"))) {
    const row: unknown[] = [];
    for (const cell of Array.from(rowNode.getElementsByTagName("c"))) {
      const column = cellColumn(cell.getAttribute("r") ?? "A1"), type = cell.getAttribute("t");
      const raw = cell.getElementsByTagName("v")[0]?.textContent ?? "";
      if (type === "s") row[column] = shared[Number(raw)] ?? "";
      else if (type === "inlineStr") row[column] = xmlText(cell);
      else if (type === "b") row[column] = raw === "1";
      else if (raw !== "" && Number.isFinite(Number(raw))) row[column] = Number(raw);
      else row[column] = raw;
    }
    rows.push(row);
  }
  return rowsToObjects(rows);
}

export async function parseTabularFile(file: File): Promise<TabularRow[]> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  let rows: TabularRow[];
  if (extension === "xlsx") rows = await parseXlsx(file);
  else if (extension === "csv") rows = parseCsv(await file.text());
  else if (extension === "json") {
    const parsed = JSON.parse(await file.text());
    const data = Array.isArray(parsed) ? parsed : parsed?.rows;
    if (!Array.isArray(data)) throw new Error("JSON import must be an array or an object with a rows array.");
    rows = data as TabularRow[];
  } else if (extension === "xls") throw new Error("Legacy .xls import is not supported. Save the file as .xlsx or CSV and try again.");
  else throw new Error("Use an .xlsx, .csv or .json file.");
  if (!rows.length) throw new Error("The import file does not contain any data rows.");
  return rows;
}

export function csvTemplate(headers: string[]) {
  return headers.map(header => `"${header.replaceAll('"', '""')}"`).join(",") + "\n";
}
