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
  title: "Acceptable Use Policy",
  alternates: { canonical: "/acceptable-use" },
};

export default async function Page() {
  if (!publicLegalPagesPublished()) notFound();

  const definition = publicLegalDefinition("acceptable-use");
  const source = await loadPublicLegalSource("acceptable-use");

  return (
    <PublicLegalPage
      title={definition.title}
      description={definition.description}
      source={source}
    />
  );
}
