import type { MetadataRoute } from "next";
import { publicLegalPagesPublished } from "../lib/public-legal";

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [
    {
      url: "https://beingbrilliantedu.com",
      changeFrequency: "weekly",
      priority: 1,
    },
  ];

  if (publicLegalPagesPublished()) {
    entries.push(
      {
        url: "https://beingbrilliantedu.com/privacy",
        changeFrequency: "monthly",
        priority: 0.4,
      },
      {
        url: "https://beingbrilliantedu.com/terms",
        changeFrequency: "monthly",
        priority: 0.4,
      },
      {
        url: "https://beingbrilliantedu.com/acceptable-use",
        changeFrequency: "monthly",
        priority: 0.3,
      },
    );
  }

  return entries;
}
