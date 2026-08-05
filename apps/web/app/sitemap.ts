import type { MetadataRoute } from "next";
import { blogPosts } from "../content/public-content";

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = ["", "/courses", "/faculty", "/blog", "/about", "/contact", "/results"];
  const staticPages: MetadataRoute.Sitemap = pages.map((path) => ({
    url: `https://beingbrilliant.in${path}`,
    changeFrequency: path === "" ? "daily" : "weekly",
    priority: path === "" ? 1 : ["/courses", "/faculty", "/blog"].includes(path) ? 0.9 : 0.7,
  }));
  return [...staticPages, ...blogPosts.map((post) => ({ url: `https://beingbrilliant.in/blog/${post.slug}`, lastModified: new Date(post.updatedAt), changeFrequency: "monthly" as const, priority: 0.75 }))];
}
