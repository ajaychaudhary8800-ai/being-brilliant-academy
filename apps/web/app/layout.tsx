import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "../components/auth-provider";
import { PwaShell } from "../components/pwa-shell";
import { TenantBrandingProvider } from "../components/tenant-branding";

export const metadata: Metadata = {
  title: {
    default: "Being Brilliant Education Platform",
    template: "%s | Being Brilliant",
  },
  description: "Education ERP, LMS, CRM, finance, HR, examinations, communication and analytics for schools, coaching institutes and education groups.",
  metadataBase: new URL("https://beingbrilliantedu.com"),
  keywords: [
    "education ERP",
    "school ERP",
    "coaching institute management software",
    "education LMS",
    "admissions CRM",
    "school management software",
    "white label education software",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Being Brilliant",
    title: "Being Brilliant Education Platform",
    description: "Run ERP, LMS, CRM and institutional analytics from one connected education platform.",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "Being Brilliant Education Platform",
    description: "ERP, LMS, CRM and analytics for modern education institutions.",
  },
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">Skip to content</a>
        <AuthProvider>
          <TenantBrandingProvider>
            {children}
            <PwaShell />
          </TenantBrandingProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
