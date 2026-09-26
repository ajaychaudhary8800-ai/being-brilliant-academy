type Row = Record<string, unknown>;

export function flattenReport(value: unknown, prefix = ""): Row[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => flattenReport(item, `${prefix}${index + 1}.`));
  if (value instanceof Date) return [{ [prefix.slice(0, -1) || "value"]: value.toISOString() }];
  if (value !== null && typeof value === "object") {
    const out: Row = {};
    for (const [key, item] of Object.entries(value)) {
      const path = `${prefix}${key}`;
      if (Array.isArray(item)) out[path] = JSON.stringify(item);
      else if (item !== null && typeof item === "object" && !(item instanceof Date)) Object.assign(out, flattenReport(item, `${path}.`)[0]);
      else out[path] = item instanceof Date ? item.toISOString() : item;
    }
    return [out];
  }
  return [{ [prefix.slice(0, -1) || "value"]: value }];
}

export function reportTable(rows: Row[], requested: string[]) {
  const available = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const columns = requested.filter(column => available.includes(column));
  if (columns.length !== requested.length && rows.length) throw new Error("REPORT_COLUMNS_UNAVAILABLE");
  return { columns: rows.length ? columns : requested, rows };
}

function cell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  // Spreadsheet applications can execute formulas in imported CSV cells.
  return /^[\s]*[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}
export function reportCsv(columns: string[], rows: Row[]) {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return `\uFEFF${[columns.map(quote).join(","), ...rows.map(row => columns.map(key => quote(cell(row[key]))).join(","))].join("\r\n")}\r\n`;
}

function xml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
export function reportExcel(columns: string[], rows: Row[]) {
  const line = (values: string[]) => `<Row>${values.map(value => `<Cell><Data ss:Type="String">${xml(value)}</Data></Cell>`).join("")}</Row>`;
  return `<?xml version="1.0" encoding="UTF-8"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Report"><Table>${line(columns)}${rows.map(row => line(columns.map(key => cell(row[key])))).join("")}</Table></Worksheet></Workbook>`;
}

export function reportPdf(title: string, columns: string[], rows: Row[]) {
  const printable = (value: string) => value.replace(/[^\x20-\x7E]/g, "?").replace(/[\\()]/g, "\\$&");
  const lines = [title, columns.join(" | "), ...rows.slice(0, 35).map(row => columns.map(key => cell(row[key])).join(" | "))].map(value => printable(value).slice(0, 110));
  if (rows.length > 35) lines.push(`Showing 35 of ${rows.length} rows; use CSV or Excel for all rows.`);
  lines.push("For complete columns and Unicode names, use CSV or Excel.");
  const stream = `BT /F1 10 Tf 40 790 Td 13 TL ${lines.map((line, index) => `${index ? "T* " : ""}(${line}) Tj`).join(" ")} ET`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>", `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(pdf);
}
