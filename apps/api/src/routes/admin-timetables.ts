import{Prisma,Role,TimetableDay,TimetableStatus}from"@prisma/client";import{Router}from"express";import{validateWeeklyTimetableEntries}from"../lib/timetable-weekly.js";import{validateClassDayEntries}from"../lib/class-day-timetable.js";
import{mapSchoolDayCopy}from"../lib/school-day-copy.js";import{z}from"zod";import{AppError}from"../lib/http.js";import{prisma}from"../lib/prisma.js";import{teacherAssignable,isCoaching}from"../lib/coaching-academic-policy.js";import{allow,requireAuth,type AuthRequest}from"../middleware/auth.js";const router=Router();router.use(requireAuth,allow(Role.SUPER_ADMIN,Role.BRANCH_ADMIN));const time=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),input=z.object({branchId:z.string().cuid(),courseId:z.string().cuid(),batchId:z.string().cuid(),subjectId:z.string().cuid(),teacherId:z.string().cuid(),classroomId:z.string().min(5),day:z.nativeEnum(TimetableDay),startTime:time,endTime:time,periodNumber:z.number().int().positive().max(50),academicSession:z.string().trim().min(4).max(30),remarks:z.string().trim().max(2000).nullable().optional(),status:z.nativeEnum(TimetableStatus).default(TimetableStatus.ACTIVE)}),select={id:true,day:true,startMinute:true,endMinute:true,periodNumber:true,academicSession:true,remarks:true,status:true,createdAt:true,updatedAt:true,branch:{select:{id:true,branchName:true,branchCode:true}},course:{select:{id:true,title:true,courseCode:true}},batch:{select:{id:true,name:true,code:true}},subject:{select:{id:true,name:true,code:true}},teacher:{select:{id:true,employeeNo:true,user:{select:{name:true,email:true}}}},classroom:{select:{id:true,name:true,code:true,capacity:true}}}as const,shape=(x:any)=>({...x,startTime:clock(x.startMinute),endTime:clock(x.endMinute),branch:{...x.branch,name:x.branch.branchName,code:x.branch.branchCode}});function minute(s:string){const[h,m]=s.split(":").map(Number);return h*60+m}function clock(n:number){return`${String(Math.floor(n/60)).padStart(2,"0")}:${String(n%60).padStart(2,"0")}`};async function scope(req:AuthRequest){if(req.auth!.role!==Role.BRANCH_ADMIN)return null;return(await prisma.branchUser.findMany({where:{userId:req.auth!.userId},select:{branchId:true}})).map(x=>x.branchId)}async function access(req:AuthRequest,id:string,db:Prisma.TransactionClient|typeof prisma=prisma){const owned=await db.branch.findFirst({where:{id,organizationId:req.auth!.organizationId},select:{id:true}});if(!owned)throw new AppError(403,"INSTITUTION_BRANCH_FORBIDDEN","Branch is outside this institution");const ids=await scope(req);if(ids&&!ids.includes(id))throw new AppError(403,"BRANCH_FORBIDDEN","Branch access denied")}
async function validate(d:z.infer<typeof input>,exclude?:string,db:Prisma.TransactionClient|typeof prisma=prisma){const start=minute(d.startTime),end=minute(d.endTime);if(end<=start)throw new AppError(422,"INVALID_TIME_RANGE","End time must be after start time");const[batch,subject,teacher,room]=await Promise.all([db.batch.findUnique({where:{id:d.batchId},select:{organizationId:true,branchId:true,courseId:true,academicSession:true,academicSessionId:true}}),db.courseSubject.findUnique({where:{courseId_subjectId:{courseId:d.courseId,subjectId:d.subjectId}},select:{isActive:true}}),db.teacherProfile.findUnique({where:{id:d.teacherId},select:{organizationId:true,branchId:true}}),db.classroom.findUnique({where:{id:d.classroomId},select:{branchId:true,isActive:true}})]);if(!batch||batch.branchId!==d.branchId||batch.courseId!==d.courseId||batch.academicSession!==d.academicSession)throw new AppError(422,"INVALID_BATCH_RELATION","Academic group must belong to the selected branch, course and session");if(!subject?.isActive)throw new AppError(422,"INVALID_SUBJECT_RELATION","Subject must belong to the selected Course");const org=await db.organization.findUnique({where:{id:batch.organizationId},select:{groupLabelType:true}});if(!teacher||!teacherAssignable(org?.groupLabelType,teacher,d.branchId,batch.organizationId))throw new AppError(422,"INVALID_TEACHER_RELATION","Teacher is not eligible for the selected Branch");if(!room||room.branchId!==d.branchId||!room.isActive)throw new AppError(422,"INVALID_CLASSROOM_RELATION","Classroom must be active in the selected Branch");const[configuredCount,configuredPeriod]=await Promise.all([db.timetablePeriod.count({where:{branchId:d.branchId,academicSessionId:batch.academicSessionId,day:d.day,isActive:true}}),db.timetablePeriod.findUnique({where:{branchId_academicSessionId_day_periodNumber:{branchId:d.branchId,academicSessionId:batch.academicSessionId,day:d.day,periodNumber:d.periodNumber}}})]);if(configuredCount&&(!configuredPeriod||!configuredPeriod.isActive||configuredPeriod.type!=="TEACHING"||configuredPeriod.startMinute!==start||configuredPeriod.endMinute!==end))throw new AppError(422,"INVALID_CONFIGURED_PERIOD","Select an active teaching period from the configured timetable day");const overlap={day:d.day,status:{not:TimetableStatus.ARCHIVED},startMinute:{lt:end},endMinute:{gt:start},academicSessionId:batch.academicSessionId,...(exclude?{id:{not:exclude}}:{})};const[batchConflict,teacherConflict,roomConflict]=await Promise.all([db.timetable.findFirst({where:{...overlap,batchId:d.batchId},select:{id:true}}),db.timetable.findFirst({where:{...overlap,academicSessionId:undefined,teacherId:d.teacherId},select:{id:true}}),db.timetable.findFirst({where:{...overlap,classroomId:d.classroomId},select:{id:true}})]);if(batchConflict)throw new AppError(409,"BATCH_SCHEDULE_CONFLICT","Academic group already has an overlapping period");if(teacherConflict)throw new AppError(409,"TEACHER_SCHEDULE_CONFLICT","Teacher already has an overlapping period");if(roomConflict)throw new AppError(409,"CLASSROOM_SCHEDULE_CONFLICT","Classroom already has an overlapping period");return{startMinute:start,endMinute:end,academicSessionId:batch.academicSessionId}}
router.get("/timetables/options",async(req:AuthRequest,res)=>{const ids=await scope(req),where={organizationId:req.auth!.organizationId,isActive:true,...(ids?{id:{in:ids}}:{})};const org=await prisma.organization.findUnique({where:{id:req.auth!.organizationId},select:{groupLabelType:true}});const coaching=isCoaching(org?.groupLabelType);const[branches,batches,teachers,classrooms]=await Promise.all([prisma.branch.findMany({where,select:{id:true,branchName:true,branchCode:true}}),prisma.batch.findMany({where:{organizationId:req.auth!.organizationId,status:"ACTIVE",branch:{isActive:true,organizationId:req.auth!.organizationId},...(ids?{branchId:{in:ids}}:{})},select:{id:true,name:true,code:true,branchId:true,courseId:true,academicSession:true,academicSessionId:true,course:{select:{id:true,title:true}}}}),prisma.teacherProfile.findMany({where:{organizationId:req.auth!.organizationId,user:{isActive:true},...(!coaching && ids?{branchId:{in:ids}}:{})},select:{id:true,branchId:true,user:{select:{name:true}}}}),prisma.classroom.findMany({where:{isActive:true,branch:{organizationId:req.auth!.organizationId},...(ids?{branchId:{in:ids}}:{})},select:{id:true,name:true,code:true,branchId:true,capacity:true}})]);res.json({data:{branches:branches.map(x=>({...x,name:x.branchName,code:x.branchCode})),batches,teachers,classrooms,subjects:[]}})});
router.get("/timetables/dashboard",async(req:AuthRequest,res)=>{const ids=await scope(req),where={branch:{organizationId:req.auth!.organizationId},...(ids?{branchId:{in:ids}}:{})};const[total,active,archived,teachers,rooms]=await Promise.all([prisma.timetable.count({where}),prisma.timetable.count({where:{...where,status:TimetableStatus.ACTIVE}}),prisma.timetable.count({where:{...where,status:TimetableStatus.ARCHIVED}}),prisma.timetable.findMany({where,distinct:["teacherId"],select:{teacherId:true}}),prisma.timetable.findMany({where,distinct:["classroomId"],select:{classroomId:true}})]);res.json({data:{total,active,archived,teachers:teachers.length,classrooms:rooms.length}})});
router.get("/timetables/export",async(req:AuthRequest,res)=>{const format=z.enum(["excel","pdf"]).parse(req.query.format),ids=await scope(req),data=(await prisma.timetable.findMany({where:{branch:{organizationId:req.auth!.organizationId},...(ids?{branchId:{in:ids}}:{})},select,orderBy:[{day:"asc"},{startMinute:"asc"}]})).map(shape),rows=data.map((x:any)=>[x.day,x.startTime,x.endTime,x.periodNumber,x.branch.name,x.course.title,x.batch.name,x.subject.name,x.teacher.user.name,x.classroom.name,x.academicSession,x.status]);if(format==="pdf")return pdf(res,rows.map((x:any)=>x.join(" | ")));const all=[["Day","Start","End","Period","Branch","Course","Batch","Subject","Teacher","Classroom","Session","Status"],...rows],xml=`<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Timetable"><Table>${all.map(r=>`<Row>${r.map(v=>`<Cell><Data ss:Type="String">${esc(String(v))}</Data></Cell>`).join("")}</Row>`).join("")}</Table></Worksheet></Workbook>`;res.set({"Content-Type":"application/vnd.ms-excel","Content-Disposition":"attachment; filename=timetable.xls"}).send(xml)});
router.get("/timetables",async(req:AuthRequest,res)=>{const q=z.object({page:z.coerce.number().int().positive().default(1),limit:z.coerce.number().int().min(1).max(100).default(20),search:z.string().trim().optional(),branchId:z.string().cuid().optional(),courseId:z.string().cuid().optional(),batchId:z.string().cuid().optional(),subjectId:z.string().cuid().optional(),teacherId:z.string().cuid().optional(),classroomId:z.string().optional(),day:z.nativeEnum(TimetableDay).optional(),status:z.nativeEnum(TimetableStatus).optional(),academicSession:z.string().optional(),sortBy:z.enum(["day","startMinute","periodNumber","academicSession","status","createdAt"]).default("day"),sortOrder:z.enum(["asc","desc"]).default("asc")}).parse(req.query),ids=await scope(req);if(q.branchId)await access(req,q.branchId);const where={branch:{organizationId:req.auth!.organizationId},...(ids?{branchId:{in:ids}}:{}),...(q.branchId?{branchId:q.branchId}:{}),...(q.courseId?{courseId:q.courseId}:{}),...(q.batchId?{batchId:q.batchId}:{}),...(q.subjectId?{subjectId:q.subjectId}:{}),...(q.teacherId?{teacherId:q.teacherId}:{}),...(q.classroomId?{classroomId:q.classroomId}:{}),...(q.day?{day:q.day}:{}),...(q.status?{status:q.status}:{}),...(q.academicSession?{academicSession:q.academicSession}:{}),...(q.search?{OR:[{batch:{name:{contains:q.search,mode:"insensitive"as const}}},{subject:{name:{contains:q.search,mode:"insensitive"as const}}},{teacher:{user:{name:{contains:q.search,mode:"insensitive"as const}}}},{classroom:{name:{contains:q.search,mode:"insensitive"as const}}}]}:{})};const[total,data]=await prisma.$transaction([prisma.timetable.count({where}),prisma.timetable.findMany({where,select,skip:(q.page-1)*q.limit,take:q.limit,orderBy:{[q.sortBy]:q.sortOrder}})]);res.json({data:data.map(shape),meta:{total,page:q.page,limit:q.limit,totalPages:Math.max(1,Math.ceil(total/q.limit))}})});

type TimetableEntry = z.infer<typeof input>;
const weekInput = z.object({ entries: z.array(input).min(1).max(7) });
type WeekIssue = { day: TimetableDay; code: string; message: string };
const weekdayOrder: TimetableDay[] = [
  TimetableDay.MONDAY, TimetableDay.TUESDAY, TimetableDay.WEDNESDAY,
  TimetableDay.THURSDAY, TimetableDay.FRIDAY, TimetableDay.SATURDAY, TimetableDay.SUNDAY,
];

/** Serialize timetable writes for one branch. Applies to bulk and individual creates. */
async function lockTimetableBranch(tx: Prisma.TransactionClient, branchId: string) {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${"erp-timetable:" + branchId}))`;
}

async function checkWeek(
  req: AuthRequest,
  entries: TimetableEntry[],
  db: Prisma.TransactionClient | typeof prisma = prisma,
) {
  validateWeeklyTimetableEntries(entries);
  const first = entries[0];
  await access(req, first.branchId);
  // Even a Super Admin is limited to their own institution.
  const owned = await db.branch.findFirst({
    where: { id: first.branchId, organizationId: req.auth!.organizationId },
    select: { id: true },
  });
  if (!owned) throw new AppError(403, "INSTITUTION_BRANCH_FORBIDDEN", "Selected branch is outside this institution");

  const conflicts: WeekIssue[] = [];
  for (const entry of entries) {
    try {
      await validate(entry, undefined, db);
      // Archived entries still occupy the legacy database's exact-slot unique key.
      const batch = await db.batch.findUnique({ where: { id: entry.batchId }, select: { academicSessionId: true } });
      if (batch) {
        const existing = await db.timetable.findFirst({
          where: { branchId: entry.branchId, batchId: entry.batchId, day: entry.day,
            startMinute: minute(entry.startTime), endMinute: minute(entry.endTime) },
          select: { id: true },
        });
        if (existing) throw new AppError(409, "TIMETABLE_SLOT_EXISTS", "This class already has a timetable entry at this time (including archived entries)");
      }
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      conflicts.push({ day: entry.day, code: error.code, message: error.message });
    }
  }

  // Advisory workload warning; do not change or override approved teacher allocations.
  const allocation = await db.teacherAllocation.findFirst({
    where: { organizationId: req.auth!.organizationId, branchId: first.branchId,
      batchId: first.batchId, teacherId: first.teacherId, subjectId: first.subjectId,
      status: "ACTIVE" },
    select: { weeklyPeriods: true },
    orderBy: { updatedAt: "desc" },
  });
  const batch = await db.batch.findUnique({ where: { id: first.batchId }, select: { academicSessionId: true } });
  const existingCount = batch ? await db.timetable.count({
    where: { organizationId: req.auth!.organizationId, branchId: first.branchId,
      academicSessionId: batch.academicSessionId, batchId: first.batchId,
      teacherId: first.teacherId, subjectId: first.subjectId, status: { not: TimetableStatus.ARCHIVED } },
  }) : 0;
  const warnings = allocation && existingCount + entries.length > allocation.weeklyPeriods
    ? [`This creates ${existingCount + entries.length} weekly timetable periods, above the teacher allocation of ${allocation.weeklyPeriods} for this subject and section.`]
    : [];
  return {
    entries: [...entries].sort((a,b)=>weekdayOrder.indexOf(a.day)-weekdayOrder.indexOf(b.day)),
    conflicts, warnings,
    weeklyAllocation: allocation?.weeklyPeriods ?? null,
    existingScheduled: existingCount,
  };
}


// Class-first school planner: transactional creation of several teaching
// periods on a single weekday. Shared BREAK periods live in TimetablePeriod
// and do not create artificial academic subjects or consume teacher workload.
const classDayInput = z.object({ entries: z.array(input).min(1).max(50) });

async function checkClassDay(
  req: AuthRequest, entries: TimetableEntry[],
  db: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const ordered = validateClassDayEntries(entries);
  const first = ordered[0];
  await access(req, first.branchId);
  const [branch, batch] = await Promise.all([
    db.branch.findFirst({ where: {
      id: first.branchId, organizationId: req.auth!.organizationId,
      isActive: true,
    }, select: { id: true } }),
    db.batch.findFirst({ where: {
      id: first.batchId, branchId: first.branchId,
      organizationId: req.auth!.organizationId,
      status: "ACTIVE",
    }, select: { id: true, academicSessionId: true } }),
  ]);
  if (!branch || !batch) {
    throw new AppError(403, "SCHOOL_CLASS_ACCESS_DENIED", "Class or section is unavailable in this institution");
  }
  const organization = await db.organization.findUnique({
    where: { id: req.auth!.organizationId }, select: { groupLabelType: true },
  });
  if (organization?.groupLabelType !== "SECTION") {
    throw new AppError(422, "SCHOOL_MODE_REQUIRED", "Class-wise day scheduling is available only to schools");
  }

  const conflicts: Array<{ periodNumber: number; code: string; message: string }> = [];
  for (const entry of ordered) {
    try {
      // A school teacher must hold an active subject allocation for this
      // section; a valid teacher and subject independently are insufficient.
      const assigned = await db.teacherAllocation.findFirst({
        where: { organizationId: req.auth!.organizationId, branchId: entry.branchId,
          academicSessionId: batch.academicSessionId, batchId: entry.batchId,
          courseId: entry.courseId, teacherId: entry.teacherId,
          subjectId: entry.subjectId, status: "ACTIVE" },
        select: { id: true },
      });
      if (!assigned) throw new AppError(422, "SCHOOL_TEACHER_NOT_ALLOCATED",
        "This subject is not actively allocated to the selected teacher for this section");
      await validate(entry, undefined, db);
      const existing = await db.timetable.findFirst({
        where: {
          batchId: entry.batchId, day: entry.day,
          startMinute: minute(entry.startTime), endMinute: minute(entry.endTime),
        },
        select: { id: true },
      });
      if (existing) {
        throw new AppError(409, "TIMETABLE_SLOT_EXISTS", "The class already has an entry in this slot, including archived records");
      }
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      conflicts.push({ periodNumber: entry.periodNumber, code: error.code, message: error.message });
    }
  }

  const warnings: string[] = [];
  const grouped = new Map<string, { entry: TimetableEntry; count: number }>();
  for (const entry of ordered) {
    const key = entry.teacherId + ":" + entry.subjectId;
    const group = grouped.get(key);
    if (group) group.count += 1;
    else grouped.set(key, { entry, count: 1 });
  }
  for (const group of grouped.values()) {
    const entry = group.entry;
    const [allocation, count] = await Promise.all([
      db.teacherAllocation.findFirst({
        where: { organizationId: req.auth!.organizationId, branchId: entry.branchId,
          batchId: entry.batchId, teacherId: entry.teacherId,
          subjectId: entry.subjectId, status: "ACTIVE" },
        select: { weeklyPeriods: true },
        orderBy: { updatedAt: "desc" },
      }),
      db.timetable.count({ where: {
        organizationId: req.auth!.organizationId, branchId: entry.branchId,
        academicSessionId: batch.academicSessionId,
        batchId: entry.batchId, teacherId: entry.teacherId,
        subjectId: entry.subjectId, status: { not: TimetableStatus.ARCHIVED },
      } }),
    ]);
    if (allocation && count + group.count > allocation.weeklyPeriods) {
      warnings.push(`Teacher ${entry.teacherId} / subject ${entry.subjectId}: ${count + group.count} scheduled periods exceed allocation of ${allocation.weeklyPeriods}.`);
    }
  }
  return { entries: ordered, count: ordered.length, conflicts, warnings };
}

// Copy saved active teaching lessons from one weekday to one or more empty
// weekdays in the same school section. Bell BREAK slots are organization
// configuration and are deliberately not duplicated as fake subject lessons.
const copyDayInput = z.object({
  branchId: z.string().cuid(), batchId: z.string().cuid(),
  sourceDay: z.nativeEnum(TimetableDay),
  targetDays: z.array(z.nativeEnum(TimetableDay)).min(1).max(6),
}).superRefine((value,ctx)=>{
  if (new Set(value.targetDays).size!==value.targetDays.length ||
      value.targetDays.includes(value.sourceDay)) {
    ctx.addIssue({code:"custom",message:"Choose distinct target weekdays different from the source"});
  }
});

async function planSchoolDayCopy(
  req:AuthRequest, data:z.infer<typeof copyDayInput>,
  db:Prisma.TransactionClient|typeof prisma=prisma,
) {
  await access(req,data.branchId);
  const [org,branch,batch]=await Promise.all([
    db.organization.findUnique({where:{id:req.auth!.organizationId},select:{groupLabelType:true}}),
    db.branch.findFirst({where:{id:data.branchId,organizationId:req.auth!.organizationId,isActive:true},select:{id:true}}),
    db.batch.findFirst({where:{id:data.batchId,organizationId:req.auth!.organizationId,
      branchId:data.branchId,status:"ACTIVE"},select:{id:true,courseId:true,academicSession:true,academicSessionId:true}}),
  ]);
  if (org?.groupLabelType!=="SECTION") throw new AppError(422,"SCHOOL_MODE_REQUIRED","Copy day is available only for school sections");
  if (!branch||!batch) throw new AppError(403,"SCHOOL_CLASS_ACCESS_DENIED","Selected school section is unavailable");
  const [sourceSlots,sourceLessons]=await Promise.all([
    db.timetablePeriod.findMany({where:{branchId:data.branchId,academicSessionId:batch.academicSessionId,day:data.sourceDay,isActive:true},
      select:{periodNumber:true,startMinute:true,endMinute:true,type:true,label:true,isActive:true}}),
    db.timetable.findMany({where:{organizationId:req.auth!.organizationId,branchId:data.branchId,
      batchId:data.batchId,academicSessionId:batch.academicSessionId,day:data.sourceDay,status:TimetableStatus.ACTIVE},
      select:{id:true,periodNumber:true,startMinute:true,endMinute:true,subjectId:true,teacherId:true,classroomId:true,remarks:true}}),
  ]);
  if (!sourceLessons.length) throw new AppError(422,"COPY_EMPTY_SOURCE_DAY","Save the source day's lessons before copying");
  const conflicts:Array<{day:TimetableDay;periodNumber:number;code:string;message:string}>=[];
  const warnings:string[]=[];
  const plans:Array<{day:TimetableDay;entries:TimetableEntry[];sourceIds:string[]}>=[];
  for(const targetDay of data.targetDays){
    const [targetSlots,existing]=await Promise.all([
      db.timetablePeriod.findMany({where:{branchId:data.branchId,academicSessionId:batch.academicSessionId,day:targetDay,isActive:true},
        select:{periodNumber:true,startMinute:true,endMinute:true,type:true,label:true,isActive:true}}),
      db.timetable.count({where:{organizationId:req.auth!.organizationId,branchId:data.branchId,
        batchId:data.batchId,academicSessionId:batch.academicSessionId,day:targetDay}}),
    ]);
    if(existing){
      conflicts.push({day:targetDay,periodNumber:0,code:"COPY_TARGET_NOT_EMPTY",
        message:"Target day already has timetable entries (including inactive/archived). No entries will be overwritten."});
      continue;
    }
    try{
      const copied=mapSchoolDayCopy(sourceSlots,targetSlots,sourceLessons);
      const entries=copied.map(row=>input.parse({
        branchId:data.branchId,courseId:batch.courseId,batchId:data.batchId,
        subjectId:row.subjectId,teacherId:row.teacherId,classroomId:row.classroomId,
        day:targetDay,startTime:clock(row.startMinute),endTime:clock(row.endMinute),
        periodNumber:row.periodNumber,academicSession:batch.academicSession,
        remarks:row.remarks,status:TimetableStatus.ACTIVE,
      }));
      const checked=await checkClassDay(req,entries,db);
      for(const issue of checked.conflicts) conflicts.push({day:targetDay,...issue});
      // Weekly workload is summarized over ALL selected target days below.
      plans.push({day:targetDay,entries,sourceIds:copied.map(row=>row.id)});
    }catch(error){
      if(!(error instanceof AppError)) throw error;
      conflicts.push({day:targetDay,periodNumber:0,code:error.code,message:error.message});
    }
  }
  // Sum newly copied lessons across ALL selected target weekdays. A
  // per-target warning would undercount when copying to several weekdays.
  const groupedCopy=new Map<string,{entry:TimetableEntry;count:number}>();
  for(const target of plans) for(const entry of target.entries){
    const key=entry.teacherId+":"+entry.subjectId;
    const existing=groupedCopy.get(key);
    if(existing) existing.count++;
    else groupedCopy.set(key,{entry,count:1});
  }
  for(const group of groupedCopy.values()){
    const entry=group.entry;
    const [allocation,count]=await Promise.all([
      db.teacherAllocation.findFirst({where:{
        organizationId:req.auth!.organizationId,branchId:data.branchId,batchId:data.batchId,
        academicSessionId:batch.academicSessionId,teacherId:entry.teacherId,
        subjectId:entry.subjectId,status:"ACTIVE",
      },select:{weeklyPeriods:true},orderBy:{updatedAt:"desc"}}),
      db.timetable.count({where:{
        organizationId:req.auth!.organizationId,branchId:data.branchId,batchId:data.batchId,
        academicSessionId:batch.academicSessionId,teacherId:entry.teacherId,
        subjectId:entry.subjectId,status:{not:TimetableStatus.ARCHIVED},
      }}),
    ]);
    if(allocation && count+group.count>allocation.weeklyPeriods){
      warnings.push(`Teacher ${entry.teacherId} / subject ${entry.subjectId}: ${count+group.count} scheduled periods after copying exceeds the weekly allocation of ${allocation.weeklyPeriods}.`);
    }
  }
  // New entries have different weekdays, so their teacher/room time slots
  // cannot overlap each other. Existing schedules are checked by checkClassDay.
  return { sourceDay:data.sourceDay,targetDays:data.targetDays,
    count:plans.reduce((sum,p)=>sum+p.entries.length,0),plans,conflicts,warnings };
}

router.post("/timetables/class-day/copy/preview",async(req:AuthRequest,res)=>{
  const inputCopy=copyDayInput.parse(req.body);
  const plan=await planSchoolDayCopy(req,inputCopy);
  res.json({data:{sourceDay:plan.sourceDay,targetDays:plan.targetDays,
    count:plan.count,conflicts:plan.conflicts,warnings:plan.warnings,
    days:plan.plans.map(p=>({day:p.day,count:p.entries.length}))}});
});
router.post("/timetables/class-day/copy",async(req:AuthRequest,res)=>{
  const inputCopy=copyDayInput.parse(req.body);
  const saved=await prisma.$transaction(async tx=>{
    await lockTimetableBranch(tx,inputCopy.branchId);
    const plan=await planSchoolDayCopy(req,inputCopy,tx);
    if(plan.conflicts.length) throw new AppError(409,"COPY_DAY_CONFLICT",
      plan.conflicts.map(i=>`${i.day}: ${i.message}`).join("; "));
    const created=[];
    for(const day of plan.plans){
      for(let i=0;i<day.entries.length;i++){
        const entry=day.entries[i],{startTime,endTime,...rest}=entry;
        const row=await tx.timetable.create({data:{...rest,
          organizationId:req.auth!.organizationId,
          academicSessionId:(await tx.batch.findUniqueOrThrow({where:{id:entry.batchId},
            select:{academicSessionId:true}})).academicSessionId,
          startMinute:minute(startTime),endMinute:minute(endTime),
        },select});
        await tx.auditLog.create({data:{
          organizationId:req.auth!.organizationId,actorId:req.auth!.userId,
          action:"CREATE",entity:"Timetable",entityId:row.id,
          metadata:{classDayCopy:true,sourceEntryId:day.sourceIds[i],
            sourceDay:inputCopy.sourceDay,targetDay:day.day,
            batchId:entry.batchId,periodNumber:entry.periodNumber},
        }});
        created.push(shape(row));
      }
    }
    return created;
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,maxWait:10000,timeout:30000});
  res.status(201).json({data:saved,meta:{created:saved.length}});
});

router.post("/timetables/class-day/preview", async (req: AuthRequest, res) => {
  const { entries } = classDayInput.parse(req.body);
  res.json({ data: await checkClassDay(req, entries) });
});

router.post("/timetables/class-day", async (req: AuthRequest, res) => {
  const { entries } = classDayInput.parse(req.body);
  const ordered = validateClassDayEntries(entries);
  await access(req, ordered[0].branchId);
  const saved = await prisma.$transaction(async tx => {
    await lockTimetableBranch(tx, ordered[0].branchId);
    const plan = await checkClassDay(req, ordered, tx);
    if (plan.conflicts.length) {
      throw new AppError(409, "CLASS_DAY_CONFLICT",
        plan.conflicts.map(issue => `Period ${issue.periodNumber}: ${issue.message}`).join("; "));
    }
    const created = [];
    for (const entry of plan.entries) {
      const { startTime, endTime, ...rest } = entry;
      const item = await tx.timetable.create({ data: {
        ...rest, organizationId: req.auth!.organizationId,
        academicSessionId: (await tx.batch.findUniqueOrThrow({
          where: { id: entry.batchId }, select: { academicSessionId: true },
        })).academicSessionId,
        startMinute: minute(startTime), endMinute: minute(endTime),
      }, select });
      await tx.auditLog.create({ data: {
        organizationId: req.auth!.organizationId, actorId: req.auth!.userId,
        action: "CREATE", entity: "Timetable", entityId: item.id,
        metadata: { classDay: true, batchId: entry.batchId, day: entry.day,
          periodNumber: entry.periodNumber, teacherId: entry.teacherId, subjectId: entry.subjectId },
      } });
      created.push(shape(item));
    }
    return created;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 10000, timeout: 30000 });
  res.status(201).json({ data: saved, meta: { created: saved.length } });
});

router.post("/timetables/weekly/preview", async (req: AuthRequest, res) => {
  const { entries } = weekInput.parse(req.body);
  const plan = await checkWeek(req, entries);
  res.json({ data: { ...plan, count: entries.length } });
});

router.post("/timetables/weekly", async (req: AuthRequest, res) => {
  const { entries } = weekInput.parse(req.body);
  validateWeeklyTimetableEntries(entries);
  await access(req, entries[0].branchId);
  const created = await prisma.$transaction(async tx => {
    await lockTimetableBranch(tx, entries[0].branchId);
    const plan = await checkWeek(req, entries, tx);
    if (plan.conflicts.length) {
      throw new AppError(409, "WEEKLY_TIMETABLE_CONFLICT",
        plan.conflicts.map(issue=>`${issue.day}: ${issue.message}`).join("; "));
    }
    const results = [];
    for (const entry of plan.entries) {
      const batch = await tx.batch.findUniqueOrThrow({
        where: { id: entry.batchId }, select: { academicSessionId: true },
      });
      const { startTime, endTime, ...rest } = entry;
      const saved = await tx.timetable.create({ data: {
        ...rest, organizationId: req.auth!.organizationId,
        academicSessionId: batch.academicSessionId,
        startMinute: minute(startTime), endMinute: minute(endTime),
      }, select });
      await tx.auditLog.create({ data: {
        organizationId: req.auth!.organizationId,
        actorId: req.auth!.userId, action: "CREATE",
        entity: "Timetable", entityId: saved.id,
        metadata: { weeklyBulk: true, teacherId: entry.teacherId,
          batchId: entry.batchId, subjectId: entry.subjectId, day: entry.day },
      } });
      results.push(shape(saved));
    }
    return results;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 30000 });
  res.status(201).json({ data: created, meta: { created: created.length } });
});

router.get("/timetables/:id",async(req:AuthRequest,res)=>{const x=await prisma.timetable.findUnique({where:{id:String(req.params.id)},select});if(!x)throw new AppError(404,"TIMETABLE_NOT_FOUND","Timetable entry not found");await access(req,x.branch.id);res.json({data:shape(x)})});
const timetableAudit=(req:AuthRequest,action:string,entityId:string,metadata?:object)=>prisma.auditLog.create({data:{actorId:req.auth!.userId,action,entity:"Timetable",entityId,metadata}});
router.post("/timetables",async(req:AuthRequest,res)=>{const d=input.parse(req.body);await access(req,d.branchId);const created=await prisma.$transaction(async tx=>{await lockTimetableBranch(tx,d.branchId);const t=await validate(d,undefined,tx);const{startTime,endTime,...rest}=d;return tx.timetable.create({data:{...rest,...t,organizationId:req.auth!.organizationId},select})},{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,maxWait:10000,timeout:30000});await timetableAudit(req,"CREATE",created.id,{teacherId:d.teacherId,batchId:d.batchId,subjectId:d.subjectId});res.status(201).json({data:shape(created)})});
router.patch("/timetables/:id",async(req:AuthRequest,res)=>{
  const id=String(req.params.id);
  const p=input.partial().parse(req.body);
  const updated=await prisma.$transaction(async tx=>{
    const old=await tx.timetable.findUnique({where:{id},select:{
      id:true,branchId:true,courseId:true,batchId:true,subjectId:true,teacherId:true,
      classroomId:true,day:true,startMinute:true,endMinute:true,periodNumber:true,
      academicSession:true,remarks:true,status:true,
    }});
    if(!old)throw new AppError(404,"TIMETABLE_NOT_FOUND","Timetable entry not found");
    await access(req,old.branchId,tx);
    if(p.branchId)await access(req,p.branchId,tx);
    // Lock both branches in a deterministic order when moving a period.
    // Recheck all teacher and room conflicts inside the same SERIALIZABLE transaction.
    const branches=[...new Set([old.branchId,p.branchId??old.branchId])].sort();
    for(const branchId of branches)await lockTimetableBranch(tx,branchId);
    const d={
      branchId:p.branchId??old.branchId,courseId:p.courseId??old.courseId,
      batchId:p.batchId??old.batchId,subjectId:p.subjectId??old.subjectId,
      teacherId:p.teacherId??old.teacherId,classroomId:p.classroomId??old.classroomId,
      day:p.day??old.day,startTime:p.startTime??clock(old.startMinute),
      endTime:p.endTime??clock(old.endMinute),periodNumber:p.periodNumber??old.periodNumber,
      academicSession:p.academicSession??old.academicSession,
      remarks:p.remarks===undefined?old.remarks:p.remarks,status:p.status??old.status,
    };
    const t=await validate(d,old.id,tx);
    const {startTime,endTime,...rest}=d;
    return tx.timetable.update({where:{id:old.id},
      data:{...rest,...t,organizationId:req.auth!.organizationId},select});
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,maxWait:10000,timeout:30000});
  await timetableAudit(req,"UPDATE",updated.id,{teacherId:updated.teacher.id,batchId:updated.batch.id,subjectId:updated.subject.id});
  res.json({data:shape(updated)});
});
router.patch("/timetables/:id/status",async(req:AuthRequest,res)=>{const{status}=z.object({status:z.nativeEnum(TimetableStatus)}).parse(req.body),old=await prisma.timetable.findUnique({where:{id:String(req.params.id)},select:{id:true,branchId:true}});if(!old)throw new AppError(404,"TIMETABLE_NOT_FOUND","Timetable entry not found");await access(req,old.branchId);const updated=await prisma.timetable.update({where:{id:old.id},data:{status},select});await timetableAudit(req,"STATUS_CHANGED",updated.id,{status});res.json({data:shape(updated)})});
router.delete("/timetables/:id",async(req:AuthRequest,res)=>{const old=await prisma.timetable.findUnique({where:{id:String(req.params.id)},select:{id:true,branchId:true,status:true,_count:{select:{substitutions:true}}}});if(!old)throw new AppError(404,"TIMETABLE_NOT_FOUND","Timetable entry not found");await access(req,old.branchId);if(old.status!==TimetableStatus.ARCHIVED)throw new AppError(409,"ARCHIVE_BEFORE_DELETE","Archive the timetable entry before deleting it");if(old._count.substitutions)throw new AppError(409,"TIMETABLE_HAS_SUBSTITUTIONS","Timetable entries with substitution history cannot be deleted");await prisma.timetable.delete({where:{id:old.id}});await timetableAudit(req,"DELETE",old.id);res.status(204).send()});
function esc(s:string){return s.replace(/[<>&'\"]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;","'":"&apos;",'"':"&quot;"}[c]!))}function pdf(res:any,lines:string[]){const c=["WEEKLY TIMETABLE",...lines].slice(0,45).map((x,i)=>`BT /F1 ${i?8:16} Tf 25 ${810-i*17} Td (${x.replace(/[()\\]/g,"\\$&")}) Tj ET`).join("\n"),o=["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>","<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",`<< /Length ${Buffer.byteLength(c)} >>\nstream\n${c}\nendstream`,"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];let p="%PDF-1.4\n",a=[0];o.forEach((x,i)=>{a.push(Buffer.byteLength(p));p+=`${i+1} 0 obj\n${x}\nendobj\n`});const r=Buffer.byteLength(p);p+=`xref\n0 6\n0000000000 65535 f \n${a.slice(1).map(x=>String(x).padStart(10,"0")+" 00000 n ").join("\n")}\ntrailer << /Size 6 /Root 1 0 R >>\nstartxref\n${r}\n%%EOF`;res.set({"Content-Type":"application/pdf","Content-Disposition":"attachment; filename=timetable.pdf"}).send(Buffer.from(p))}export default router;
