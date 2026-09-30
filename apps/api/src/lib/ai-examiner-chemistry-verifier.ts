export type ChemistryCheckStatus = "PASS" | "FAIL" | "REVIEW";

export type ChemistryCheck = {
  criterion: string;
  status: ChemistryCheckStatus;
  rationale: string;
  expected?: unknown;
  observed?: unknown;
};

export type ChemistryVerification = {
  checks: ChemistryCheck[];
  reviewRequired: true;
  parsed: boolean;
};

type ElementCounts = Map<string, number>;
type Species = { coefficient: number; formula: string; elements: ElementCounts };
type Equation = { left: Species[]; right: Species[] };

class ChemistryParseError extends Error {}

function stripState(formula: string) {
  return formula.trim().replace(/\((aq|s|l|g)\)$/i, "");
}

function mergeCounts(target: ElementCounts, source: ElementCounts, multiplier = 1) {
  for (const [element, count] of source) {
    target.set(element, (target.get(element) ?? 0) + count * multiplier);
  }
}

function parseNumber(formula: string, start: number) {
  let end = start;
  while (end < formula.length && /\d/.test(formula[end]!)) end++;
  if (end === start) return { value: 1, end };
  const value = Number(formula.slice(start, end));
  if (!Number.isInteger(value) || value <= 0) throw new ChemistryParseError("Formula multiplier must be a positive integer");
  return { value, end };
}

function parseFormulaGroup(formula: string, start = 0, untilClose = false): { counts: ElementCounts; end: number } {
  const counts: ElementCounts = new Map();
  let i = start;

  while (i < formula.length) {
    const ch = formula[i]!;
    if (ch === ")") {
      if (!untilClose) throw new ChemistryParseError("Unexpected closing parenthesis");
      return { counts, end: i };
    }

    if (ch === "(") {
      const nested = parseFormulaGroup(formula, i + 1, true);
      if (nested.end >= formula.length || formula[nested.end] !== ")") {
        throw new ChemistryParseError("Unclosed formula group");
      }
      const multiplier = parseNumber(formula, nested.end + 1);
      mergeCounts(counts, nested.counts, multiplier.value);
      i = multiplier.end;
      continue;
    }

    if (!/[A-Z]/.test(ch)) {
      throw new ChemistryParseError(`Unsupported formula token '${ch}'`);
    }

    let symbol = ch;
    if (i + 1 < formula.length && /[a-z]/.test(formula[i + 1]!)) {
      symbol += formula[i + 1]!;
      i++;
    }
    const multiplier = parseNumber(formula, i + 1);
    counts.set(symbol, (counts.get(symbol) ?? 0) + multiplier.value);
    i = multiplier.end;
  }

  if (untilClose) throw new ChemistryParseError("Unclosed formula group");
  return { counts, end: i };
}

function parseFormula(raw: string) {
  const formula = stripState(raw).replace(/\s+/g, "");
  if (!formula) throw new ChemistryParseError("Empty chemical formula");
  if (/[\[\]{}·.]/.test(formula) || /[+-]$/.test(formula) || /\^/.test(formula)) {
    throw new ChemistryParseError("Ionic charges, hydrates, bracket complexes or advanced notation require review");
  }
  const parsed = parseFormulaGroup(formula);
  if (parsed.end !== formula.length) throw new ChemistryParseError("Formula was not fully parsed");
  return { formula, elements: parsed.counts };
}

function parseSpecies(raw: string): Species {
  const token = raw.trim();
  const match = token.match(/^(\d+)?\s*(.+)$/);
  if (!match) throw new ChemistryParseError("Invalid reaction species");
  const coefficient = match[1] ? Number(match[1]) : 1;
  if (!Number.isInteger(coefficient) || coefficient <= 0) throw new ChemistryParseError("Stoichiometric coefficient must be a positive integer");
  const parsed = parseFormula(match[2]!);
  return { coefficient, formula: parsed.formula, elements: parsed.elements };
}

function splitEquation(raw: string) {
  const normalized = raw.replace(/⇌|↔/g, "->").replace(/→|⟶|=>/g, "->");
  const pieces = normalized.split("->");
  if (pieces.length !== 2) throw new ChemistryParseError("Equation must contain exactly one reaction arrow");
  return pieces as [string, string];
}

function parseSide(side: string) {
  const tokens = side.split("+").map(value => value.trim()).filter(Boolean);
  if (!tokens.length) throw new ChemistryParseError("Reaction side cannot be empty");
  return tokens.map(parseSpecies);
}

function parseEquation(raw: string): Equation {
  const [left, right] = splitEquation(raw);
  return { left: parseSide(left), right: parseSide(right) };
}

function sideCounts(species: Species[]) {
  const counts: ElementCounts = new Map();
  for (const item of species) mergeCounts(counts, item.elements, item.coefficient);
  return counts;
}

function countsObject(counts: ElementCounts) {
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function sameCounts(a: ElementCounts, b: ElementCounts) {
  const keys = new Set([...a.keys(), ...b.keys()]);
  for (const key of keys) if ((a.get(key) ?? 0) !== (b.get(key) ?? 0)) return false;
  return true;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a), y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x || 1;
}

function normalizeCoefficients(equation: Equation) {
  const all = [...equation.left, ...equation.right].map(item => item.coefficient);
  const divisor = all.reduce((current, value) => gcd(current, value), 0) || 1;
  const key = (side: "L" | "R", rows: Species[]) => rows
    .map(item => [`${side}:${item.formula}`, item.coefficient / divisor] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return [...key("L", equation.left), ...key("R", equation.right)];
}

function coefficientMap(equation: Equation) {
  return new Map(normalizeCoefficients(equation));
}

function stoichiometricallyEquivalent(a: Equation, b: Equation) {
  const left = coefficientMap(a), right = coefficientMap(b);
  if (left.size !== right.size) return false;
  for (const [key, value] of left) if (right.get(key) !== value) return false;
  return true;
}

function reverseEquation(equation: Equation): Equation {
  return { left: equation.right, right: equation.left };
}

function formulaSets(equation: Equation) {
  return {
    left: equation.left.map(item => item.formula).sort(),
    right: equation.right.map(item => item.formula).sort(),
  };
}

function sameFormulaSets(a: Equation, b: Equation) {
  const aa = formulaSets(a), bb = formulaSets(b);
  return JSON.stringify(aa) === JSON.stringify(bb);
}

export function verifyChemistryEquation(input: {
  response: string;
  expectedEquation?: string;
  requireBalanced?: boolean;
  allowReverse?: boolean;
}): ChemistryVerification {
  const checks: ChemistryCheck[] = [];
  let observed: Equation;
  try {
    observed = parseEquation(input.response);
  } catch (error) {
    return {
      parsed: false,
      reviewRequired: true,
      checks: [{
        criterion: "Equation parsing",
        status: "REVIEW",
        rationale: error instanceof Error ? error.message : "Chemical equation requires human review",
        observed: input.response,
      }],
    };
  }

  const left = sideCounts(observed.left);
  const right = sideCounts(observed.right);
  const balanced = sameCounts(left, right);
  if (input.requireBalanced ?? true) {
    checks.push({
      criterion: "Atom balance",
      status: balanced ? "PASS" : "FAIL",
      rationale: balanced
        ? "Element counts are balanced across the reaction arrow."
        : "Element counts are not balanced across the reaction arrow.",
      expected: countsObject(left),
      observed: countsObject(right),
    });
  }

  if (input.expectedEquation) {
    let expected: Equation;
    try {
      expected = parseEquation(input.expectedEquation);
    } catch {
      checks.push({
        criterion: "Reference equation",
        status: "REVIEW",
        rationale: "The configured reference equation uses notation outside the deterministic parser.",
        expected: input.expectedEquation,
        observed: input.response,
      });
      return { checks, reviewRequired: true, parsed: true };
    }

    const directSpecies = sameFormulaSets(observed, expected);
    const reverseSpecies = input.allowReverse ? sameFormulaSets(observed, reverseEquation(expected)) : false;
    if (!directSpecies && !reverseSpecies) {
      checks.push({
        criterion: "Reaction species",
        status: "FAIL",
        rationale: "The parsed reactant/product species do not match the configured reference reaction.",
        expected: formulaSets(expected),
        observed: formulaSets(observed),
      });
    } else {
      const target = directSpecies ? expected : reverseEquation(expected);
      const ratioMatch = stoichiometricallyEquivalent(observed, target);
      checks.push({
        criterion: "Stoichiometric ratio",
        status: ratioMatch ? "PASS" : "FAIL",
        rationale: ratioMatch
          ? "Stoichiometric coefficients match the configured reaction up to a common scale factor."
          : "Reaction species match, but the reduced stoichiometric coefficient ratio differs from the configured reaction.",
        expected: normalizeCoefficients(target),
        observed: normalizeCoefficients(observed),
      });
    }
  }

  return { checks, reviewRequired: true, parsed: true };
}

export const chemistryVerifierInternals = {
  parseFormula,
  parseEquation,
  sideCounts,
  normalizeCoefficients,
};
