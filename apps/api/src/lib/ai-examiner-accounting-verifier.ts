export type AccountingCheckStatus = "PASS" | "FAIL" | "REVIEW";

export type AccountingStatementFormat =
  | "TRIAL_BALANCE"
  | "LEDGER"
  | "JOURNAL"
  | "BALANCE_SHEET"
  | "INCOME_STATEMENT"
  | "OTHER";

export type AccountingExpectedRow = {
  label: string;
  required?: boolean;
  debit?: number;
  credit?: number;
  amount?: number;
  side?: "DEBIT" | "CREDIT" | "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE";
};

export type AccountingValidationConfig = {
  format: AccountingStatementFormat;
  requireBalanced?: boolean;
  tolerance?: number;
  caseSensitiveLabels?: boolean;
  expectedRows?: AccountingExpectedRow[];
  requiredHeadings?: string[];
};

export type AccountingCheck = {
  criterion: string;
  status: AccountingCheckStatus;
  rationale: string;
  expected?: unknown;
  observed?: unknown;
};

export type AccountingVerification = {
  parsed: boolean;
  reviewRequired: true;
  format: AccountingStatementFormat;
  checks: AccountingCheck[];
  totals: { debit: number | null; credit: number | null };
};

type AccountingRow = {
  label: string;
  debit?: number;
  credit?: number;
  amount?: number;
  side?: string;
};

type AccountingPayload = {
  rows: AccountingRow[];
  headings: string[];
};

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const normalized = value.replace(/,/g, "").trim();
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizeLabel(value: string, caseSensitive: boolean) {
  const normalized = value.trim().replace(/\s+/g, " ");
  return caseSensitive ? normalized : normalized.toLocaleLowerCase("en");
}

function parseRow(value: unknown): AccountingRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (typeof source.label !== "string" || !source.label.trim()) return null;
  const row: AccountingRow = { label: source.label.trim() };
  const debit = finiteNumber(source.debit);
  const credit = finiteNumber(source.credit);
  const amount = finiteNumber(source.amount);
  if (debit !== undefined) row.debit = debit;
  if (credit !== undefined) row.credit = credit;
  if (amount !== undefined) row.amount = amount;
  if (typeof source.side === "string" && source.side.trim()) row.side = source.side.trim().toUpperCase();
  return row;
}

function parsePayload(response: string): AccountingPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(response);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const source = parsed as Record<string, unknown>;
  if (!Array.isArray(source.rows)) return null;
  const rows = source.rows.map(parseRow);
  if (rows.some(row => row == null)) return null;
  const headings = Array.isArray(source.headings)
    ? source.headings.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map(value => value.trim())
    : [];
  return { rows: rows as AccountingRow[], headings };
}

function sumSide(rows: AccountingRow[], key: "debit" | "credit") {
  const values = rows.map(row => row[key]).filter((value): value is number => value !== undefined);
  if (!values.length) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) * 10000) / 10000;
}

function withinTolerance(observed: number, expected: number, tolerance: number) {
  return Math.abs(observed - expected) <= tolerance;
}

function rowNumericCheck(
  checks: AccountingCheck[],
  label: string,
  field: "debit" | "credit" | "amount",
  observed: number | undefined,
  expected: number | undefined,
  tolerance: number,
) {
  if (expected === undefined) return;
  if (observed === undefined) {
    checks.push({
      criterion: `Row ${label}: ${field}`,
      status: "FAIL",
      rationale: `The required ${field} value is missing from the structured response.`,
      expected,
      observed: null,
    });
    return;
  }
  const pass = withinTolerance(observed, expected, tolerance);
  checks.push({
    criterion: `Row ${label}: ${field}`,
    status: pass ? "PASS" : "FAIL",
    rationale: pass
      ? `The ${field} value is within the configured tolerance.`
      : `The ${field} value differs from the configured reference by more than the allowed tolerance.`,
    expected,
    observed,
  });
}

export function verifyAccountingStatement(input: {
  response: string;
  config: AccountingValidationConfig;
}): AccountingVerification {
  const tolerance = input.config.tolerance ?? 0.01;
  const payload = parsePayload(input.response);
  if (!payload) {
    return {
      parsed: false,
      reviewRequired: true,
      format: input.config.format,
      totals: { debit: null, credit: null },
      checks: [{
        criterion: "Structured accounting extraction",
        status: "REVIEW",
        rationale: "Accounting verification requires a valid JSON object with a rows array; unstructured or malformed extraction must be reviewed by a teacher.",
        observed: input.response,
      }],
    };
  }

  const checks: AccountingCheck[] = [];
  const debit = sumSide(payload.rows, "debit");
  const credit = sumSide(payload.rows, "credit");

  if (input.config.requireBalanced) {
    if (debit == null || credit == null) {
      checks.push({
        criterion: "Debit-credit balance",
        status: "REVIEW",
        rationale: "Debit and credit totals could not both be derived from the structured rows.",
        expected: "debit total = credit total",
        observed: { debit, credit },
      });
    } else {
      const pass = withinTolerance(debit, credit, tolerance);
      checks.push({
        criterion: "Debit-credit balance",
        status: pass ? "PASS" : "FAIL",
        rationale: pass
          ? "Debit and credit totals balance within the configured tolerance."
          : "Debit and credit totals do not balance within the configured tolerance.",
        expected: debit,
        observed: credit,
      });
    }
  }

  const caseSensitive = input.config.caseSensitiveLabels ?? false;
  const rowMap = new Map<string, AccountingRow>();
  for (const row of payload.rows) {
    const key = normalizeLabel(row.label, caseSensitive);
    if (!rowMap.has(key)) rowMap.set(key, row);
  }

  for (const expected of input.config.expectedRows ?? []) {
    const row = rowMap.get(normalizeLabel(expected.label, caseSensitive));
    if (!row) {
      checks.push({
        criterion: `Required row: ${expected.label}`,
        status: expected.required === false ? "REVIEW" : "FAIL",
        rationale: expected.required === false
          ? "The optional reference row was not found; no automatic deduction should be made."
          : "A configured required accounting row was not found.",
        expected,
        observed: null,
      });
      continue;
    }

    checks.push({
      criterion: `Row present: ${expected.label}`,
      status: "PASS",
      rationale: "The configured accounting row was found.",
      expected: expected.label,
      observed: row.label,
    });
    rowNumericCheck(checks, expected.label, "debit", row.debit, expected.debit, tolerance);
    rowNumericCheck(checks, expected.label, "credit", row.credit, expected.credit, tolerance);
    rowNumericCheck(checks, expected.label, "amount", row.amount, expected.amount, tolerance);

    if (expected.side) {
      if (!row.side) {
        checks.push({
          criterion: `Row ${expected.label}: side`,
          status: "FAIL",
          rationale: "The configured account-side classification is missing.",
          expected: expected.side,
          observed: null,
        });
      } else {
        const pass = row.side === expected.side;
        checks.push({
          criterion: `Row ${expected.label}: side`,
          status: pass ? "PASS" : "FAIL",
          rationale: pass
            ? "The account-side classification matches the configured reference."
            : "The account-side classification differs from the configured reference.",
          expected: expected.side,
          observed: row.side,
        });
      }
    }
  }

  const headingSet = new Set(payload.headings.map(value => normalizeLabel(value, caseSensitive)));
  for (const heading of input.config.requiredHeadings ?? []) {
    const found = headingSet.has(normalizeLabel(heading, caseSensitive));
    checks.push({
      criterion: `Heading: ${heading}`,
      status: found ? "PASS" : "FAIL",
      rationale: found ? "The required statement heading is present." : "The required statement heading is missing.",
      expected: heading,
      observed: payload.headings,
    });
  }

  if (!checks.length) {
    checks.push({
      criterion: "Structured accounting extraction",
      status: "REVIEW",
      rationale: "The response is structurally valid, but no deterministic accounting checks were configured.",
      observed: { rows: payload.rows.length, headings: payload.headings.length },
    });
  }

  return {
    parsed: true,
    reviewRequired: true,
    format: input.config.format,
    totals: { debit, credit },
    checks,
  };
}

export const accountingVerifierInternals = {
  parsePayload,
  normalizeLabel,
  finiteNumber,
};
