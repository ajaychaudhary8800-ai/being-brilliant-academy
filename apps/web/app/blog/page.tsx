import type { Metadata } from "next";
import { BlogBrowser } from "../../components/blog-browser";
import { SiteHeader } from "../../components/site-header";
import { blogPosts } from "../../content/public-content";

export const metadata: Metadata = {
  title: "Learning Blog",
  description: "Study strategies, exam guidance and expert insights for CBSE, JEE, NEET and CUET learners.",
  alternates: { canonical: "/blog" },
  openGraph: { title: "Being Brilliant Academy Learning Blog", description: "Practical guidance from experienced educators.", url: "/blog" },
};

export default function BlogPage() {
  const schema = { "@context": "https://schema.org", "@type": "Blog", name: "Being Brilliant Academy Learning Blog", url: "https://beingbrilliant.in/blog", publisher: { "@type": "EducationalOrganization", name: "Being Brilliant Academy", url: "https://beingbrilliant.in" }, blogPost: blogPosts.map((post) => ({ "@type": "BlogPosting", headline: post.title, url: `https://beingbrilliant.in/blog/${post.slug}`, datePublished: post.publishedAt, author: { "@type": "Person", name: post.author } })) };
  return <><SiteHeader/><main id="main-content"><section className="hero-grid border-b border-blue-100 py-16 sm:py-24 dark:border-slate-800 dark:bg-none"><div className="container-page"><p className="pill inline-block">Learning resources</p><h1 className="section-title mt-5 max-w-3xl">Clear ideas for smarter preparation.</h1><p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600 dark:text-slate-300">Practical strategies, examination guidance and subject insights from the Being Brilliant faculty.</p><BlogBrowser posts={blogPosts}/></div></section><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }}/></main></>;
}
