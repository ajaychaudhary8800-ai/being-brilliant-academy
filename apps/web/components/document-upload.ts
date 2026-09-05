export const maximumDocumentBytes = 10 * 1024 * 1024;

const questionPaperTypes: Record<string, readonly string[]> = {
  "application/pdf": ["pdf"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "application/msword": ["doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
};
const answerSheetTypes = Object.fromEntries(
  Object.entries(questionPaperTypes).filter(([mimeType]) => ["application/pdf", "image/jpeg", "image/png"].includes(mimeType)),
);

export function validateDocumentFile(file: File, purpose: "question-paper" | "answer-sheet" | "leave-attachment" | "homework") {
  const acceptsOfficeDocument = purpose === "question-paper" || purpose === "homework";
  const allowed = acceptsOfficeDocument ? questionPaperTypes : answerSheetTypes;
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  if (!allowed[file.type] || !allowed[file.type].includes(extension)) {
    return acceptsOfficeDocument
      ? "Choose a PDF, JPG, JPEG, PNG, DOC or DOCX file with a matching extension."
      : "Choose a PDF, JPG, JPEG or PNG file with a matching extension.";
  }
  if (!file.size) return "The selected document is empty.";
  const maximumBytes = purpose === "leave-attachment" || purpose === "homework" ? 5 * 1024 * 1024 : maximumDocumentBytes;
  if (file.size > maximumBytes) return `Document size must not exceed ${maximumBytes / 1024 / 1024} MB.`;
  return null;
}

export function documentAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Unable to read the selected document"));
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
}
