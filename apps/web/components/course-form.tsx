"use client";

import { ArrowLeft, Loader2, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { getAccessToken } from "./auth-provider";
import Sidebar from "./sidebar";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
type NamedOption = { id: string; name: string; code: string };
type Branch = { id: string; branchName: string };
type CategoryType = "ACADEMIC" | "COMPETITIVE" | "SKILL_BASED" | "";
type FormState = {
  title: string; slug: string; courseCode: string; categoryType: CategoryType; academicBoard: string; customBoardName: string;
  classLevel: string; academicStream: string; scienceCombination: string; academicPreparation: string;
  competitiveExamId: string; skillCategoryId: string; language: string; mode: string; status: string; branchId: string;
  durationDays: string; shortDescription: string; fullDescription: string; eligibility: string; learningOutcomes: string;
  regularPrice: string; salePrice: string; registrationFee: string; admissionFee: string; startDate: string; endDate: string;
  thumbnailUrl: string; brochureUrl: string; isFeatured: boolean; enrollmentOpen: boolean;
};
const blank: FormState = {
  title: "", slug: "", courseCode: "", categoryType: "", academicBoard: "", customBoardName: "", classLevel: "", academicStream: "",
  scienceCombination: "", academicPreparation: "", competitiveExamId: "", skillCategoryId: "", language: "English", mode: "", status: "DRAFT",
  branchId: "", durationDays: "", shortDescription: "", fullDescription: "", eligibility: "", learningOutcomes: "", regularPrice: "0", salePrice: "",
  registrationFee: "0", admissionFee: "0", startDate: "", endDate: "", thumbnailUrl: "", brochureUrl: "", isFeatured: false, enrollmentOpen: true,
};
const classLevels = ["PLAY", "NURSERY", "LKG", "UKG", ...Array.from({ length: 12 }, (_, index) => `CLASS_${index + 1}`)];
const label = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
const dateValue = (value?: string | null) => value ? value.slice(0, 10) : "";
const nullable = (value: string) => value.trim() || null;

export default function CourseForm({ courseId }: { courseId?: string }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(blank);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [exams, setExams] = useState<NamedOption[]>([]);
  const [skills, setSkills] = useState<NamedOption[]>([]);
  const [subjects, setSubjects] = useState<NamedOption[]>([]);
  const [subjectIds, setSubjectIds] = useState<string[]>([]);
  const [subjectSaving, setSubjectSaving] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [slugOverridden, setSlugOverridden] = useState(Boolean(courseId));
  const senior = ["CLASS_11", "CLASS_12"].includes(form.classLevel);
  const science = senior && form.academicStream === "SCIENCE";
  const taxonomyReady = form.categoryType === "ACADEMIC" ? Boolean(form.academicBoard && form.classLevel && (!senior || form.academicStream) && (!science || form.scienceCombination && form.academicPreparation) && (form.academicBoard !== "OTHER" || form.customBoardName.trim())) : form.categoryType === "COMPETITIVE" ? Boolean(form.competitiveExamId) : form.categoryType === "SKILL_BASED" ? Boolean(form.skillCategoryId) : false;

  useEffect(() => {
    const headers = { Authorization: `Bearer ${getAccessToken() ?? ""}` };
    Promise.all([
      fetch(`${API}/admin/course-taxonomy/options`, { headers }),
      fetch(`${API}/admin/branches?limit=100&status=active`, { headers }),
      fetch(`${API}/admin/subjects/options`, { headers }),
      courseId ? fetch(`${API}/admin/courses/${courseId}`, { headers }) : Promise.resolve(null),
    ]).then(async ([taxonomyResponse, branchResponse, subjectResponse, courseResponse]) => {
      const taxonomy = await taxonomyResponse.json();
      const branchJson = await branchResponse.json();
      const subjectJson = await subjectResponse.json();
      if (!taxonomyResponse.ok) throw new Error(taxonomy?.error?.message ?? "Unable to load course options");
      if (!branchResponse.ok) throw new Error(branchJson?.error?.message ?? "Unable to load branches");
      if (!subjectResponse.ok) throw new Error(subjectJson?.error?.message ?? "Unable to load subjects");
      setExams(taxonomy.data.competitiveExams); setSkills(taxonomy.data.skillCategories); setBranches(branchJson.data);
      setSubjects(subjectJson.data ?? []);
      if (courseResponse) {
        const courseJson = await courseResponse.json();
        if (!courseResponse.ok) throw new Error(courseJson?.error?.message ?? "Unable to load course");
        const course = courseJson.data;
        setForm({
          title: course.title, slug: course.slug, courseCode: course.courseCode, categoryType: course.categoryType ?? "",
          academicBoard: course.academicBoard ?? "", customBoardName: course.customBoardName ?? "", classLevel: course.classLevel ?? "",
          academicStream: course.academicStream ?? "", scienceCombination: course.scienceCombination ?? "", academicPreparation: course.academicPreparation ?? "",
          competitiveExamId: course.competitiveExamId ?? "", skillCategoryId: course.skillCategoryId ?? "", language: course.language,
          mode: course.mode, status: course.status, branchId: course.branchId ?? "", durationDays: course.durationDays?.toString() ?? "",
          shortDescription: course.shortDescription ?? "", fullDescription: course.fullDescription, eligibility: course.eligibility ?? "",
          learningOutcomes: course.learningOutcomes ?? "", regularPrice: (course.regularPricePaise / 100).toString(),
          salePrice: course.salePricePaise == null ? "" : (course.salePricePaise / 100).toString(), registrationFee: (course.registrationFeePaise / 100).toString(),
          admissionFee: (course.admissionFeePaise / 100).toString(), startDate: dateValue(course.startDate), endDate: dateValue(course.endDate),
          thumbnailUrl: course.thumbnailUrl ?? "", brochureUrl: course.brochureUrl ?? "", isFeatured: course.isFeatured, enrollmentOpen: course.enrollmentOpen,
        });
        setSubjectIds((course.subjects ?? []).map((row: { subject: { id: string } }) => row.subject.id));
      }
    }).catch(cause => setError(cause instanceof Error ? cause.message : "Unable to prepare course form")).finally(() => setLoading(false));
  }, [courseId]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm(current => ({ ...current, [key]: value }));
  const changeTitle = (title: string) => {
    setForm(current => ({ ...current, title, ...(!slugOverridden ? { slug: title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120) } : {}) }));
  };
  const changeCategory = (categoryType: CategoryType) => setForm(current => ({ ...current, categoryType,
    classLevel: "", academicBoard: "", customBoardName: "", academicStream: "", scienceCombination: "", academicPreparation: "",
    competitiveExamId: "", skillCategoryId: "",
  }));
  const changeClass = (classLevel: string) => setForm(current => ({ ...current, classLevel,
    ...(!["CLASS_11", "CLASS_12"].includes(classLevel) ? { academicStream: "", scienceCombination: "", academicPreparation: "" } : {}),
  }));
  const changeStream = (academicStream: string) => setForm(current => ({ ...current, academicStream,
    ...(academicStream !== "SCIENCE" ? { scienceCombination: "", academicPreparation: "" } : {}),
  }));

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError("");
    const money = (value: string) => Math.round(Number(value) * 100);
    const payload = {
      title: form.title.trim(), slug: form.slug.trim(), courseCode: form.courseCode.trim().toUpperCase(), categoryType: form.categoryType,
      academicBoard: nullable(form.academicBoard), customBoardName: nullable(form.customBoardName), classLevel: nullable(form.classLevel),
      academicStream: nullable(form.academicStream), scienceCombination: nullable(form.scienceCombination), academicPreparation: nullable(form.academicPreparation),
      competitiveExamId: nullable(form.competitiveExamId), skillCategoryId: nullable(form.skillCategoryId), language: form.language.trim(), mode: form.mode,
      status: form.status, branchId: nullable(form.branchId), durationDays: form.durationDays ? Number(form.durationDays) : null,
      shortDescription: nullable(form.shortDescription), fullDescription: form.fullDescription.trim(), eligibility: nullable(form.eligibility),
      learningOutcomes: nullable(form.learningOutcomes), regularPricePaise: money(form.regularPrice), salePricePaise: form.salePrice ? money(form.salePrice) : null,
      registrationFeePaise: money(form.registrationFee), admissionFeePaise: money(form.admissionFee), startDate: nullable(form.startDate), endDate: nullable(form.endDate),
      thumbnailUrl: nullable(form.thumbnailUrl), brochureUrl: nullable(form.brochureUrl), isFeatured: form.isFeatured, enrollmentOpen: form.enrollmentOpen,
    };
    try {
      const response = await fetch(courseId ? `${API}/admin/courses/${courseId}` : `${API}/admin/courses`, { method: courseId ? "PATCH" : "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAccessToken() ?? ""}` }, body: JSON.stringify(payload) });
      const json = await response.json().catch(() => null);
      if (!response.ok) throw new Error(json?.error?.message ?? "Unable to save course");
      router.push(`/admin/courses?${courseId ? "updated" : "created"}=1`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save course"); setSaving(false); }
  };
  const toggleSubject = async (subjectId: string, checked: boolean) => {
    if (!courseId) return;
    setSubjectSaving(subjectId); setError("");
    try {
      const response = await fetch(`${API}/admin/courses/${courseId}/subjects${checked ? "" : `/${subjectId}`}`, { method: checked ? "POST" : "DELETE", headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAccessToken() ?? ""}` }, ...(checked ? { body: JSON.stringify({ subjectId }) } : {}) });
      const body = response.status === 204 ? null : await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message ?? "Unable to update course subjects");
      setSubjectIds(current => checked ? [...new Set([...current, subjectId])] : current.filter(id => id !== subjectId));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to update course subjects"); }
    finally { setSubjectSaving(""); }
  };

  return <div className="min-h-screen bg-slate-50 dark:bg-slate-950"><Sidebar /><main className="p-5 md:ml-64 md:p-10"><div className="mx-auto max-w-5xl">
    <Link href="/admin/courses" className="inline-flex items-center gap-2 text-sm font-semibold text-brand-700"><ArrowLeft size={17} />Back to courses</Link>
    <h1 className="mt-5 text-3xl font-bold">{courseId ? "Edit Course" : "Add Course"}</h1><p className="mt-1 text-sm text-slate-500">Configure the offering using its academic, competitive, or skill taxonomy.</p>
    {error && <p role="alert" className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    {loading ? <div className="mt-8 grid min-h-56 place-items-center rounded-2xl border bg-white"><Loader2 className="animate-spin text-brand-700" /></div> : <form onSubmit={submit} className="mt-6 space-y-7 rounded-2xl border bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <Section title="Core details"><Field label="Course title" value={form.title} onChange={changeTitle} minLength={3} /><Field label="Course code" value={form.courseCode} onChange={value => set("courseCode", value)} minLength={2} maxLength={30} /><Field label="Slug" value={form.slug} onChange={value => { setSlugOverridden(true); set("slug", value.toLowerCase()); }} pattern="[a-z0-9-]+" />
        <Select label="Category" value={form.categoryType} onChange={value => changeCategory(value as CategoryType)} placeholder="Select category" options={[["ACADEMIC", "Academic"], ["COMPETITIVE", "Competitive"], ["SKILL_BASED", "Skill Based"]]} />
        {form.categoryType === "ACADEMIC" && <><Select label="Board" value={form.academicBoard} onChange={value => set("academicBoard", value)} placeholder="Select board" options={["CBSE", "ICSE", "ISC", "STATE_BOARD", "OTHER"].map(value => [value, label(value)])} /><Select label="Class level" value={form.classLevel} onChange={changeClass} placeholder="Select class level" options={classLevels.map(value => [value, label(value)])} />{form.academicBoard === "OTHER" && <Field label="Custom board name" value={form.customBoardName} onChange={value => set("customBoardName", value)} maxLength={120} />}{senior && <Select label="Stream" value={form.academicStream} onChange={changeStream} placeholder="Select stream" options={["SCIENCE", "COMMERCE", "HUMANITIES"].map(value => [value, label(value)])} />}{science && <><Select label="Science combination" value={form.scienceCombination} onChange={value => set("scienceCombination", value)} placeholder="Select combination" options={["PCM", "PCB", "PCMB"].map(value => [value, value])} /><Select label="Preparation" value={form.academicPreparation} onChange={value => set("academicPreparation", value)} placeholder="Select preparation" options={[["ACADEMIC_ONLY", "Academic Only"], ["ACADEMIC_JEE", "Academic + JEE"], ["ACADEMIC_NEET", "Academic + NEET"]]} /></>}</>}
        {form.categoryType === "COMPETITIVE" && <SearchSelect label="Competitive exam" value={form.competitiveExamId} onChange={value => set("competitiveExamId", value)} options={exams} />}
        {form.categoryType === "SKILL_BASED" && <SearchSelect label="Skill category" value={form.skillCategoryId} onChange={value => set("skillCategoryId", value)} options={skills} />}
        <Field label="Language" value={form.language} onChange={value => set("language", value)} minLength={2} /><Select label="Mode" value={form.mode} onChange={value => set("mode", value)} placeholder="Select mode" options={["ONLINE", "OFFLINE", "HYBRID"].map(value => [value, label(value)])} /><Select label="Status" value={form.status} onChange={value => set("status", value)} options={["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"].map(value => [value, label(value)])} /><Select label="Branch" value={form.branchId} onChange={value => set("branchId", value)} required={false} placeholder="All branches" options={branches.map(branch => [branch.id, branch.branchName])} /><Field label="Duration (days, optional)" type="number" min="1" required={false} value={form.durationDays} onChange={value => set("durationDays", value)} />
      </Section>
      <Section title="Descriptions"><Area label="Short description (optional)" required={false} maxLength={300} value={form.shortDescription} onChange={value => set("shortDescription", value)} /><Area label="Full description" minLength={10} value={form.fullDescription} onChange={value => set("fullDescription", value)} /><Area label="Eligibility (optional)" required={false} value={form.eligibility} onChange={value => set("eligibility", value)} /><Area label="Learning outcomes (optional)" required={false} value={form.learningOutcomes} onChange={value => set("learningOutcomes", value)} /></Section>
      {courseId ? <CourseSubjects options={subjects} selected={subjectIds} savingId={subjectSaving} onToggle={toggleSubject} /> : <p className="rounded-xl bg-brand-50 p-4 text-sm text-brand-800">After creating the course, edit it to assign subjects from Subject Master.</p>}
      <Section title="Pricing and schedule"><Field label="Regular price (₹)" type="number" min="0" step="0.01" value={form.regularPrice} onChange={value => set("regularPrice", value)} /><Field label="Sale price (₹, optional)" type="number" min="0" step="0.01" required={false} value={form.salePrice} onChange={value => set("salePrice", value)} /><Field label="Registration fee (₹)" type="number" min="0" step="0.01" value={form.registrationFee} onChange={value => set("registrationFee", value)} /><Field label="Admission fee (₹)" type="number" min="0" step="0.01" value={form.admissionFee} onChange={value => set("admissionFee", value)} /><Field label="Start date (optional)" type="date" required={false} value={form.startDate} onChange={value => set("startDate", value)} /><Field label="End date (optional)" type="date" required={false} value={form.endDate} onChange={value => set("endDate", value)} /></Section>
      <Section title="Media and availability"><Field label="Thumbnail URL (optional)" type="url" required={false} value={form.thumbnailUrl} onChange={value => set("thumbnailUrl", value)} /><Field label="Brochure URL (optional)" type="url" required={false} value={form.brochureUrl} onChange={value => set("brochureUrl", value)} /><Check label="Featured course" checked={form.isFeatured} onChange={value => set("isFeatured", value)} /><Check label="Enrollment open" checked={form.enrollmentOpen} onChange={value => set("enrollmentOpen", value)} /></Section>
      <div className="flex justify-end gap-3"><Link href="/admin/courses" className="rounded-xl border px-5 py-3 text-sm font-semibold">Cancel</Link><button disabled={saving || !taxonomyReady} className="inline-flex items-center gap-2 rounded-xl bg-brand-700 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">{saving && <Loader2 size={17} className="animate-spin" />}{courseId ? "Save Changes" : "Create Course"}</button></div>
    </form>}
  </div></main></div>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) { return <fieldset><legend className="text-lg font-bold">{title}</legend><div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div></fieldset>; }
function Field({ label: text, value, onChange, required = true, ...props }: { label: string; value: string; onChange: (value: string) => void; required?: boolean } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "required">) { return <label className="text-sm font-semibold">{text}<input required={required} value={value} onChange={event => onChange(event.target.value)} {...props} className="mt-1.5 w-full rounded-lg border bg-transparent px-3 py-2.5 font-normal dark:border-slate-700" /></label>; }
function Select({ label: text, value, onChange, options, placeholder, required = true }: { label: string; value: string; onChange: (value: string) => void; options: string[][]; placeholder?: string; required?: boolean }) { return <label className="text-sm font-semibold">{text}<select required={required} value={value} onChange={event => onChange(event.target.value)} className="mt-1.5 w-full rounded-lg border bg-transparent px-3 py-2.5 font-normal dark:border-slate-700 dark:bg-slate-900"><option value="">{placeholder ?? "Select"}</option>{options.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>; }
function SearchSelect({ label: text, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: NamedOption[] }) { const [query, setQuery] = useState(""); const visible = useMemo(() => options.filter(option => `${option.name} ${option.code}`.toLowerCase().includes(query.toLowerCase())), [options, query]); return <fieldset className="sm:col-span-2"><legend className="text-sm font-semibold">{text}</legend><label className="relative mt-1.5 block"><Search className="absolute left-3 top-3 text-slate-400" size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={`Search ${text.toLowerCase()}`} className="w-full rounded-lg border bg-transparent py-2.5 pl-9 pr-3 text-sm" /></label><div className="mt-2 grid max-h-40 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2">{visible.map(option => <label key={option.id} className={`flex cursor-pointer items-center gap-2 rounded-lg p-2 text-sm ${value === option.id ? "bg-brand-50 text-brand-800" : "hover:bg-slate-50"}`}><input type="radio" name={text} checked={value === option.id} onChange={() => onChange(option.id)} />{option.name}<span className="text-xs text-slate-400">{option.code}</span></label>)}{!visible.length && <p className="p-2 text-sm text-slate-500">No options found.</p>}</div></fieldset>; }
function Area({ label: text, value, onChange, required = true, ...props }: { label: string; value: string; onChange: (value: string) => void; required?: boolean } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "required">) { return <label className="text-sm font-semibold sm:col-span-2">{text}<textarea required={required} value={value} onChange={event => onChange(event.target.value)} {...props} className="mt-1.5 min-h-24 w-full rounded-lg border bg-transparent px-3 py-2.5 font-normal dark:border-slate-700" /></label>; }
function Check({ label: text, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />{text}</label>; }
function CourseSubjects({ options, selected, savingId, onToggle }: { options: NamedOption[]; selected: string[]; savingId: string; onToggle: (id: string, checked: boolean) => Promise<void> }) { const [query, setQuery] = useState(""); const visible = options.filter(option => `${option.name} ${option.code}`.toLowerCase().includes(query.toLowerCase())); return <fieldset><legend className="text-lg font-bold">Course Subjects</legend><p className="mt-1 text-sm text-slate-500">Only these subjects can be used for course allocations, timetables and academic work. Changes here save immediately.</p><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search subjects" className="mt-3 w-full rounded-lg border bg-transparent px-3 py-2.5" /><div className="mt-2 grid max-h-52 gap-2 overflow-y-auto rounded-lg border p-3 sm:grid-cols-2">{visible.map(option => <label key={option.id} className="flex items-center gap-2 text-sm"><input disabled={Boolean(savingId)} type="checkbox" checked={selected.includes(option.id)} onChange={event => void onToggle(option.id, event.target.checked)} />{savingId === option.id && <Loader2 size={14} className="animate-spin" />}{option.name}<span className="text-xs text-slate-400">{option.code}</span></label>)}{!visible.length && <p className="text-sm text-slate-500">No active confirmed subjects found.</p>}</div></fieldset>; }
