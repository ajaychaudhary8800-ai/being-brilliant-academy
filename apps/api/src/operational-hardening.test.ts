import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertLibraryResourceFileExtension, decodeVerifiedLibraryResource } from "./lib/secure-upload.js";

test("library resources use verified PDF/EPUB uploads", () => {
  const pdf = Buffer.from("%PDF-1.7\nresource").toString("base64");
  const makeEpubEntry = (fileName = "mimetype", content = "application/epub+zip", compression = 0) => {
    const name = Buffer.from(fileName, "utf8");
    const payload = Buffer.from(content, "ascii");
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(compression, 8);
    header.writeUInt32LE(payload.length, 18);
    header.writeUInt32LE(payload.length, 22);
    header.writeUInt16LE(name.length, 26);
    return Buffer.concat([header, name, payload]);
  };
  const epubBytes = makeEpubEntry();
  assert.doesNotThrow(() => assertLibraryResourceFileExtension("resource.pdf", "application/pdf"));
  assert.deepEqual(decodeVerifiedLibraryResource(pdf, "application/pdf"), Buffer.from("%PDF-1.7\nresource"));
  assert.doesNotThrow(() => assertLibraryResourceFileExtension("book.epub", "application/epub+zip"));
  assert.deepEqual(decodeVerifiedLibraryResource(epubBytes.toString("base64"), "application/epub+zip"), epubBytes);
  assert.throws(() => assertLibraryResourceFileExtension("resource.exe", "application/pdf"), /extension/);
  assert.throws(() => decodeVerifiedLibraryResource(Buffer.from("not a PDF").toString("base64"), "application/pdf"), /declared file type/);
  for (const invalid of [makeEpubEntry("content"), makeEpubEntry("mimetype", "application/epub+zip", 8), makeEpubEntry("mimetype", "text/plain"), epubBytes.subarray(0, 20)]) {
    assert.throws(() => decodeVerifiedLibraryResource(invalid.toString("base64"), "application/epub+zip"), /declared file type/);
  }
  assert.throws(() => decodeVerifiedLibraryResource("%%%", "application/pdf"), /base64/);
  assert.throws(() => decodeVerifiedLibraryResource(Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(11)]).toString("base64"), "application/pdf", 10), /between .* byte/i);
});

test("finance, library and HR document routes use shared validation and safe downloads", async () => {
  const [finance, library, hr] = await Promise.all([
    readFile(new URL("./routes/finance.ts", import.meta.url), "utf8"),
    readFile(new URL("./routes/library.ts", import.meta.url), "utf8"),
    readFile(new URL("./routes/hr-payroll.ts", import.meta.url), "utf8"),
  ]);
  assert.match(finance, /assertDocumentFileExtension\(data\.attachment\.name/);
  assert.match(finance, /decodeVerifiedUpload\(data\.attachment\.base64/);
  assert.match(finance, /storedDocumentHeaders/);
  assert.match(library, /assertLibraryResourceFileExtension/);
  assert.match(library, /decodeVerifiedLibraryResource/);
  assert.match(library, /storedDocumentHeaders/);
  assert.match(hr, /assertDocumentFileExtension\(d\.name/);
  assert.match(hr, /decodeVerifiedUpload\(d\.base64/);
  assert.match(hr, /await access\(r,d\.employee\.branchId\)/);
  assert.match(hr, /storedDocumentHeaders/);
});
