import assert from "node:assert/strict";
import test from "node:test";
import { chemistryVerifierInternals, verifyChemistryEquation } from "./ai-examiner-chemistry-verifier.js";

test("chemistry verifier confirms balanced equations and reduced stoichiometric ratios", () => {
  const result = verifyChemistryEquation({
    response: "4H2 + 2O2 -> 4H2O",
    expectedEquation: "2H2 + O2 -> 2H2O",
  });
  assert.equal(result.parsed, true);
  assert.equal(result.reviewRequired, true);
  assert.equal(result.checks.find(row => row.criterion === "Atom balance")?.status, "PASS");
  assert.equal(result.checks.find(row => row.criterion === "Stoichiometric ratio")?.status, "PASS");
});

test("chemistry verifier flags atom imbalance deterministically", () => {
  const result = verifyChemistryEquation({
    response: "H2 + O2 -> H2O",
  });
  assert.equal(result.checks[0]?.criterion, "Atom balance");
  assert.equal(result.checks[0]?.status, "FAIL");
});

test("chemistry verifier supports parenthesized molecular formulae", () => {
  const formula = chemistryVerifierInternals.parseFormula("Ca(OH)2");
  assert.deepEqual(Object.fromEntries(formula.elements), { Ca: 1, O: 2, H: 2 });
});

test("chemistry verifier does not auto-grade unsupported ionic or hydrate notation", () => {
  const ionic = verifyChemistryEquation({
    response: "Ag+ + Cl- -> AgCl",
  });
  assert.equal(ionic.parsed, false);
  assert.equal(ionic.checks[0]?.status, "REVIEW");

  const hydrate = verifyChemistryEquation({
    response: "CuSO4·5H2O -> CuSO4 + 5H2O",
  });
  assert.equal(hydrate.parsed, false);
  assert.equal(hydrate.checks[0]?.status, "REVIEW");
});

test("reaction direction is only reversed when explicitly allowed", () => {
  const blocked = verifyChemistryEquation({
    response: "2H2O -> 2H2 + O2",
    expectedEquation: "2H2 + O2 -> 2H2O",
  });
  assert.equal(blocked.checks.find(row => row.criterion === "Reaction species")?.status, "FAIL");

  const allowed = verifyChemistryEquation({
    response: "2H2O -> 2H2 + O2",
    expectedEquation: "2H2 + O2 -> 2H2O",
    allowReverse: true,
  });
  assert.equal(allowed.checks.find(row => row.criterion === "Stoichiometric ratio")?.status, "PASS");
});
