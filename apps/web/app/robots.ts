import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
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
      ],
    },
    sitemap: "https://beingbrilliantedu.com/sitemap.xml",
    host: "https://beingbrilliantedu.com",
  };
}
