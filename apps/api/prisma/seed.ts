import { PrismaClient, Role, CourseType } from "@prisma/client";
import bcrypt from "bcryptjs";
const prisma = new PrismaClient();
async function main() {
  const passwordHash = await bcrypt.hash("ChangeMe123!", 12);
  const admin = await prisma.user.upsert({ where: { email: "admin@beingbrilliant.in" }, update: {}, create: { name: "Academy Admin", email: "admin@beingbrilliant.in", passwordHash, role: Role.SUPER_ADMIN, emailVerifiedAt: new Date() } });
  const student = await prisma.user.upsert({ where: { email: "student@beingbrilliant.in" }, update: { phone: "9876543210" }, create: { name: "Aarav Singh", email: "student@beingbrilliant.in", phone: "9876543210", passwordHash, role: Role.STUDENT, emailVerifiedAt: new Date() } });
  const parent = await prisma.user.upsert({ where: { email: "parent@beingbrilliant.in" }, update: { name: "Rajesh Singh", phone: "9876543211", role: Role.PARENT, isActive: true }, create: { name: "Rajesh Singh", email: "parent@beingbrilliant.in", phone: "9876543211", passwordHash, role: Role.PARENT, emailVerifiedAt: new Date() } });
  const branchRecords = [
    ["BBA-HQ", "Nandgram", "Nandgram Main Road", "Ghaziabad", "Uttar Pradesh", "201003", "9876501001", "nandgram@beingbrilliant.in", "Amit Sharma", "2022-04-01"],
    ["BBA-RNE", "Raj Nagar Extension", "NH-58, Raj Nagar Extension", "Ghaziabad", "Uttar Pradesh", "201017", "9876501002", "rajnagar@beingbrilliant.in", "Neeraj Gupta", "2022-07-15"],
    ["BBA-SNG", "Shastri Nagar", "Block D, Shastri Nagar", "Ghaziabad", "Uttar Pradesh", "201002", "9876501003", "shastrinagar@beingbrilliant.in", "Kavita Singh", "2023-01-10"],
    ["BBA-WVC", "Wave City", "Wave City Central Avenue", "Ghaziabad", "Uttar Pradesh", "201013", "9876501004", "wavecity@beingbrilliant.in", "Rohit Verma", "2023-06-20"],
    ["BBA-VSD", "Vasundhara", "Sector 11, Vasundhara", "Ghaziabad", "Uttar Pradesh", "201012", "9876501005", "vasundhara@beingbrilliant.in", "Pooja Mehta", "2024-01-05"],
  ] as const;
  const seededBranches = [];
  for (const [branchCode, branchName, address, city, state, pincode, phone, email, managerName, openingDate] of branchRecords) {
    seededBranches.push(await prisma.branch.upsert({ where: { branchCode }, update: { branchName, address, city, state, pincode, phone, email, managerName, openingDate: new Date(openingDate), isActive: true }, create: { branchCode, branchName, address, city, state, pincode, phone, email, managerName, openingDate: new Date(openingDate) } }));
  }
  const branch = seededBranches[0];
  const duplicateBranch = await prisma.branch.findUnique({ where: { branchCode: "BBA-NDG" }, select: { id: true } });
  if (duplicateBranch) {
    await prisma.teacherProfile.updateMany({ where: { branchId: duplicateBranch.id }, data: { branchId: branch.id } });
    await prisma.studentProfile.updateMany({ where: { branchId: duplicateBranch.id }, data: { branchId: branch.id } });
    await prisma.batch.updateMany({ where: { branchId: duplicateBranch.id }, data: { branchId: branch.id } });
    await prisma.branch.delete({ where: { id: duplicateBranch.id } });
  }
  const teacherRecords = [
    ["Dr. Ananya Sharma", "teacher@beingbrilliant.in", "BBA-T-001", "M.Sc. Physics, B.Ed.", "Physics", "9876500001"],
    ["Rahul Verma", "rahul.verma@beingbrilliant.in", "BBA-T-002", "M.Sc. Mathematics, B.Ed.", "Mathematics", "9876500002"],
    ["Neha Kapoor", "neha.kapoor@beingbrilliant.in", "BBA-T-003", "M.A. English, B.Ed.", "English", "9876500003"],
    ["Vikram Joshi", "vikram.joshi@beingbrilliant.in", "BBA-T-004", "M.Sc. Chemistry, B.Ed.", "Chemistry", "9876500004"],
    ["Priya Iyer", "priya.iyer@beingbrilliant.in", "BBA-T-005", "M.Sc. Biology, B.Ed.", "Biology", "9876500005"],
  ] as const;
  const teachers = [];
  for (const [name, email, employeeNo, qualification, specialization, phone] of teacherRecords) {
    const teacher = await prisma.user.upsert({ where: { email }, update: { name, phone, role: Role.TEACHER, isActive: true }, create: { name, email, phone, passwordHash, role: Role.TEACHER, emailVerifiedAt: new Date() } });
    await prisma.teacherProfile.upsert({ where: { userId: teacher.id }, update: { employeeNo, qualification, specialization, branchId: branch.id }, create: { userId: teacher.id, employeeNo, qualification, specialization, branchId: branch.id } });
    teachers.push(teacher);
  }
  const category = await prisma.category.upsert({ where: { slug: "engineering-entrance" }, update: {}, create: { name: "Engineering Entrance", slug: "engineering-entrance" } });
  const course = await prisma.course.upsert({ where: { slug: "jee-2027-foundation" }, update: {}, create: { title: "JEE 2027 Foundation", slug: "jee-2027-foundation", courseCode: "JEE-2027", shortDescription: "JEE foundation programme", fullDescription: "A complete foundation programme for ambitious JEE aspirants.", regularPricePaise: 2499900, salePricePaise: 1499900, durationDays: 365, courseType: CourseType.JEE, classLevel: "CLASS_11", mode: "HYBRID", status: "ACTIVE", isFeatured: true, categoryId: category.id, instructorId: teachers[0].id, createdById: admin.id } });
  const batch = await prisma.batch.upsert({ where: { code: "JEE-27-A" }, update: {}, create: { name: "JEE 2027 – Batch A", code: "JEE-27-A", branchId: branch.id, courseId: course.id, startsAt: new Date("2026-04-01") } });
  const studentProfile = await prisma.studentProfile.upsert({ where: { userId: student.id }, update: { branchId: branch.id, batchId: batch.id, className: "Class 11", fatherName: "Rajesh Singh" }, create: { userId: student.id, admissionNo: "BBA-2026-0001", rollNo: "1", gender: "MALE", dateOfBirth: new Date("2009-01-15"), fatherName: "Rajesh Singh", motherName: "Sunita Singh", className: "Class 11", parentMobile: "9876543210", address: "Delhi", branchId: branch.id, batchId: batch.id, academicSession: "2026-27", admissionDate: new Date("2026-04-01") } });
  await prisma.parentStudent.upsert({ where: { parentId_studentId: { parentId: parent.id, studentId: studentProfile.id } }, update: { relationship: "FATHER" }, create: { parentId: parent.id, studentId: studentProfile.id, relationship: "FATHER" } });
  const module = await prisma.module.upsert({ where: { courseId_position: { courseId: course.id, position: 1 } }, update: {}, create: { courseId: course.id, title: "Physics: Mechanics", position: 1 } });
  await prisma.lesson.upsert({ where: { moduleId_position: { moduleId: module.id, position: 1 } }, update: {}, create: { moduleId: module.id, title: "Kinematics Fundamentals", position: 1, type: "VIDEO", durationSeconds: 1800, preview: true } });
  console.log({ admin: admin.email, course: course.title });
}
main().finally(() => prisma.$disconnect());
