"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { blogCategories, type BlogPost } from "../content/public-content";

export function BlogBrowser({ posts }: { posts: BlogPost[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const visiblePosts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return posts.filter((post) => (category === "All" || post.category === category) && (!needle || `${post.title} ${post.excerpt} ${post.tags.join(" ")}`.toLowerCase().includes(needle)));
  }, [category, posts, query]);

  return <section aria-labelledby="articles-heading" className="mt-12">
    <h2 id="articles-heading" className="sr-only">Articles</h2>
    <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-wrap gap-2" aria-label="Blog categories">{blogCategories.map((item) => <button key={item} type="button" onClick={() => setCategory(item)} aria-pressed={category === item} className={`rounded-full px-4 py-2 text-sm font-semibold transition ${category === item ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-700 hover:bg-blue-50 hover:text-brand-700 dark:bg-slate-800 dark:text-slate-200"}`}>{item}</button>)}</div>
      <label className="relative block min-w-64"><span className="sr-only">Search articles</span><Search aria-hidden="true" className="absolute left-3 top-3 text-slate-400" size={18}/><input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="Search articles" className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm dark:border-slate-700 dark:bg-slate-950"/></label>
    </div>
    <p className="mt-5 text-sm text-slate-500" aria-live="polite">{visiblePosts.length} {visiblePosts.length === 1 ? "article" : "articles"}</p>
    <div className="mt-5 grid gap-6 md:grid-cols-2 lg:grid-cols-3">{visiblePosts.map((post) => <article key={post.slug} className="card flex h-full flex-col p-6"><p className="text-xs font-bold uppercase tracking-widest text-brand-700">{post.category}</p><h3 className="mt-3 text-xl font-bold leading-snug"><Link className="hover:text-brand-700" href={`/blog/${post.slug}`}>{post.title}</Link></h3><p className="mt-3 flex-1 text-sm leading-6 text-slate-600 dark:text-slate-300">{post.excerpt}</p><div className="mt-6 border-t border-slate-100 pt-4 text-xs text-slate-500 dark:border-slate-800"><span>{post.author}</span><span aria-hidden="true"> · </span><span>{post.readingTime}</span></div><Link href={`/blog/${post.slug}`} className="mt-4 text-sm font-bold text-brand-700" aria-label={`Read ${post.title}`}>Read article →</Link></article>)}</div>
    {!visiblePosts.length && <div className="mt-8 rounded-2xl bg-slate-50 p-8 text-center dark:bg-slate-900"><p className="font-semibold">No articles match your search.</p><button type="button" onClick={() => { setQuery(""); setCategory("All"); }} className="mt-3 text-sm font-bold text-brand-700">Clear filters</button></div>}
  </section>;
}
