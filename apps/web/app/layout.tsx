import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "../components/auth-provider";
import { PwaShell } from "../components/pwa-shell";
export const metadata: Metadata = { title: { default: "Being Brilliant Academy", template: "%s | Being Brilliant Academy" }, description: "India's premium coaching ecosystem for CBSE, JEE, NEET and CUET.", metadataBase: new URL("https://beingbrilliant.in"), keywords:["JEE coaching","NEET coaching","CBSE classes","CUET preparation"], alternates:{canonical:"/"}, openGraph: { type: "website", siteName: "Being Brilliant Academy", title:"Being Brilliant Academy", description:"Your ambition. Made unstoppable.", url:"/" }, twitter:{card:"summary_large_image",title:"Being Brilliant Academy",description:"Premium coaching for ambitious learners."}, manifest: "/manifest.webmanifest", icons:{icon:"/icon.svg",apple:"/icon.svg"} };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body><a className="skip-link" href="#main-content">Skip to content</a><AuthProvider>{children}<PwaShell/></AuthProvider></body></html>; }
