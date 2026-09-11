export type LogoWorkflowResult =
  | { status: "saved"; organizationId: string; logoUrl: string | null }
  | { status: "created-logo-failed"; organizationId: string; logoUrl: null; error: unknown };

export type LogoWorkflowDependencies = {
  create?: () => Promise<{ id: string }>;
  patch: (organizationId: string, payload: Record<string, unknown>) => Promise<void>;
  upload: (file: File, organizationId: string) => Promise<string>;
  discard: (url: string, organizationId: string) => Promise<void>;
  isManagedLogo: (url: string, organizationId: string) => boolean;
};

export async function saveOrganizationLogoWorkflow(input: {
  organizationId?: string;
  previousLogoUrl?: string | null;
  logoFile: File | null;
  patchPayload: Record<string, unknown>;
}, dependencies: LogoWorkflowDependencies): Promise<LogoWorkflowResult> {
  let organizationId = input.organizationId;
  let created = false;
  if (!organizationId) {
    if (!dependencies.create) throw new Error("Organization creation is unavailable");
    const organization = await dependencies.create();
    organizationId = organization.id;
    created = true;
  }

  let uploadedUrl: string | null = null;
  const targetOrganizationId = organizationId;
  try {
    const finalLogoUrl = input.logoFile ? await dependencies.upload(input.logoFile, targetOrganizationId) : (input.patchPayload.logoUrl as string | null | undefined) ?? null;
    uploadedUrl = input.logoFile ? finalLogoUrl : null;
    if (!created || input.logoFile) await dependencies.patch(targetOrganizationId, { ...input.patchPayload, logoUrl: finalLogoUrl });
    const previousLogoUrl = input.previousLogoUrl ?? null;
    if (previousLogoUrl && previousLogoUrl !== finalLogoUrl && dependencies.isManagedLogo(previousLogoUrl, targetOrganizationId)) await dependencies.discard(previousLogoUrl, targetOrganizationId).catch(() => undefined);
    return { status: "saved", organizationId: targetOrganizationId, logoUrl: finalLogoUrl };
  } catch (error) {
    if (uploadedUrl) await dependencies.discard(uploadedUrl, targetOrganizationId).catch(() => undefined);
    if (created) return { status: "created-logo-failed", organizationId: targetOrganizationId, logoUrl: null, error };
    throw error;
  }
}

export function isManagedOrganizationLogo(url: string, organizationId: string) {
  let pathname = url;
  try {
    if (/^https?:\/\//i.test(url)) pathname = new URL(url).pathname;
  } catch {
    return false;
  }
  return new RegExp(`^\/api\/v1\/uploaded-images\/organization-logo\/${organizationId}\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(?:jpg|png|webp)$`).test(pathname);
}
