import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ai-examiner.ts", import.meta.url), "utf8");

test("branch administrators cannot traverse institution-global benchmark details carrying student records", () => {
  const start = source.indexOf("async function benchmarkSuiteForRequest");
  const end = source.indexOf("async function branchAccess", start);
  assert.ok(start >= 0 && end > start);
  const helper = source.slice(start, end);
  const missing = helper.indexOf("if (!suite) throw");
  const globalDeny = helper.indexOf("req.auth!.role === Role.BRANCH_ADMIN && !suite.branchId");
  const branchCheck = helper.indexOf("if (suite.branchId)", globalDeny);
  assert.ok(missing >= 0 && globalDeny > missing && branchCheck > globalDeny);
  assert.match(helper, /throw new AppError\(403, "BRANCH_FORBIDDEN", "Organization-wide benchmark evidence requires a Super Administrator"\)/);
  assert.match(helper, /visibleBranches && !visibleBranches\.includes\(suite\.branchId\)/);
});

test("benchmark global catalogue metadata does not bypass suite-specific detail checks", () => {
  const listStart = source.indexOf('router.get("/benchmark-suites"');
  const listEnd = source.indexOf('router.post("/benchmark-suites"', listStart);
  const list = source.slice(listStart, listEnd);
  assert.ok(listStart >= 0 && listEnd > listStart);
  assert.doesNotMatch(list, /sourceAnswerSheet/);
  for (const [method, path] of [
    ["get", "/benchmark-suites/:suiteId/cases"],
    ["get", "/benchmark-suites/:suiteId/candidate-pool"],
    ["get", "/benchmark-suites/:suiteId/evaluation-results"],
    ["get", "/benchmark-suites/:suiteId/runs"],
    ["post", "/benchmark-suites/:suiteId/cases"],
    ["post", "/benchmark-suites/:suiteId/cases/bulk-import"],
    ["post", "/benchmark-suites/:suiteId/runs"],
    ["post", "/benchmark-suites/:suiteId/activate"],
  ]) {
    const begin = source.indexOf(`router.${method}("${path}"`);
    const next = source.indexOf("router.", begin + 8);
    assert.ok(begin >= 0 && next > begin, `Missing benchmark route: ${method} ${path}`);
    const part = source.slice(begin, next);
    assert.match(part, /await benchmarkSuiteForRequest\(req, cuid\.parse\(req\.params\.suiteId\)\)/, `No branch-scoped suite check: ${path}`);
  }
});
