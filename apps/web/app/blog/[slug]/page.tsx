import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "../../../components/site-header";
import { blogPosts, getBlogPost, getRelatedPosts } from "../../../content/public-content";

type PageProps = { params: Promise<{ slug: string }> };

export function generateStaticParams() { return blogPosts.map(({ slug }) => ({ slug })); }

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const post = getBlogPost((await params).slug);
  if (!post) return { title: "Article not found" };
  const url = `/blog/${post.slug}`;
  return { title: post.title, description: post.excerpt, keywords: post.tags, alternates: { canonical: url }, authors: [{ name: post.author }], openGraph: { type: "article", title: post.title, description: post.excerpt, url, publishedTime: post.publishedAt, modifiedTime: post.updatedAt, authors: [post.author], tags: post.tags }, twitter: { card: "summary_large_image", title: post.title, description: post.excerpt } };
}

export default async function BlogDetailPage({ params }: PageProps) {
  const post = getBlogPost((await params).slug);
  if (!post) notFound();
  const related = getRelatedPosts(post);
  const articleUrl = `https://beingbrilliant.in/blog/${post.slug}`;
  const schema = { "@context": "https://schema.org", "@type": "BlogPosting", headline: post.title, description: post.excerpt, datePublished: post.publishedAt, dateModified: post.updatedAt, mainEntityOfPage: articleUrl, author: { "@type": "Person", name: post.author }, publisher: { "@type": "EducationalOrganization", name: "Being Brilliant Academy", url: "https://beingbrilliant.in" }, keywords: post.tags.join(", ") };
  const breadcrumbs = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Home", item: "https://beingbrilliant.in" }, { "@type": "ListItem", position: 2, name: "Blog", item: "https://beingbrilliant.in/blog" }, { "@type": "ListItem", position: 3, name: post.title, item: articleUrl }] };
  return <><SiteHeader/><main id="main-content"><article><header className="hero-grid border-b border-blue-100 py-14 sm:py-20 dark:border-slate-800 dark:bg-none"><div className="container-page max-w-4xl"><nav aria-label="Breadcrumb" className="text-sm text-slate-500"><Link href="/blog" className="font-semibold text-brand-700">Blog</Link><span aria-hidden="true"> / </span>{post.category}</nav><p className="pill mt-6 inline-block">{post.category}</p><h1 className="mt-5 text-4xl font-black leading-tight tracking-tight sm:text-6xl">{post.title}</h1><p className="mt-6 max-w-3xl text-lg leading-8 text-slate-600 dark:text-slate-300">{post.excerpt}</p><div className="mt-7 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-slate-500"><span className="font-bold text-slate-800 dark:text-slate-100">{post.author}</span><span>{post.authorRole}</span><span aria-hidden="true">·</span><time dateTime={post.publishedAt}>{new Intl.DateTimeFormat("en-IN", { dateStyle: "long" }).format(new Date(`${post.publishedAt}T00:00:00Z`))}</time><span aria-hidden="true">·</span><span>{post.readingTime}</span></div></div></header><div className="container-page grid max-w-6xl gap-12 py-14 lg:grid-cols-[minmax(0,1fr)_280px]"><div className="max-w-3xl">{post.sections.map((section) => <section key={section.heading} className="mb-10"><h2 className="text-2xl font-black tracking-tight">{section.heading}</h2>{section.paragraphs.map((paragraph) => <p key={paragraph} className="mt-4 text-lg leading-8 text-slate-700 dark:text-slate-300">{paragraph}</p>)}</section>)}</div><aside aria-label="Article information" className="h-fit rounded-2xl border border-slate-200 p-6 dark:border-slate-800"><h2 className="font-black">In this article</h2><ul className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">{post.sections.map((section) => <li key={section.heading}>{section.heading}</li>)}</ul><div className="mt-6 flex flex-wrap gap-2">{post.tags.map((tag) => <span key={tag} className="pill">{tag}</span>)}</div></aside></div></article>{related.length > 0 && <section className="border-t border-slate-200 bg-slate-50 py-14 dark:border-slate-800 dark:bg-slate-900/50" aria-labelledby="related-heading"><div className="container-page"><h2 id="related-heading" className="text-2xl font-black">Related posts</h2><div className="mt-7 grid gap-5 md:grid-cols-3">{related.map((item) => <article key={item.slug} className="card p-6"><p className="text-xs font-bold uppercase tracking-widest text-brand-700">{item.category}</p><h3 className="mt-3 text-lg font-bold"><Link href={`/blog/${item.slug}`} className="hover:text-brand-700">{item.title}</Link></h3><p className="mt-3 text-sm text-slate-500">{item.readingTime}</p></article>)}</div></div></section>}<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }}/><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs).replace(/</g, "\\u003c") }}/></main></>;
}
