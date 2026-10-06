import Link from "next/link";
import { SiteHeader } from "./site-header";

type Block =
  | { type: "h2" | "h3"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "ul" | "ol"; items: string[] };

function inline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|\`[^\`]+\`)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index} className="rounded bg-slate-100 px-1 py-0.5 text-[.92em] dark:bg-slate-800">{part.slice(1, -1)}</code>;
    }
    return <span key={index}>{part}</span>;
  });
}

function parse(markdown: string): Block[] {
  const lines = markdown.split(/\r?\n/);
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: "paragraph", text: paragraph.join(" ") });
      paragraph = [];
    }
  };

  const flushList = () => {
    if (listType && listItems.length) blocks.push({ type: listType, items: listItems });
    listType = null;
    listItems = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    if (line.startsWith("# ")) continue;

    if (line.startsWith("## ")) {
      flushParagraph();
      flushList();
      blocks.push({ type: "h2", text: line.slice(3) });
      continue;
    }

    if (line.startsWith("### ")) {
      flushParagraph();
      flushList();
      blocks.push({ type: "h3", text: line.slice(4) });
      continue;
    }

    if (line.startsWith("- ")) {
      flushParagraph();
      if (listType && listType !== "ul") flushList();
      listType = "ul";
      listItems.push(line.slice(2));
      continue;
    }

    const ordered = line.match(/^\d+\.\s+(.*)$/);
    if (ordered) {
      flushParagraph();
      if (listType && listType !== "ol") flushList();
      listType = "ol";
      listItems.push(ordered[1]);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}

export function PublicLegalPage({
  title,
  description,
  source,
}: {
  title: string;
  description: string;
  source: string;
}) {
  const blocks = parse(source);

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950">
      <SiteHeader />
      <main id="main-content">
        <section className="border-b border-slate-200 bg-slate-50 py-14 dark:border-slate-800 dark:bg-slate-900/40">
          <div className="container-page max-w-4xl">
            <p className="text-xs font-black uppercase tracking-[.2em] text-brand-700">Legal</p>
            <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">{title}</h1>
            <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-600 dark:text-slate-300">{description}</p>
          </div>
        </section>

        <article className="container-page max-w-4xl py-12 sm:py-16">
          <div className="space-y-5 text-[15px] leading-7 text-slate-700 dark:text-slate-300">
            {blocks.map((block, index) => {
              if (block.type === "h2") {
                return <h2 key={index} className="pt-6 text-2xl font-black tracking-tight text-slate-950 dark:text-white">{inline(block.text)}</h2>;
              }
              if (block.type === "h3") {
                return <h3 key={index} className="pt-4 text-xl font-black text-slate-950 dark:text-white">{inline(block.text)}</h3>;
              }
              if (block.type === "ul") {
                return (
                  <ul key={index} className="list-disc space-y-2 pl-6">
                    {block.items.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>)}
                  </ul>
                );
              }
              if (block.type === "ol") {
                return (
                  <ol key={index} className="list-decimal space-y-2 pl-6">
                    {block.items.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>)}
                  </ol>
                );
              }
              return <p key={index}>{inline(block.text)}</p>;
            })}
          </div>

          <div className="mt-12 border-t border-slate-200 pt-6 text-sm text-slate-500 dark:border-slate-800">
            <p>Questions about these terms can be sent to the business-role contact stated in the applicable document.</p>
            <Link href="/" className="mt-4 inline-flex font-bold text-brand-700 hover:underline">Return to Being Brilliant</Link>
          </div>
        </article>
      </main>
    </div>
  );
}
