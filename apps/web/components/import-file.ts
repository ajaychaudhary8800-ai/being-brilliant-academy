const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export async function importFilePayload(file: File) {
  if (!file.size || file.size > MAX_IMPORT_BYTES) throw new Error("Import files must be between 1 byte and 5 MB");
  if (!/\.(csv|json|xls|xlsx)$/i.test(file.name)) throw new Error("Use a CSV, JSON, XLS, or XLSX file");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return { name: file.name, base64: btoa(binary) };
}
