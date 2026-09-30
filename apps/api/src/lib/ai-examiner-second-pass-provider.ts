import { env } from "../config.js";
import {
  AIExaminerProviderError,
  parseAIExaminerProviderText,
  validateAIExaminerResultAgainstRubric,
  type AIExaminerDocument,
  type AIExaminerProviderInput,
  type AIExaminerProviderResult,
} from "./ai-examiner-engine.js";

function dataUrl(document: AIExaminerDocument) {
  return `data:${document.mimeType};base64,${document.bytes.toString("base64")}`;
}

function responseDocumentPart(document: AIExaminerDocument) {
  if (["image/jpeg", "image/png", "image/webp"].includes(document.mimeType)) {
    return { type: "input_image", image_url: dataUrl(document), detail: "high" };
  }
  if (document.mimeType === "application/pdf") {
    return { type: "input_file", filename: document.fileName, file_data: dataUrl(document) };
  }
  throw new AIExaminerProviderError("AI_EXAMINER_SECOND_PASS_UNSUPPORTED_DOCUMENT", `Independent verifier does not support ${document.mimeType}`);
}

function chatDocumentPart(document: AIExaminerDocument) {
  if (["image/jpeg", "image/png", "image/webp"].includes(document.mimeType)) {
    return { type: "image_url", image_url: { url: dataUrl(document), detail: "high" } };
  }
  throw new AIExaminerProviderError(
    "AI_EXAMINER_SECOND_PASS_PDF_REQUIRES_RESPONSES_API",
    "Independent verification of PDF answer sheets requires a Responses-compatible file-input endpoint.",
  );
}

function extractText(json: any) {
  const chat = json?.choices?.[0]?.message?.content;
  if (typeof chat === "string" && chat.trim()) return chat;
  if (Array.isArray(chat)) {
    const joined = chat.map((part: any) => typeof part?.text === "string" ? part.text : "").join("").trim();
    if (joined) return joined;
  }
  if (typeof json?.output_text === "string" && json.output_text.trim()) return json.output_text;
  if (Array.isArray(json?.output)) {
    const joined = json.output.flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
      .map((part: any) => typeof part?.text === "string" ? part.text : typeof part?.output_text === "string" ? part.output_text : "")
      .join("").trim();
    if (joined) return joined;
  }
  throw new AIExaminerProviderError("AI_EXAMINER_SECOND_PASS_EMPTY_RESPONSE", "Independent verifier returned no content");
}

function verificationPrompt(input: AIExaminerProviderInput) {
  return [
    "Independently evaluate the attached student answer sheet against the attached question paper and rubric.",
    "Do not assume the primary evaluator was correct. Do not try to agree with another model.",
    "Return ONLY valid JSON with exactly the same schema expected by Ranpal AI Examiner.",
    "Be conservative. Preserve original-language evidence. Flag ambiguity rather than inventing evidence.",
    "For deterministic/objective questions, extract the student answer accurately; downstream code will score it.",
    "For programming questions, extract source code only; do not award marks from imagined execution.",
    "",
    "ASSESSMENT:",
    JSON.stringify(input.examination),
    "",
    "RUBRIC QUESTIONS:",
    JSON.stringify(input.questions),
    "",
    input.instructions ? `INSTRUCTIONS:\n${input.instructions}` : "",
  ].filter(Boolean).join("\n");
}

export function independentAIExaminerProviderConfigured() {
  return Boolean(
    env.AI_EXAMINER_SECOND_PASS_PROVIDER_URL &&
    env.AI_EXAMINER_SECOND_PASS_API_KEY &&
    env.AI_EXAMINER_SECOND_PASS_MODEL
  );
}

export async function evaluateWithIndependentAIExaminerProvider(
  input: AIExaminerProviderInput,
): Promise<AIExaminerProviderResult> {
  const url = env.AI_EXAMINER_SECOND_PASS_PROVIDER_URL;
  const apiKey = env.AI_EXAMINER_SECOND_PASS_API_KEY;
  const model = env.AI_EXAMINER_SECOND_PASS_MODEL;
  if (!url || !apiKey || !model) {
    throw new AIExaminerProviderError(
      "AI_EXAMINER_SECOND_PASS_PROVIDER_NOT_CONFIGURED",
      "Independent AI Examiner verification provider is not configured",
    );
  }

  const responsesMode = /\/responses\/?(?:\?|$)/i.test(url);
  const prompt = verificationPrompt(input);
  const body = responsesMode ? {
    model,
    input: [
      {
        role: "system",
        content: [{
          type: "input_text",
          text: "You are an independent academic verification evaluator. Return only valid JSON and do not anchor to any primary score.",
        }],
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: prompt + "\n\nQUESTION PAPER:" },
          responseDocumentPart(input.questionPaper),
          { type: "input_text", text: "\n\nSTUDENT ANSWER SHEET:" },
          responseDocumentPart(input.answerSheet),
        ],
      },
    ],
  } : {
    model,
    messages: [
      {
        role: "system",
        content: "You are an independent academic verification evaluator. Return only valid JSON and do not anchor to any primary score.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: prompt + "\n\nQUESTION PAPER:" },
          chatDocumentPart(input.questionPaper),
          { type: "text", text: "\n\nSTUDENT ANSWER SHEET:" },
          chatDocumentPart(input.answerSheet),
        ],
      },
    ],
    temperature: 0,
    response_format: { type: "json_object" },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.AI_EXAMINER_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new AIExaminerProviderError(
        "AI_EXAMINER_SECOND_PASS_PROVIDER_ERROR",
        `Independent verifier returned HTTP ${response.status}: ${raw.slice(0, 1000)}`,
      );
    }
    let json: unknown;
    try { json = JSON.parse(raw); }
    catch {
      throw new AIExaminerProviderError(
        "AI_EXAMINER_SECOND_PASS_PROVIDER_INVALID_RESPONSE",
        "Independent verifier returned a non-JSON transport response",
      );
    }
    return validateAIExaminerResultAgainstRubric(
      parseAIExaminerProviderText(extractText(json)),
      input.questions,
      input.examination.maximumMarks,
    );
  } catch (error) {
    if (error instanceof AIExaminerProviderError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new AIExaminerProviderError("AI_EXAMINER_SECOND_PASS_PROVIDER_TIMEOUT", "Independent verification timed out");
    }
    throw new AIExaminerProviderError(
      "AI_EXAMINER_SECOND_PASS_PROVIDER_UNAVAILABLE",
      error instanceof Error ? error.message : "Independent verifier request failed",
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function independentAIExaminerProviderReadiness() {
  return {
    configured: independentAIExaminerProviderConfigured(),
    endpointSeparatedFromPrimary:
      Boolean(env.AI_EXAMINER_SECOND_PASS_PROVIDER_URL) &&
      env.AI_EXAMINER_SECOND_PASS_PROVIDER_URL !== env.AI_EXAMINER_PROVIDER_URL,
    modelSeparatedFromPrimary:
      Boolean(env.AI_EXAMINER_SECOND_PASS_MODEL) &&
      env.AI_EXAMINER_SECOND_PASS_MODEL !== env.AI_EXAMINER_MODEL,
  };
}
