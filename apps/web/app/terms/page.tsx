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
  title: "SaaS Terms",
  alternates: { canonical: "/terms" },
};

export default async function Page() {
  if (!publicLegalPagesPublished()) notFound();

  const definition = publicLegalDefinition("terms");
  const source = await loadPublicLegalSource("terms");

  return (
    <PublicLegalPage
      title={definition.title}
      description={definition.description}
      source={source}
    />
  );
}
