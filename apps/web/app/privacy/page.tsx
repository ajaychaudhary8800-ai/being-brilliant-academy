import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicLegalPage } from "../../components/public-legal-page";
import {
  loadPublicLegalSource,
  publicLegalDefinition,
  publicLegalPagesPublished,
} from "../../lib/public-legal";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Privacy Notice",
  alternates: { canonical: "/privacy" },
};

export default async function Page() {
  if (!publicLegalPagesPublished()) notFound();

  const definition = publicLegalDefinition("privacy");
  const source = await loadPublicLegalSource("privacy");

  return (
    <PublicLegalPage
      title={definition.title}
      description={definition.description}
      source={source}
    />
  );
}
