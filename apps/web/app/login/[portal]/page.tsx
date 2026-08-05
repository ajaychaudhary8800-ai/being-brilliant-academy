import { notFound } from "next/navigation";
import { PortalLogin } from "../../../components/portal-auth";
import type { AuthPortal } from "../../../components/auth-provider";

const portalNames = ["student", "parent", "teacher", "admin"] as const;

export function generateStaticParams() {
  return ["student", "parent", "teacher", "admin"].map((portal) => ({ portal }));
}

export default async function PortalLoginPage({ params }: { params: Promise<{ portal: string }> }) {
  const { portal } = await params;
  if (!portalNames.includes(portal as AuthPortal)) notFound();
  return <PortalLogin portal={portal as AuthPortal} />;
}
