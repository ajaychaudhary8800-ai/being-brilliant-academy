import { AttendanceStatus, Role } from "@prisma/client";
import { Response, Router } from "express";
import { z } from "zod";
import { averageAttendancePercentage, groupAttendanceRecords, summarizeAttendance, type AttendanceReportRecord } from "../lib/attendance-reporting.js";
import { AppError } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { allow, requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, allow(Role.SUPER_ADMIN, Role.BRANCH_ADMIN));
const id = z.string().cuid();
const reportInput = z.object({
  mode: z.enum(["student", "teacher"]).default("student"),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  branchId: id.optional(),
  courseId: id.optional(),
  batchId: id.optional(),
  studentId: id.optional(),
  teacherId: id.optional(),
  status: z.nativeEnum(AttendanceStatus).optional(),
}).superRefine((value, context) => {
  if (!value.month && (!value.from || !value.to)) context.addIssue({ code: z.ZodIssueCode.custom, message: "A month or complete date range is required" });
  if (value.mode === "teacher" && (value.courseId || value.batchId || value.studentId)) context.addIssue({ code: z.ZodIssueCode.custom, message: "Student filters cannot be used for teacher reports" });
  if (value.from && value.to && value.from > value.to) context.addIssue({ code: z.ZodIssueCode.custom, message: "Report start must be on or before report end" });
});
type ReportInput = z.infer<typeof reportInput>;
const day = (value: Date) => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
const dateText = (value: Date) => value.toISOString().slice(0, 10);
function range(value: ReportInput) {
  if (value.month) {
    const [year, month] = value.month.split("-").map(Number);
    return { from: new Date(Date.UTC(year, month - 1, 1)), to: new Date(Date.UTC(year, month, 1)) };
  }
  const from = day(value.from!);
  const to = new Date(day(value.to ?? value.from!));
  to.setUTCDate(to.getUTCDate() + 1);
  return { from, to };
}
async function branchScope(req: AuthRequest, branchId?: string) {
  const ids = req.auth!.role === Role.BRANCH_ADMIN
    ? (await prisma.branchUser.findMany({ where: { userId: req.auth!.userId }, select: { branchId: true } })).map(item => item.branchId)
    : null;
  if (branchId && ids && !ids.includes(branchId)) throw new AppError(403, "BRANCH_FORBIDDEN", "Branch access denied");
  return ids;
}
async function loadReport(req: AuthRequest, input: ReportInput) {
  const { from, to } = range(input);
  const branchIds = await branchScope(req, input.branchId);
  const branchWhere = input.branchId ? { branchId: input.branchId } : branchIds ? { branchId: { in: branchIds } } : {};
  const organizationId = req.auth!.organizationId;
  let records: AttendanceReportRecord[];
  if (input.mode === "student") {
    const batchWhere = { ...branchWhere, ...(input.courseId ? { courseId: input.courseId } : {}), ...(input.batchId ? { id: input.batchId } : {}) };
    const rows = await prisma.attendance.findMany({
      where: { organizationId, date: { gte: from, lt: to }, ...(Object.keys(batchWhere).length ? { batch: batchWhere } : {}), ...(input.studentId ? { studentId: input.studentId } : {}), ...(input.status ? { status: input.status } : {}) },
      select: { date: true, status: true, student: { select: { id: true, name: true, studentProfile: { select: { admissionNo: true } } } }, batch: { select: { name: true, course: { select: { title: true } }, branch: { select: { branchName: true } } } } },
      orderBy: [{ date: "asc" }, { student: { name: "asc" } }],
    });
    records = rows.map(row => ({ date: row.date, status: row.status, person: { id: row.student.id, name: row.student.name, identifier: row.student.studentProfile?.admissionNo ?? null, branch: row.batch.branch.branchName, course: row.batch.course?.title ?? null, batch: row.batch.name } }));
  } else {
    const rows = await prisma.teacherAttendance.findMany({
      where: { organizationId, date: { gte: from, lt: to }, ...(Object.keys(branchWhere).length ? { teacher: branchWhere } : {}), ...(input.teacherId ? { teacherId: input.teacherId } : {}), ...(input.status ? { status: input.status } : {}) },
      select: { date: true, status: true, teacher: { select: { id: true, employeeNo: true, user: { select: { name: true } }, branch: { select: { branchName: true } } } } },
      orderBy: [{ date: "asc" }, { teacher: { user: { name: "asc" } } }],
    });
    records = rows.map(row => ({ date: row.date, status: row.status, person: { id: row.teacher.id, name: row.teacher.user.name, identifier: row.teacher.employeeNo, branch: row.teacher.branch.branchName } }));
  }
  const summary = groupAttendanceRecords(records).map(item => ({ ...item.person, ...item.counts }));
  const totals = summarizeAttendance(records);
  const [branch, course, batch, student, teacher] = await Promise.all([
    input.branchId ? prisma.branch.findFirst({ where: { id: input.branchId, organizationId }, select: { branchName: true } }) : null,
    input.courseId ? prisma.course.findFirst({ where: { id: input.courseId, organizationId }, select: { title: true } }) : null,
    input.batchId ? prisma.batch.findFirst({ where: { id: input.batchId, organizationId }, select: { name: true } }) : null,
    input.studentId ? prisma.user.findFirst({ where: { id: input.studentId, organizationId }, select: { name: true } }) : null,
    input.teacherId ? prisma.teacherProfile.findFirst({ where: { id: input.teacherId, organizationId }, select: { user: { select: { name: true } } } }) : null,
  ]);
  return { mode: input.mode, period: { from: dateText(from), to: dateText(new Date(to.getTime() - 86400000)) }, filters: { branch: branch?.branchName ?? "All", course: course?.title ?? "All", batch: batch?.name ?? "All", student: student?.name ?? "All", teacher: teacher?.user.name ?? "All", status: input.status ?? "All" }, summary, totals: { ...totals, averagePercentage: averageAttendancePercentage(summary.map(item => ({ counts: item }))) }, recordCount: records.length };
}
function label(value: string | null | undefined) { return value || "All"; }
function escapeXml(value: unknown) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;"); }
function exportRows(report: Awaited<ReturnType<typeof loadReport>>, organizationName: string) {
  const headers = report.mode === "student" ? ["Student Name", "Admission No.", "Branch", "Course", "Batch", "Present", "Absent", "Full-Day Leave", "Half-Day Leave", "Late", "Short Leave", "Leave", "Excused", "Attendance Days", "Attendance %"] : ["Teacher Name", "Employee No.", "Branch", "Present", "Absent", "Full-Day Leave", "Half-Day Leave", "Late", "Short Leave", "Leave", "Excused", "Attendance Days", "Attendance %"];
  const rows = report.summary.map(item => report.mode === "student" ? [item.name, label(item.identifier), label(item.branch), label(item.course), label(item.batch), item.present, item.absent, item.fullDayLeave, item.halfDayLeave, item.late, item.shortLeave, item.leave, item.excused, item.total, `${item.percentage}%`] : [item.name, label(item.identifier), label(item.branch), item.present, item.absent, item.fullDayLeave, item.halfDayLeave, item.late, item.shortLeave, item.leave, item.excused, item.total, `${item.percentage}%`]);
  return { headers, rows, metadata: [[organizationName, "Attendance Report"], ["Report type", report.mode === "student" ? "Student Attendance" : "Teacher Attendance"], ["Report period", `${report.period.from} — ${report.period.to}`], ["Branch", label(report.filters.branch)], ["Course", label(report.filters.course)], ["Batch", label(report.filters.batch)], [report.mode === "student" ? "Student" : "Teacher", label(report.mode === "student" ? report.filters.student : report.filters.teacher)], ["Status", label(report.filters.status)]] };
}
function xmlWorkbook(report: Awaited<ReturnType<typeof loadReport>>, organizationName: string) {
  const output = exportRows(report, organizationName);
  const body = [...output.metadata.map(row => `<Row>${row.map(cell => `<Cell><Data ss:Type="String">${escapeXml(cell)}</Data></Cell>`).join("")}</Row>`), `<Row>${output.headers.map(cell => `<Cell><Data ss:Type="String">${escapeXml(cell)}</Data></Cell>`).join("")}</Row>`, ...output.rows.map(row => `<Row>${row.map(cell => `<Cell><Data ss:Type="String">${escapeXml(cell)}</Data></Cell>`).join("")}</Row>`)].join("");
  return `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Header"><Font ss:Bold="1"/></Style></Styles><Worksheet ss:Name="Attendance"><Table>${body}</Table></Worksheet></Workbook>`;
}
function pdfReport(report: Awaited<ReturnType<typeof loadReport>>, organizationName: string) {
  const output = exportRows(report, organizationName);
  const lines = [...output.metadata.map(row => row.join("  |  ")), "", output.headers.join(" | "), ...output.rows.map(row => row.join(" | "))];
  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += 36) pages.push(lines.slice(index, index + 36));
  const fontObject = 3 + pages.length * 2;
  const objects: string[] = ["<< /Type /Catalog /Pages 2 0 R >>", ""];
  const pageRefs: string[] = [];
  for (const page of pages) {
    const content = page.map((line, index) => `BT /F1 ${index < 5 ? 12 : 7} Tf 30 ${810 - index * 21} Td (${line.replace(/[()\\]/g, "\\$&")}) Tj ET`).join("\n");
    const contentObject = objects.length + 1; objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
    const pageObject = objects.length + 1; objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 ${fontObject} 0 R >> >> /Contents ${contentObject} 0 R >>`); pageRefs.push(`${pageObject} 0 R`);
  }
  objects[1] = `<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${pageRefs.length} >>`;
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let pdf = "%PDF-1.4\n"; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf); pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(value => `${String(value).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}
async function organizationName(req: AuthRequest) { return (await prisma.organization.findUnique({ where: { id: req.auth!.organizationId }, select: { name: true } }))?.name ?? "Being Brilliant Academy"; }
router.get("/reports", async (req: AuthRequest, res) => res.json({ data: await loadReport(req, reportInput.parse(req.query)) }));
const exportHandler = async (req: AuthRequest, res: Response) => { const query = reportInput.parse(req.query); const format = z.enum(["pdf", "excel"]).parse(req.query.format); const report = await loadReport(req, query); const name = await organizationName(req); if (format === "pdf") return res.set({ "Content-Type": "application/pdf", "Content-Disposition": "attachment; filename=attendance-report.pdf" }).send(pdfReport(report, name)); return res.set({ "Content-Type": "application/vnd.ms-excel", "Content-Disposition": "attachment; filename=attendance-report.xls" }).send(xmlWorkbook(report, name)); };
router.get("/reports/export", exportHandler);
router.get("/export", exportHandler);

export default router;
