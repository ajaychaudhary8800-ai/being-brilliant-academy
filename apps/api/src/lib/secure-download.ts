export type StoredDocumentMetadata = {
  fileName: string;
  mimeType: string;
  fileSize: number;
  fallbackName?: string;
};

const extensionsByMimeType: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

function fallbackFileName(metadata: StoredDocumentMetadata) {
  const base = metadata.fallbackName?.replace(/[^A-Za-z0-9_-]/g, "") || "document";
  const extension = extensionsByMimeType[metadata.mimeType];
  return extension ? `${base}.${extension}` : base;
}

function safeFileName(metadata: StoredDocumentMetadata) {
  const sanitized = metadata.fileName
    .replace(/[\u0000-\u001f\u007f"\\\/:*?<>|;]/g, "_")
    .trim()
    .replace(/^[. ]+|[. ]+$/g, "")
    .replace(/\.{2,}/g, "_")
    .replace(/_+/g, "_");
  return !sanitized || /^[._-]+$/u.test(sanitized) ? fallbackFileName(metadata) : sanitized;
}

export function storedDocumentHeaders(metadata: StoredDocumentMetadata, disposition: "attachment" | "inline") {
  return {
    "Content-Type": metadata.mimeType,
    "Content-Length": String(metadata.fileSize),
    "Content-Disposition": `${disposition}; filename="${safeFileName(metadata)}"`,
  };
}

export function storedDocumentBuffer(data: Uint8Array) {
  return Buffer.from(data);
}

export async function loadAuthorizedDocument<T>(authorize: () => void | Promise<void>, load: () => Promise<T>) {
  await authorize();
  return load();
}
