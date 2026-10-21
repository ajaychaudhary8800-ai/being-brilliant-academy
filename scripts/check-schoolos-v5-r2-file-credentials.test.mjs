import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("V5 staging Compose mounts credentials only into backup", async () => {
  const compose = await readFile(new URL("docker-compose.schoolos-v5-staging.yml",root),"utf8");
  assert.doesNotMatch(compose,/BACKUP_AWS_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY)/,
    "Backup key values must never be managed as Coolify app-wide environment variables");
  const [beforeNetworks] = compose.split("\nnetworks:");
  const block = "\n" + beforeNetworks.split("\nservices:")[1];
  assert.ok(block,"Compose services exist");
  const names=["postgres","redis","migrate","api","web","nginx","backup"];
  const sections={};
  for (let i=0;i<names.length;i++) {
    const start=block.indexOf("\n  "+names[i]+":\n");
    assert.ok(start>=0,"Missing "+names[i]+" service");
    const end=i+1<names.length ? block.indexOf("\n  "+names[i+1]+":\n",start+1):block.length;
    assert.ok(end>=0,"Missing next service after "+names[i]);
    sections[names[i]]=block.slice(start,end);
  }
  const secretMount="/etc/schoolos/v5-staging/r2-aws-credentials:/run/secrets/schoolos-v5-r2-credentials:ro";
  const mounted=Object.entries(sections).filter(([,contents])=>contents.includes(secretMount)).map(([name])=>name);
  assert.deepEqual(mounted,["backup"]);
  assert.match(sections.backup,/AWS_SHARED_CREDENTIALS_FILE: "\/run\/secrets\/schoolos-v5-r2-credentials"/);
  assert.match(sections.backup,/networks: \[backend, backup_egress\]/);
});

test("AWS CLI must fail closed on missing file and never prefer injected AWS env credentials",async()=>{
  const backup=await readFile(new URL("infra/backup/backup.sh",root),"utf8");
  assert.match(backup,/\[ ! -s "\$AWS_SHARED_CREDENTIALS_FILE" \]/);
  assert.match(backup,/unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN/);
});
