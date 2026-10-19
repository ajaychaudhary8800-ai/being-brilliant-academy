/** Fail-closed Stage 7E2 tenant allowlist. Neither a wildcard nor an empty value enables metering. */
export function isSchoolOSAIExaminerMeteringEnabled(
 organizationId: string, allowlist: string | undefined | null,
): boolean {
 if(!organizationId || organizationId==="org_default" || !allowlist) return false;
 return allowlist.split(",").map(value=>value.trim()).filter(Boolean)
   .some(value=>value===organizationId);
}

/** A successful, persisted review result requires a final billable ledger event. */
export function schoolOSAIExaminerSettlementDecision(input: {
 metered: boolean; admitted: boolean; persistedResult: boolean;
}) {
 if(!input.metered)return "DISABLED" as const;
 if(!input.admitted)return "NOT_ADMITTED" as const;
 return input.persistedResult ? "COMMIT" as const : "RECONCILE" as const;
}
