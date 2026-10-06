import type { MetadataRoute } from "next";
import { publicLegalPagesPublished } from "../lib/public-legal";

export default function robots(): MetadataRoute.Robots {
  const disallow = [
    "/admin/",
    "/dashboard/",
    "/employee/",
    "/parent/",
    "/student/",
    "/teacher/",
    "/portal/",
    "/portals/",
    "/login",
    "/forgot-password",
    "/reset-password",
    "/register",
    "/api/",
  ];

  if (!publicLegalPagesPublished()) {
    disallow.push("/privacy", "/terms", "/acceptable-use");
  }

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow,
    },
    sitemap: "https://beingbrilliantedu.com/sitemap.xml",
    host: "https://beingbrilliantedu.com",
  };
}
