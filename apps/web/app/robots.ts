import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin/", "/dashboard/", "/employee/", "/parent/", "/student/", "/teacher/", "/api/"],
    },
    sitemap: "https://beingbrilliant.in/sitemap.xml",
    host: "https://beingbrilliant.in",
  };
}
