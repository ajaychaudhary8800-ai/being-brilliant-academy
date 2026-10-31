#!/usr/bin/env node
/** Read-only, fail-closed, values-free policy for source-defined V5 Compose
 * build arguments. Coolify may inject extra arguments OUTSIDE this Compose
 * document: operator must separately verify Coolify Advanced > Build.
 * Never print or log source Compose JSON, environment, or argument values. */
import { readFileSync } from "node:fs";

const buildAllowlist = Object.freeze({
  api: ["SCHOOLOS_BUILD_REVISION"],
  migrate: ["SCHOOLOS_BUILD_REVISION"],
  web: ["NEXT_PUBLIC_API_URL", "SCHOOLOS_BUILD_REVISION"],
  nginx: [],
  backup: [],
});
export function checkComposeBuildArgumentPolicy(document) {
  const reasons = [];
  if (typeof document !== "object" || !document || Array.isArray(document))
    return {status:"FAIL",reasons:["UNREADABLE_COMPOSE"],valuesPrinted:false};
  const services = document.services;
  if (typeof services !== "object" || !services || Array.isArray(services))
    return {status:"FAIL",reasons:["INVALID_SERVICES"],valuesPrinted:false};
  for (const [service,allowed] of Object.entries(buildAllowlist)) {
    const definition=services[service];
    if (!definition || typeof definition !== "object")
      {reasons.push("MISSING_SERVICE_"+service.toUpperCase());continue;}
    const build=definition.build;
    if (!build || typeof build !== "object" || Array.isArray(build))
      {reasons.push("MISSING_BUILD_"+service.toUpperCase());continue;}
    const args=build.args ?? {};
    if (typeof args!=="object" || !args || Array.isArray(args))
      {reasons.push("INVALID_BUILD_ARGS_"+service.toUpperCase());continue;}
    const names=Object.keys(args).sort();
    if (JSON.stringify(names)!==JSON.stringify([...allowed].sort()))
      reasons.push("UNREVIEWED_BUILD_ARGS_"+service.toUpperCase());
    if (Object.entries(args).some(([k,v])=>
      !allowed.includes(k) || typeof v!=="string" ||
      v.length > 128 || /[\n\r\0]/.test(v)))
      reasons.push("MALFORMED_BUILD_ARGS_"+service.toUpperCase());
  }
  return {status:reasons.length?"FAIL":"PASS_SOURCE_BUILD_ARGS_ONLY",
    reasons:[...new Set(reasons)].sort(),valuesPrinted:false,
    coolifyBuildSettingsVerified:false,imageHistoryVerified:false,
    credentialRotationVerified:false,commercialGo:false};
}
export function checkSourceDockerfileArgs(source, expectedNames) {
  if (typeof source !== "string" || !source.trim())
    return {status:"FAIL",reasons:["DOCKERFILE_UNREADABLE"],valuesPrinted:false};
  const reasons=[];
  const args=[];
  for (const line of source.split(/\r?\n/)) {
    if (!/^\s*ARG(?:\s|$)/.test(line)) continue;
    const match=/^\s*ARG\s+([A-Z][A-Z0-9_]*)(?:=[^\r\n]*)?\s*$/.exec(line);
    if (!match) reasons.push("DOCKERFILE_ARG_DECLARATION_INVALID");
    else args.push(match[1]);
  }
  if (args.length !== expectedNames.length ||
      [...args].sort().join("|") !== [...expectedNames].sort().join("|"))
    reasons.push("DOCKERFILE_BUILD_ARGS_UNREVIEWED");
  return {status:reasons.length?"FAIL":"PASS_SOURCE_DOCKERFILE_ARGS_ONLY",
    reasons:[...new Set(reasons)].sort(),valuesPrinted:false,
    coolifyInjectionExcluded:false,compiledImageVerified:false};
}

if (process.argv[1]?.endsWith("schoolos-v5-build-arg-policy.mjs")) {
  try {
    if (process.argv.length!==2) throw new Error("INVALID_ARGUMENTS");
    const input=readFileSync(0,{encoding:"utf8"});
    if (input.length>10*1024*1024) throw new Error("COMPOSE_SIZE_LIMIT");
    const result=checkComposeBuildArgumentPolicy(JSON.parse(input));
    // Source Dockerfiles must independently declare exactly the reviewed
    // argument allowlist. This cannot detect extra Coolify-generated ARGs;
    // the built-image history audit addresses that second boundary.
    const fsResults={};
    for (const [role,file,allowed] of [
      ["API","apps/api/Dockerfile",["SCHOOLOS_BUILD_REVISION"]],
      ["WEB","apps/web/Dockerfile",["NEXT_PUBLIC_API_URL","SCHOOLOS_BUILD_REVISION"]]
    ]) {
      const content=readFileSync(file,{encoding:"utf8"});
      fsResults[role]=checkSourceDockerfileArgs(content,allowed);
      if (fsResults[role].status!=="PASS_SOURCE_DOCKERFILE_ARGS_ONLY") {
        result.status="FAIL";
        result.reasons.push("UNREVIEWED_DOCKERFILE_ARGS_"+role);
      }
    }
    result.sourceDockerfiles=fsResults;
    console.log("SCHOOLOS_V5_BUILD_ARG_POLICY "+JSON.stringify(result));
    if (result.status!=="PASS_SOURCE_BUILD_ARGS_ONLY") process.exitCode=1;
  } catch {
    console.error("SCHOOLOS_V5_BUILD_ARG_POLICY=CHECK_REQUIRED_NO_VALUES_PRINTED");
    process.exitCode=1;
  }
}
