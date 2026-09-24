import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PremiumLanding } from "../components/premium-landing";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Education ERP, LMS, CRM & Analytics Platform",
  description: "Run admissions, academics, LMS, fees, finance, HR, examinations, communication and analytics from one education management platform.",
  alternates: { canonical: "/" },
};

export default async function Home() {
  const internalApiUrl = process.env.INTERNAL_API_URL;
  const host = (await headers()).get("host") ?? "";
  let tenantHost = false;

  try {
    if (internalApiUrl && host) {
      const branding = await fetch(internalApiUrl + "/public/branding?host=" + encodeURIComponent(host), { cache: "no-store" });
      tenantHost = branding.ok;
    }
  } catch {
    // Keep the public commercial site available if tenant-branding lookup is temporarily unavailable.
  }

  if (tenantHost) redirect("/login");

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Being Brilliant Education Platform",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: "https://beingbrilliantedu.com",
    description: "Education ERP, LMS, CRM, finance, HR, examinations, communication and analytics platform for schools, coaching institutes and education groups.",
    featureList: [
      "Education ERP",
      "Learning Management System",
      "Admissions CRM",
      "Fees and finance",
      "HR and payroll",
      "Examinations",
      "Communication",
      "Management analytics",
      "Multi-tenant SaaS",
      "White-label branding",
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
      />
      <PremiumLanding />
    </>
  );
}
