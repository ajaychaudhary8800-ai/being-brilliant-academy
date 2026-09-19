import { notFound } from "next/navigation";
import { PortalForgotPassword } from "../../../components/portal-auth";
import type { AuthPortal } from "../../../components/auth-provider";

const portalNames = ["student", "parent", "teacher", "employee", "admin"] as const;

export function generateStaticParams() {
  return ["student", "parent", "teacher", "employee", "admin"].map((portal) => ({ portal }));
}

export default async function PortalForgotPasswordPage({ params }: { params: Promise<{ portal: string }> }) {
  const { portal } = await params;
  if (!portalNames.includes(portal as AuthPortal)) notFound();
  return <PortalForgotPassword portal={portal as AuthPortal} />;
}
