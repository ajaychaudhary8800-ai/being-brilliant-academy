import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("secured LMS video is fetched with authentication without putting the token in the URL", () => {
  const source = readFileSync(new URL("./authenticated-video.tsx", import.meta.url), "utf8");
  assert.match(source, /Authorization: `Bearer \$\{getAccessToken\(\) \?\? ""\}`/);
  assert.match(source, /URL\.createObjectURL\(await response\.blob\(\)\)/);
  assert.match(source, /URL\.revokeObjectURL\(objectUrl\)/);
  assert.doesNotMatch(source, /[?&](?:token|accessToken)=/);
});

test("the LMS preview uses authenticated delivery only for stored video", () => {
  const source = readFileSync(new URL("../app/admin/lms/page.tsx", import.meta.url), "utf8");
  assert.match(source, /selected\.videoName\?<AuthenticatedVideo/);
  assert.match(source, /selected\.videoUrl\?<video/);
});

test("the effective web CSP permits authenticated Blob and external HTTPS video sources", () => {
  const nginx = readFileSync(new URL("../../../infra/nginx/nginx.conf", import.meta.url), "utf8");
  assert.match(nginx, /media-src 'self' blob: https:/);
});
