import type { Metadata } from "next";
import { PremiumLanding } from "../components/premium-landing";
import type { Course } from "../components/course-card";

export const metadata: Metadata = {
  title: "CBSE, JEE, NEET & CUET Coaching",
  description: "Live classes, expert faculty, AI-powered practice and personal mentoring for CBSE, JEE, NEET and CUET learners.",
  alternates: { canonical: "/" },
};

const fallback: Course[] = [
  { title: "JEE 2027 Foundation", slug: "jee-2027-foundation", description: "Concept mastery, live problem solving and personal mentorship.", price: 2499900, salePrice: 1499900, durationDays: 365, instructor: { name: "Dr. Ananya Sharma" }, _count: { enrollments: 1240 } },
  { title: "NEET Rank Booster", slug: "neet-rank-booster", description: "A disciplined, exam-first Biology, Physics and Chemistry programme.", price: 1999900, salePrice: 1199900, durationDays: 180, instructor: { name: "Expert Faculty Team" }, _count: { enrollments: 860 } },
  { title: "CBSE Class 10 Complete", slug: "cbse-10-complete", description: "Concept clarity, weekly tests and personal doubt support.", price: 999900, durationDays: 300, instructor: { name: "Priya Mehta" }, _count: { enrollments: 2100 } },
];

export default async function Home() {
  let courses = fallback;
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1"}/courses`, { next: { revalidate: 300 } });
    if (response.ok) courses = (await response.json()).data.slice(0, 3);
  } catch { /* resilient marketing fallback */ }
  const structuredData = { "@context": "https://schema.org", "@type": "EducationalOrganization", name: "Being Brilliant Academy", url: "https://beingbrilliant.in", description: "Premium coaching for CBSE, JEE, NEET and CUET", areaServed: "India", offers: courses.map((course) => ({ "@type": "Course", name: course.title, description: course.description, provider: { "@type": "Organization", name: "Being Brilliant Academy" } })) };
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} /><PremiumLanding courses={courses} /></>;
}
