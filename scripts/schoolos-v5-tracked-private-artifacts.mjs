#!/usr/bin/env node
/**
 * V5 P0 #293 no-private-incident-artifact commit guard.
 * Inspects only tracked PATH STRINGS from git index. No file contents, secret
 * bytes, archives, logs, Docker engine or server requests. No mutation.
 */
import {spawnSync} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";

const DENIED = Object.freeze([
  /(?:^|\/)SchoolOS-V5-Recovery-[^/]+(?:\/|$)/i,
  /(?:^|\/)schoolos-v5-private-recovery(?:\/|$)/i,
  /\.(?:dpapi|dump)$/i,
  /\.(?:docker-save|oci-archive|image-archive)\.tar(?:\.gz)?$/i,
  /schoolos.*v5.*recovery.*\.zip$/i,
  /schoolos.*v5.*incident.*raw/i,
  /(?:^|\/)(?:docker|image)-history-raw\./i,
]);
export function flaggedPaths(names) {
  if (!Array.isArray(names) || names.some(n => typeof n !== "string"))
    throw new Error("BAD_PATH_INDEX");
  return names.filter(name => DENIED.some(rule =>
    rule.test(name.replaceAll("\\", "/"))));
}
export function inspectTrackedPaths() {
  const r=spawnSync("git", ["ls-files", "-z"], {
    encoding: "buffer", timeout: 30000, windowsHide: true,
    stdio: ["ignore","pipe","ignore"],maxBuffer: 8*1024*1024,
  });
  if (r.error || r.status !== 0 || !r.stdout)
    throw new Error("GIT_INDEX_UNAVAILABLE");
  const paths=r.stdout.toString("utf8").split("\0").filter(Boolean);
  return flaggedPaths(paths);
}
if (process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error("NO_PARAMETERS");
    const found=inspectTrackedPaths();
    console.log("V5_TRACKED_PRIVATE_ARTIFACTS="+
      (found.length ? "REJECT" : "NONE"));
    console.log("V5_PRIVATE_ARTIFACT_PATHS_PRINTED=NO");
    console.log("V5_PRIVATE_ARTIFACT_CONTENT_READ=NO");
    console.log("V5_STAGING_PRODUCTION_CHANGED=NO");
    process.exitCode=found.length?2:0;
  } catch {
    console.log("V5_TRACKED_PRIVATE_ARTIFACTS=CHECK_REQUIRED");
    console.log("V5_PRIVATE_ARTIFACT_PATHS_PRINTED=NO");
    process.exitCode=2;
  }
}
