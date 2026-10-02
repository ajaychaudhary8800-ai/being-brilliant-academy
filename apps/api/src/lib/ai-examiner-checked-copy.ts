import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const RED = "#d11a2a";
const DPI = 144;
const MAX_PAGES = 60;
const MAX_SOURCE_BYTES = 14 * 1024 * 1024;

export type CheckedCopyHint = {
  kind: "TICK" | "CROSS" | "UNDERLINE" | "HIGHLIGHT" | "NOTE";
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string | null;
};

export type CheckedCopyQuestion = {
  questionKey: string;
  maxMarks: number;
  finalMarks: number;
  teacherComment?: string | null;
  feedback?: string | null;
};

export type CheckedCopyInput = {
  source: {
    fileName: string;
    mimeType: string;
    bytes: Buffer;
  };
  studentName: string;
  examinationName: string;
  questions: CheckedCopyQuestion[];
  diagnostics?: unknown;
  totalMarks: number;
  maximumMarks: number;
  reviewerName?: string | null;
  evaluationRevision: number;
};

export type CheckedCopyRenderResult = {
  pdf: Buffer;
  placement: "EXACT" | "MIXED" | "APPROXIMATE";
  pageCount: number;
  exactHintCount: number;
};

type PageRaster = {
  sourcePath: string;
  width: number;
  height: number;
};

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function xml(value: string) {
  return value.replace(/[<>&"']/g, character => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
    "'": "&apos;",
  })[character]!);
}

function compact(value: string | null | undefined, maximum = 120) {
  if (!value) return "";
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maximum ? normalized : normalized.slice(0, maximum - 1).trimEnd() + "…";
}

function wrap(value: string, maxCharacters: number, maxLines: number) {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const proposed = current ? current + " " + word : word;
    if (proposed.length <= maxCharacters) current = proposed;
    else {
      if (current) lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    lines[maxLines - 1] = lines[maxLines - 1]!.replace(/…?$/, "…");
  }
  return lines;
}

function annotationHintsByQuestion(diagnostics: unknown) {
  const result = new Map<string, CheckedCopyHint[]>();
  if (!diagnostics || typeof diagnostics !== "object" || Array.isArray(diagnostics)) return result;
  const questionDiagnostics = (diagnostics as Record<string, unknown>).questionDiagnostics;
  if (!Array.isArray(questionDiagnostics)) return result;
  for (const item of questionDiagnostics) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.questionKey !== "string" || !Array.isArray(record.annotationHints)) continue;
    const hints: CheckedCopyHint[] = [];
    for (const raw of record.annotationHints) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const hint = raw as Record<string, unknown>;
      if (!["TICK","CROSS","UNDERLINE","HIGHLIGHT","NOTE"].includes(String(hint.kind))) continue;
      const pageNumber = Number(hint.pageNumber);
      const x = Number(hint.x), y = Number(hint.y), width = Number(hint.width), height = Number(hint.height);
      if (![pageNumber,x,y,width,height].every(Number.isFinite) || pageNumber < 1) continue;
      hints.push({
        kind: hint.kind as CheckedCopyHint["kind"],
        pageNumber: Math.trunc(pageNumber),
        x: clamp(x), y: clamp(y), width: clamp(width), height: clamp(height),
        text: typeof hint.text === "string" ? compact(hint.text, 240) : null,
      });
    }
    if (hints.length) result.set(record.questionKey.toLocaleLowerCase("en"), hints);
  }
  return result;
}

async function command(file: string, args: string[]) {
  try {
    return await execFileAsync(file, args, {
      timeout: 45_000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Checked-copy renderer command failed (${file}): ${detail}`);
  }
}

async function dimensions(filePath: string) {
  const { stdout } = await command("magick", ["identify", "-format", "%w %h", filePath]);
  const [width, height] = stdout.trim().split(/\s+/).map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width! <= 0 || height! <= 0) {
    throw new Error("Unable to determine checked-copy page dimensions");
  }
  return { width: width!, height: height! };
}

function pageNumber(fileName: string) {
  const match = fileName.match(/(\d+)(?=\.[^.]+$)/);
  return match ? Number(match[1]) : 0;
}

async function rasterizeSource(input: CheckedCopyInput["source"], directory: string): Promise<PageRaster[]> {
  if (input.bytes.length > MAX_SOURCE_BYTES) throw new Error("Answer sheet exceeds checked-copy rendering size limit");
  const extension = input.mimeType === "application/pdf"
    ? ".pdf"
    : input.mimeType === "image/png"
      ? ".png"
      : input.mimeType === "image/webp"
        ? ".webp"
        : ".jpg";
  const sourcePath = path.join(directory, "source" + extension);
  await writeFile(sourcePath, input.bytes);

  let pageFiles: string[] = [];
  if (input.mimeType === "application/pdf") {
    const prefix = path.join(directory, "page");
    await command("pdftoppm", ["-png", "-r", String(DPI), "-f", "1", "-l", String(MAX_PAGES), sourcePath, prefix]);
    pageFiles = (await readdir(directory))
      .filter(name => /^page-\d+\.png$/i.test(name))
      .sort((left, right) => pageNumber(left) - pageNumber(right))
      .map(name => path.join(directory, name));
  } else if (["image/jpeg","image/png","image/webp"].includes(input.mimeType)) {
    const target = path.join(directory, "page-1.png");
    await command("magick", [sourcePath, "-auto-orient", target]);
    pageFiles = [target];
  } else {
    throw new Error(`Checked-copy rendering does not support ${input.mimeType}`);
  }

  if (!pageFiles.length) throw new Error("Answer sheet produced no renderable pages");
  if (pageFiles.length > MAX_PAGES) throw new Error(`Checked-copy rendering supports at most ${MAX_PAGES} pages`);
  return Promise.all(pageFiles.map(async sourcePath => ({ sourcePath, ...await dimensions(sourcePath) })));
}

function hintSvg(hint: CheckedCopyHint, page: PageRaster) {
  const x = clamp(hint.x) * page.width;
  const y = clamp(hint.y) * page.height;
  const width = Math.max(8, clamp(hint.width) * page.width);
  const height = Math.max(8, clamp(hint.height) * page.height);
  const stroke = Math.max(3, Math.round(page.width / 420));
  if (hint.kind === "HIGHLIGHT") {
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="6" fill="${RED}" fill-opacity=".14" stroke="${RED}" stroke-opacity=".55" stroke-width="${stroke}"/>`;
  }
  if (hint.kind === "UNDERLINE") {
    return `<path d="M ${x} ${y + height} Q ${x + width * .5} ${y + height + stroke * 2} ${x + width} ${y + height}" fill="none" stroke="${RED}" stroke-width="${stroke}" stroke-linecap="round"/>`;
  }
  if (hint.kind === "CROSS") {
    const size = Math.max(22, Math.min(width, height, page.width * .045));
    return `<g stroke="${RED}" stroke-width="${stroke + 1}" stroke-linecap="round"><path d="M ${x} ${y} L ${x + size} ${y + size}"/><path d="M ${x + size} ${y} L ${x} ${y + size}"/></g>`;
  }
  if (hint.kind === "TICK") {
    const size = Math.max(28, Math.min(Math.max(width, height), page.width * .06));
    return `<path d="M ${x} ${y + size * .55} L ${x + size * .32} ${y + size} L ${x + size} ${y}" fill="none" stroke="${RED}" stroke-width="${stroke + 2}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  const text = xml(compact(hint.text || "Check", 80));
  return `<g transform="rotate(-2 ${x} ${y})"><text x="${x}" y="${y}" fill="${RED}" font-family="DejaVu Sans" font-style="italic" font-weight="700" font-size="${Math.max(22, page.width * .024)}">${text}</text></g>`;
}

function marginCallout(question: CheckedCopyQuestion, page: PageRaster, slot: number) {
  const boxWidth = page.width * .34;
  const boxHeight = Math.max(100, page.height * .09);
  const x = page.width - boxWidth - page.width * .025;
  const y = page.height * .09 + slot * (boxHeight + page.height * .015);
  const font = Math.max(20, page.width * .021);
  const final = `${question.questionKey}: ${question.finalMarks}/${question.maxMarks}`;
  const note = compact(question.teacherComment || (question.finalMarks < question.maxMarks ? question.feedback : ""), 130);
  const lines = wrap(note, 40, 2);
  const tickOrCross = question.finalMarks >= question.maxMarks - 0.001
    ? `<path d="M ${x + 18} ${y + 36} L ${x + 34} ${y + 52} L ${x + 64} ${y + 18}" fill="none" stroke="${RED}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<circle cx="${x + 38}" cy="${y + 36}" r="25" fill="none" stroke="${RED}" stroke-width="5"/>`;
  const noteSvg = lines.map((line, index) => `<text x="${x + 18}" y="${y + 73 + index * (font + 2)}" fill="${RED}" font-family="DejaVu Sans" font-style="italic" font-size="${font * .75}">${xml(line)}</text>`).join("");
  return `<g transform="rotate(${slot % 2 ? 1 : -1} ${x + boxWidth / 2} ${y + boxHeight / 2})"><rect x="${x}" y="${y}" width="${boxWidth}" height="${boxHeight}" rx="14" fill="white" fill-opacity=".82" stroke="${RED}" stroke-width="3"/>${tickOrCross}<text x="${x + 78}" y="${y + 45}" fill="${RED}" font-family="DejaVu Sans" font-style="italic" font-weight="700" font-size="${font}">${xml(final)}</text>${noteSvg}</g>`;
}

function overlaySvg(input: CheckedCopyInput, page: PageRaster, pageIndex: number, pages: PageRaster[], hintsByQuestion: Map<string, CheckedCopyHint[]>) {
  const elements: string[] = [];
  let exactOnPage = 0;
  input.questions.forEach((question, questionIndex) => {
    const hints = (hintsByQuestion.get(question.questionKey.toLocaleLowerCase("en")) ?? []).filter(hint => hint.pageNumber === pageIndex + 1);
    if (hints.length) {
      exactOnPage += hints.length;
      elements.push(...hints.map(hint => hintSvg(hint, page)));
      const first = hints[0]!;
      const x = Math.min(page.width * .82, clamp(first.x + first.width + .01) * page.width);
      const y = Math.max(34, clamp(first.y) * page.height);
      elements.push(`<g transform="rotate(-2 ${x} ${y})"><text x="${x}" y="${y}" fill="${RED}" font-family="DejaVu Sans" font-style="italic" font-weight="700" font-size="${Math.max(23, page.width * .023)}">${xml(question.questionKey)} ${question.finalMarks}/${question.maxMarks}</text></g>`);
    } else {
      const fallbackPage = Math.min(questionIndex, pages.length - 1);
      if (fallbackPage === pageIndex) elements.push(marginCallout(question, page, questionIndex % 6));
    }
  });

  if (pageIndex === pages.length - 1) {
    const x = page.width * .7, y = page.height * .035, width = page.width * .27, height = page.height * .065;
    elements.push(`<g transform="rotate(-2 ${x + width / 2} ${y + height / 2})"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="18" fill="white" fill-opacity=".9" stroke="${RED}" stroke-width="5"/><text x="${x + 18}" y="${y + height * .67}" fill="${RED}" font-family="DejaVu Sans" font-style="italic" font-weight="700" font-size="${Math.max(27, page.width * .03)}">Total ${input.totalMarks}/${input.maximumMarks}</text></g>`);
  }

  const footer = `AI-assisted red-pen layer • final marks teacher-approved${input.reviewerName ? " by " + input.reviewerName : ""} • revision ${input.evaluationRevision}`;
  elements.push(`<rect x="0" y="${page.height - 38}" width="${page.width}" height="38" fill="white" fill-opacity=".82"/><text x="18" y="${page.height - 12}" fill="#5b6472" font-family="DejaVu Sans" font-size="${Math.max(14, page.width * .012)}">${xml(footer)}</text>`);

  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}" height="${page.height}" viewBox="0 0 ${page.width} ${page.height}"><g>${elements.join("")}</g></svg>`,
    exactOnPage,
  };
}

type JpegPage = { bytes: Buffer; width: number; height: number };

function makePdfObject(id: number, body: Buffer | string) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body, "binary");
  return Buffer.concat([Buffer.from(`${id} 0 obj\n`, "binary"), payload, Buffer.from("\nendobj\n", "binary")]);
}

function pdfFromJpegs(pages: JpegPage[]) {
  const objectCount = 2 + pages.length * 3;
  const objects = new Array<Buffer>(objectCount + 1);
  const pageIds = pages.map((_, index) => 3 + index * 3);
  objects[1] = makePdfObject(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objects[2] = makePdfObject(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] >>`);

  pages.forEach((page, index) => {
    const pageId = 3 + index * 3;
    const imageId = pageId + 1;
    const contentId = pageId + 2;
    const widthPoints = page.width * 72 / DPI;
    const heightPoints = page.height * 72 / DPI;
    const content = `q\n${widthPoints.toFixed(3)} 0 0 ${heightPoints.toFixed(3)} 0 0 cm\n/Im0 Do\nQ\n`;
    objects[pageId] = makePdfObject(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPoints.toFixed(3)} ${heightPoints.toFixed(3)}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects[imageId] = makePdfObject(imageId, Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.length} >>\nstream\n`, "binary"),
      page.bytes,
      Buffer.from("\nendstream", "binary"),
    ]));
    objects[contentId] = makePdfObject(contentId, `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`);
  });

  const header = Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "binary");
  const chunks: Buffer[] = [header];
  const offsets = new Array<number>(objectCount + 1).fill(0);
  let position = header.length;
  for (let id = 1; id <= objectCount; id += 1) {
    offsets[id] = position;
    chunks.push(objects[id]!);
    position += objects[id]!.length;
  }
  const xrefOffset = position;
  const xref = [
    `xref\n0 ${objectCount + 1}\n`,
    "0000000000 65535 f \n",
    ...offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  ].join("");
  chunks.push(Buffer.from(xref, "binary"));
  return Buffer.concat(chunks);
}

export async function renderAIExaminerCheckedCopy(input: CheckedCopyInput): Promise<CheckedCopyRenderResult> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bba-checked-copy-"));
  try {
    const pages = await rasterizeSource(input.source, directory);
    const hintsByQuestion = annotationHintsByQuestion(input.diagnostics);
    let exactHintCount = 0;
    const rendered: JpegPage[] = [];

    for (const [index, page] of pages.entries()) {
      const overlay = overlaySvg(input, page, index, pages, hintsByQuestion);
      exactHintCount += overlay.exactOnPage;
      const overlayPath = path.join(directory, `overlay-${index + 1}.svg`);
      const outputPath = path.join(directory, `checked-${String(index + 1).padStart(3, "0")}.jpg`);
      await writeFile(overlayPath, overlay.svg, "utf8");
      await command("magick", [
        page.sourcePath,
        overlayPath,
        "-compose", "over",
        "-composite",
        "-colorspace", "sRGB",
        "-strip",
        "-quality", "88",
        outputPath,
      ]);
      rendered.push({ bytes: await readFile(outputPath), width: page.width, height: page.height });
    }

    const questionsWithHints = input.questions.filter(question => (hintsByQuestion.get(question.questionKey.toLocaleLowerCase("en")) ?? []).length > 0).length;
    const placement = exactHintCount === 0
      ? "APPROXIMATE"
      : questionsWithHints === input.questions.length
        ? "EXACT"
        : "MIXED";

    return {
      pdf: pdfFromJpegs(rendered),
      placement,
      pageCount: rendered.length,
      exactHintCount,
    };
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}
