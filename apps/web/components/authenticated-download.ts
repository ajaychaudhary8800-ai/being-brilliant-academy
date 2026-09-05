export type AuthenticatedDocument = {
  blob: Blob;
  contentType: string;
  fileName: string;
};

type DownloadResponse = Pick<Response, "ok" | "headers" | "json" | "blob">;

function safeFileName(value: string) {
  return value.replace(/["\r\n\\/]/g, "_");
}

function responseFileName(disposition: string | null, fallback: string) {
  if (!disposition) return safeFileName(fallback);
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try { return safeFileName(decodeURIComponent(encoded)); } catch { /* use the regular filename */ }
  }
  return safeFileName(disposition.match(/filename="([^"]+)"/i)?.[1] ?? fallback);
}

export function canPreviewDocument(contentType: string) {
  return contentType === "application/pdf" || contentType === "image/jpeg" || contentType === "image/png";
}

export async function readAuthenticatedDocumentResponse(response: DownloadResponse, fallbackName: string, fallbackError: string): Promise<AuthenticatedDocument> {
  if (!response.ok) {
    const value = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(value?.error?.message ?? fallbackError);
  }
  const blob = await response.blob();
  if (!blob.size) throw new Error(fallbackError);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim() || blob.type || "application/octet-stream";
  return { blob, contentType, fileName: responseFileName(response.headers.get("content-disposition"), fallbackName) };
}

export async function openAuthenticatedDocument(options: { url: string; token: string; fileName: string; fallbackError: string }) {
  const extensionCanPreview = /\.(pdf|jpe?g|png)$/i.test(options.fileName);
  const preview = extensionCanPreview ? window.open("", "_blank") : null;
  if (preview) preview.opener = null;
  try {
    const response = await fetch(options.url, { headers: { Authorization: `Bearer ${options.token}` } });
    const documentFile = await readAuthenticatedDocumentResponse(response, options.fileName, options.fallbackError);
    const objectUrl = URL.createObjectURL(documentFile.blob);
    if (preview && canPreviewDocument(documentFile.contentType)) {
      preview.location.replace(objectUrl);
    } else {
      preview?.close();
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = documentFile.fileName;
      anchor.rel = "noopener noreferrer";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    }
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch (cause) {
    preview?.close();
    throw cause;
  }
}
