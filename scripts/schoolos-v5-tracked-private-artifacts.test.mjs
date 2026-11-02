import assert from "node:assert/strict";
import test from "node:test";
import {flaggedPaths} from "./schoolos-v5-tracked-private-artifacts.mjs";

test("veto committed Docker image saves, private backup and DPAPI key",()=>{
 const paths=[
   "SchoolOS-V5-Recovery-0123456789abcdef/20261031T073407Z/database.dump",
   "ops/checkpoint.dump",
   "ops/legacy.docker-save.tar",
   "ops/source.oci-archive.tar",
   "ops/archived.image-archive.tar.gz",
   "sandbox/original-vault-key.dpapi",
   "ops/schoolos-v5-recovery-archive.zip",
   "docs/schoolos-v5-incident-raw-image-history.md",
 ];
 assert.deepEqual(flaggedPaths(paths),paths);
});

test("permit source code, sanitized docs, .env examples and test fixtures",()=>{
 const paths=[
   "docs/SCHOOLOS_V5_PHASE1_ARCHIVE_CONTAINMENT_ROLLBACK_PREP_20261102.md",
   ".env.production.example",
   "scripts/schoolos-v5-image-secret-metadata-audit.test.mjs",
   "scripts/schoolos-v5-phase1-rollback-evidence-gate.py",
   "scripts/test_schoolos_v5_phase1_rollback_evidence_gate.py",
 ];
 assert.deepEqual(flaggedPaths(paths),[]);
});

test("guard fails on malformed names",()=>{
 assert.throws(()=>flaggedPaths(null), /BAD_PATH_INDEX/);
 assert.throws(()=>flaggedPaths(["safe",null]),/BAD_PATH_INDEX/);
});
