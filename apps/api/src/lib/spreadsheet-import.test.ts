import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import { parseSpreadsheetUpload } from "./spreadsheet-import.js";

const upload = (name: string, contents: string | Buffer) => ({ name, base64: Buffer.from(contents).toString("base64") });

test("parses quoted CSV imports", () => {
  const rows = parseSpreadsheetUpload(upload("employees.csv", 'Employee Code,Name,Remarks\r\nEMP-1,"Ada, Lovelace","Line ""one"""\r\n'));
  assert.deepEqual(rows, [{ "Employee Code": "EMP-1", Name: "Ada, Lovelace", Remarks: 'Line "one"' }]);
});

test("parses the SpreadsheetML XLS format produced by ERP exports", () => {
  const xml = '<?xml version="1.0"?><Workbook><Worksheet><Table><Row><Cell><Data>Code</Data></Cell><Cell><Data>Name</Data></Cell></Row><Row><Cell><Data>A-1</Data></Cell><Cell><Data>Cash &amp; Bank</Data></Cell></Row></Table></Worksheet></Workbook>';
  assert.deepEqual(parseSpreadsheetUpload(upload("accounts.xls", xml)), [{ Code: "A-1", Name: "Cash & Bank" }]);
});

function zip(files: Record<string, string>) {
  const local: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [name, contents] of Object.entries(files)) {
    const fileName = Buffer.from(name), raw = Buffer.from(contents), compressed = deflateRawSync(raw);
    const head = Buffer.alloc(30); head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(8, 8); head.writeUInt32LE(compressed.length, 18); head.writeUInt32LE(raw.length, 22); head.writeUInt16LE(fileName.length, 26);
    local.push(head, fileName, compressed);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(8, 10); directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(raw.length, 24); directory.writeUInt16LE(fileName.length, 28); directory.writeUInt32LE(offset, 42);
    central.push(directory, fileName);
    offset += head.length + fileName.length + compressed.length;
  }
  const directoryOffset = offset, directorySize = central.reduce((sum, item) => sum + item.length, 0), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(directorySize, 12); end.writeUInt32LE(directoryOffset, 16);
  return Buffer.concat([...local, ...central, end]);
}

test("parses shared-string and numeric XLSX cells", () => {
  const archive = zip({
    "xl/sharedStrings.xml": "<sst><si><t>Code</t></si><si><t>Opening Debit Paise</t></si><si><t>CASH</t></si></sst>",
    "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>12500</v></c></row></sheetData></worksheet>',
  });
  assert.deepEqual(parseSpreadsheetUpload(upload("accounts.xlsx", archive)), [{ Code: "CASH", "Opening Debit Paise": 12500 }]);
});

test("rejects unsupported and header-only files", () => {
  assert.throws(() => parseSpreadsheetUpload(upload("employees.txt", "a,b\n1,2")), /CSV, JSON, XLS, or XLSX/);
  assert.throws(() => parseSpreadsheetUpload(upload("employees.csv", "a,b\n")), /header row and at least one data row/);
});
