import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const web = (path: string) => new URL(`../../../web/${path}`, import.meta.url);
const dockerUrl = new URL("../../../web/Dockerfile", import.meta.url);

test("public legal routes remain publication-gated until counsel approval", async () => {
  for (const route of ["privacy", "terms", "acceptable-use"]) {
    const page = await readFile(web(`app/${route}/page.tsx`), "utf8");
    assert.match(page, /publicLegalPagesPublished/);
    assert.match(page, /notFound\(\)/);
    assert.match(page, /PublicLegalPage/);
  }

  const loader = await readFile(web("lib/public-legal.ts"), "utf8");
  assert.match(loader, /LEGAL_PAGES_PUBLISHED === "true"/);
  assert.match(loader, /LEGAL_EFFECTIVE_DATE/);
  assert.match(loader, /07_PRIVACY_NOTICE\.md/);
  assert.match(loader, /03_SAAS_MASTER_AGREEMENT\.md/);
  assert.match(loader, /08_ACCEPTABLE_USE_POLICY\.md/);
  assert.match(loader, /replaceAll\("\[\[DATE\]\]"/);
});

test("web runtime packages the controlled legal sources used by public pages", async () => {
  const docker = await readFile(dockerUrl, "utf8");
  assert.match(docker, /COPY docs\/legal-sales docs\/legal-sales/);
  assert.match(docker, /\/workspace\/docs\/legal-sales \.\/docs\/legal-sales/);
});

test("commercial landing pre-wires legal links and privacy notice without publishing by default", async () => {
  const [landing, home, sitemap] = await Promise.all([
    readFile(web("components/premium-landing.tsx"), "utf8"),
    readFile(web("app/page.tsx"), "utf8"),
    readFile(web("app/sitemap.ts"), "utf8"),
  ]);
  const robots = await readFile(web("app/robots.ts"), "utf8");
  assert.match(home, /publicLegalPagesPublished/);
  assert.match(home, /legalPagesPublished=\{publicLegalPagesPublished\(\)\}/);
  assert.match(landing, /legalPagesPublished/);
  assert.match(landing, /href="\/privacy"/);
  assert.match(landing, /href="\/terms"/);
  assert.match(landing, /href="\/acceptable-use"/);
  assert.match(landing, /By submitting, you are asking our team to contact you about the education platform/);
  assert.match(sitemap, /publicLegalPagesPublished/);
  assert.match(sitemap, /beingbrilliantedu\.com\/privacy/);
  assert.match(sitemap, /beingbrilliantedu\.com\/terms/);
  assert.match(sitemap, /beingbrilliantedu\.com\/acceptable-use/);
  assert.match(robots, /publicLegalPagesPublished/);
  assert.match(robots, /"\/privacy", "\/terms", "\/acceptable-use"/);
});
