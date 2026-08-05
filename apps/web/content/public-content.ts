export type FacultyMember = {
  name: string;
  initials: string;
  subject: string;
  qualification: string;
  experience: string;
  bio: string;
  socials: { label: string; href: string }[];
};

export const faculty: FacultyMember[] = [
  { name: "Dr. Ananya Sharma", initials: "AS", subject: "Physics · JEE", qualification: "PhD, IIT Delhi", experience: "14 years", bio: "Makes advanced mechanics and electromagnetism approachable through visual reasoning and disciplined problem solving.", socials: [{ label: "LinkedIn", href: "https://www.linkedin.com/" }, { label: "YouTube", href: "https://www.youtube.com/" }] },
  { name: "Rahul Mehta", initials: "RM", subject: "Mathematics · JEE", qualification: "MSc Mathematics, IIT Kanpur", experience: "12 years", bio: "Helps learners build speed and accuracy with concept-first methods for algebra, calculus and coordinate geometry.", socials: [{ label: "LinkedIn", href: "https://www.linkedin.com/" }] },
  { name: "Dr. Nidhi Verma", initials: "NV", subject: "Biology · NEET", qualification: "PhD Life Sciences, DU", experience: "11 years", bio: "Connects NCERT fundamentals with exam-focused recall systems, diagrams and application-based practice.", socials: [{ label: "LinkedIn", href: "https://www.linkedin.com/" }, { label: "YouTube", href: "https://www.youtube.com/" }] },
  { name: "Arjun Iyer", initials: "AI", subject: "Chemistry · JEE & NEET", qualification: "MTech, IIT Bombay", experience: "10 years", bio: "Teaches physical, organic and inorganic chemistry with structured revision and memorable reaction frameworks.", socials: [{ label: "LinkedIn", href: "https://www.linkedin.com/" }] },
  { name: "Priya Singh", initials: "PS", subject: "English · CBSE & CUET", qualification: "MA English, JNU", experience: "9 years", bio: "Builds confident readers and writers through close reading, clear feedback and practical language strategies.", socials: [{ label: "LinkedIn", href: "https://www.linkedin.com/" }] },
  { name: "Vikram Joshi", initials: "VJ", subject: "Accountancy · CBSE & CUET", qualification: "MCom, CA (Inter)", experience: "13 years", bio: "Turns accounting principles into repeatable workflows that improve clarity, presentation and scoring consistency.", socials: [{ label: "LinkedIn", href: "https://www.linkedin.com/" }] },
];

export type BlogSection = { heading: string; paragraphs: string[] };
export type BlogPost = {
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  author: string;
  authorRole: string;
  publishedAt: string;
  updatedAt: string;
  readingTime: string;
  tags: string[];
  sections: BlogSection[];
};

export const blogPosts: BlogPost[] = [
  {
    slug: "jee-main-revision-plan",
    title: "A practical 30-day JEE Main revision plan",
    excerpt: "Turn the final month into a focused cycle of revision, timed practice and error correction.",
    category: "JEE", author: "Rahul Mehta", authorRole: "JEE Mathematics Faculty", publishedAt: "2026-07-18", updatedAt: "2026-07-22", readingTime: "6 min read", tags: ["JEE Main", "Revision", "Study plan"],
    sections: [
      { heading: "Start with evidence", paragraphs: ["Use your last three mock tests to list the chapters where you lose the most marks. Separate conceptual gaps from calculation errors and time pressure. That evidence should decide your revision order."] },
      { heading: "Build a repeatable weekly cycle", paragraphs: ["Reserve mornings for high-focus concept revision, afternoons for mixed question sets and evenings for analysis. Take a full-length mock every third day under exam conditions.", "Spend as much time analysing a mock as attempting it. Record why each error happened and the smallest action that will prevent it next time."] },
      { heading: "Protect the final week", paragraphs: ["Reduce new material, revisit formula sheets and solve a small set of familiar questions daily. Keep sleep and meal timings close to your examination schedule."] },
    ],
  },
  {
    slug: "ncert-biology-for-neet",
    title: "How to study NCERT Biology for NEET",
    excerpt: "A layered reading and recall method for mastering high-value NCERT Biology details.",
    category: "NEET", author: "Dr. Nidhi Verma", authorRole: "NEET Biology Faculty", publishedAt: "2026-07-10", updatedAt: "2026-07-10", readingTime: "5 min read", tags: ["NEET", "Biology", "NCERT"],
    sections: [
      { heading: "Read in layers", paragraphs: ["Use the first reading to understand the chapter narrative. On the second, annotate definitions, examples, exceptions and diagrams. On the third, turn those details into questions you can answer without looking."] },
      { heading: "Make diagrams active", paragraphs: ["Redraw labelled figures from memory and explain each label aloud. This converts visual familiarity into recall you can use under pressure."] },
      { heading: "Revise through retrieval", paragraphs: ["Short, frequent recall sessions are more reliable than rereading. Mix previous-year questions with statement-based questions to check whether you notice precise wording."] },
    ],
  },
  {
    slug: "cbse-board-answer-writing",
    title: "CBSE answer-writing habits that earn marks",
    excerpt: "Improve clarity, structure and time management without turning answers into memorised scripts.",
    category: "CBSE", author: "Priya Singh", authorRole: "CBSE English Faculty", publishedAt: "2026-06-28", updatedAt: "2026-07-02", readingTime: "4 min read", tags: ["CBSE", "Board exams", "Answer writing"],
    sections: [
      { heading: "Answer the command word", paragraphs: ["Underline whether the question asks you to explain, compare, justify or evaluate. Your structure should respond to that exact instruction from the opening sentence."] },
      { heading: "Use visible structure", paragraphs: ["Lead with the direct answer, develop it with relevant evidence and close the point clearly. Headings, steps and labelled diagrams help examiners see the logic quickly when appropriate."] },
      { heading: "Practise with a clock", paragraphs: ["Timed writing reveals where you over-explain. Review completed answers against the marking scheme and rewrite only the weakest portion."] },
    ],
  },
  {
    slug: "cuet-smart-subject-strategy",
    title: "Build a smarter CUET subject strategy",
    excerpt: "Align domain preparation, language practice and general aptitude with your university goals.",
    category: "CUET", author: "Vikram Joshi", authorRole: "CUET Faculty Mentor", publishedAt: "2026-06-16", updatedAt: "2026-06-16", readingTime: "5 min read", tags: ["CUET", "Strategy", "Admissions"],
    sections: [
      { heading: "Work backwards from eligibility", paragraphs: ["List your target programmes and confirm their subject combinations before planning preparation. A strong score is useful only when it matches the programme requirements."] },
      { heading: "Balance domains and aptitude", paragraphs: ["Use weekly diagnostic sets to distribute time by weakness, not by preference. Keep language and general test practice regular even while domain subjects demand attention."] },
      { heading: "Simulate the interface", paragraphs: ["Practise navigating sections, flagging uncertain questions and making quick elimination decisions. Familiarity reduces avoidable time loss."] },
    ],
  },
  {
    slug: "reduce-exam-stress",
    title: "A student-friendly system for reducing exam stress",
    excerpt: "Replace vague worry with a visible plan, realistic routines and simple recovery habits.",
    category: "Study Skills", author: "Dr. Ananya Sharma", authorRole: "Academic Mentor", publishedAt: "2026-06-04", updatedAt: "2026-06-04", readingTime: "4 min read", tags: ["Wellbeing", "Study skills", "Planning"],
    sections: [
      { heading: "Make the workload visible", paragraphs: ["Write every topic and deadline in one place, then select three achievable priorities for the day. A concrete list makes progress measurable and prevents everything feeling equally urgent."] },
      { heading: "Use smaller focus blocks", paragraphs: ["Work in distraction-free blocks with brief movement breaks. End each block by noting the next action so restarting is easy."] },
      { heading: "Know when to ask for support", paragraphs: ["Speak with a parent, teacher or counsellor when anxiety persistently disrupts sleep, appetite or daily functioning. Support is part of preparation, not a failure of it."] },
    ],
  },
];

export const blogCategories = ["All", ...Array.from(new Set(blogPosts.map((post) => post.category)))];

export function getBlogPost(slug: string) {
  return blogPosts.find((post) => post.slug === slug);
}

export function getRelatedPosts(post: BlogPost) {
  const candidates = blogPosts.filter((candidate) => candidate.slug !== post.slug);
  const relevant = candidates.filter((candidate) => candidate.category === post.category || candidate.tags.some((tag) => post.tags.includes(tag)));
  return [...relevant, ...candidates.filter((candidate) => !relevant.includes(candidate))].slice(0, 3);
}
