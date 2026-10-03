import {
  AIExaminerAnnotationApprovalState,
  AIExaminerAnnotationAuthorType,
  AIExaminerCheckedCopyRevisionStatus,
  AIExaminerEvaluationStatus,
  Prisma,
  Role,
} from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import {
  assertCheckedCopyApprovalReady,
  autoPlaceCheckedCopyAnnotations,
  CHECKED_COPY_AUTO_APPROVE_PLACEMENT_CONFIDENCE,
  buildAIExaminerCheckedCopyDraft,
  checkedCopyAnchorSchema,
  checkedCopyAnnotationTypeSchema,
  checkedCopyVectorDataSchema,
  sha256Buffer,
} from "../lib/ai-examiner-checked-copy-state.js";
import {
  inspectAIExaminerCheckedCopySource,
  renderAIExaminerCheckedCopy,
  renderAIExaminerCheckedCopyPage,
  type CheckedCopyPersistedAnnotation,
} from "../lib/ai-examiner-checked-copy.js";
import { assertExaminationManager } from "../lib/examination-policy.js";
import { AppError } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import type { AuthRequest } from "../middleware/auth.js";

const router = Router();
const cuid = z.string().cuid();
type ExamAccess = {
  id: string; branchId: string; academicSessionId: string; courseId: string; batchId: string; subjectId: string; teacherId: string; examDate: Date;
  teacher: { userId: string };
};

async function assertManager(req: AuthRequest, exam: ExamAccess) {
  assertExaminationManager(req.auth!.role, req.auth!.userId, exam.teacher.userId);
  if (req.auth!.role === Role.BRANCH_ADMIN) {
    const branch = await prisma.branchUser.findFirst({ where: { organizationId: req.auth!.organizationId, userId: req.auth!.userId, branchId: exam.branchId }, select: { branchId: true } });
    if (!branch) throw new AppError(403, "BRANCH_FORBIDDEN", "Branch access denied");
  }
  if (req.auth!.role === Role.TEACHER) {
    const allocation = await prisma.teacherAllocation.findFirst({
      where: {
        organizationId:req.auth!.organizationId, branchId:exam.branchId, academicSessionId:exam.academicSessionId,
        courseId:exam.courseId, batchId:exam.batchId, subjectId:exam.subjectId, teacherId:exam.teacherId,
        status:"ACTIVE", effectiveFrom:{lte:exam.examDate}, OR:[{effectiveTo:null},{effectiveTo:{gte:exam.examDate}}],
        branch:{isActive:true}, academicSession:{isArchived:false}, batch:{status:"ACTIVE"}, teacher:{user:{isActive:true}},
      },
      select:{id:true},
    });
    if (!allocation) throw new AppError(403, "EXAMINATION_ALLOCATION_REQUIRED", "An effective TeacherAllocation is required for this examination");
  }
}

const revisionInclude = {
  annotations: { include: { anchor: true }, orderBy: { sortOrder: "asc" as const } },
  checkedCopy: {
    include: {
      answerSheet: {
        select: {
          id:true, organizationId:true, examinationId:true, studentId:true, fileName:true, mimeType:true, fileSize:true, fileData:true,
          finalizedAt:true, marksObtained:true, student:{select:{user:{select:{name:true}}}},
          examination:{select:{id:true,name:true,maximumMarks:true,branchId:true,academicSessionId:true,courseId:true,batchId:true,subjectId:true,teacherId:true,examDate:true,teacher:{select:{userId:true}}}},
        },
      },
    },
  },
  evaluation: {
    include: {
      rubric:{select:{version:true}},
      reviewedBy:{select:{name:true}},
      questions:{orderBy:{createdAt:"asc" as const}},
    },
  },
} satisfies Prisma.AIExaminerCheckedCopyRevisionInclude;

async function revisionForManager(req: AuthRequest, revisionId: string) {
  const revision = await prisma.aIExaminerCheckedCopyRevision.findFirst({
    where:{id:revisionId,organizationId:req.auth!.organizationId},
    include:revisionInclude,
  });
  if(!revision) throw new AppError(404,"AI_CHECKED_COPY_NOT_FOUND","Checked-copy revision not found");
  await assertManager(req,revision.checkedCopy.answerSheet.examination);
  return revision;
}

function sanitizedRevision<T extends { checkedCopy?: { answerSheet?: { fileData?: unknown } } }>(revision:T) {
  if (revision.checkedCopy?.answerSheet) return { ...revision, checkedCopy:{...revision.checkedCopy,answerSheet:{...revision.checkedCopy.answerSheet,fileData:undefined}} };
  return revision;
}

function canonicalAnnotations(revision: Awaited<ReturnType<typeof revisionForManager>>): CheckedCopyPersistedAnnotation[] {
  return revision.annotations.map(annotation=>({
    type:annotation.type,
    content:annotation.content,
    questionKey:annotation.questionKey,
    marks:annotation.marks==null?null:Number(annotation.marks),
    approvalState:annotation.approvalState,
    vectorData:annotation.vectorData,
    anchor:annotation.anchor?{
      pageNumber:annotation.anchor.pageNumber,x:Number(annotation.anchor.x),y:Number(annotation.anchor.y),
      width:Number(annotation.anchor.width),height:Number(annotation.anchor.height),rotation:Number(annotation.anchor.rotation),
    }:null,
  }));
}

router.post("/evaluations/:evaluationId/checked-copy/draft", async (req:AuthRequest,res)=>{
  const evaluationId=cuid.parse(req.params.evaluationId);
  const evaluation=await prisma.aIExaminerEvaluation.findFirst({
    where:{id:evaluationId,organizationId:req.auth!.organizationId,status:AIExaminerEvaluationStatus.APPROVED},
    include:{
      rubric:{select:{version:true}},
      answerSheet:{
        include:{
          student:{select:{user:{select:{name:true}}}},
          examination:{select:{id:true,name:true,maximumMarks:true,branchId:true,academicSessionId:true,courseId:true,batchId:true,subjectId:true,teacherId:true,examDate:true,teacher:{select:{userId:true}}}},
        },
      },
      questions:{orderBy:{createdAt:"asc"}},
    },
  });
  if(!evaluation) throw new AppError(404,"AI_EXAMINER_EVALUATION_NOT_FOUND","Approved AI evaluation not found");
  await assertManager(req,evaluation.answerSheet.examination);
  if(!evaluation.answerSheet.finalizedAt||evaluation.answerSheet.marksObtained==null||evaluation.questions.some(question=>question.finalMarks==null)){
    throw new AppError(409,"AI_CHECKED_COPY_GRADING_INCOMPLETE","Teacher-approved finalized marks are required before checked-copy annotation review");
  }

  const checkedCopy=await prisma.aIExaminerCheckedCopy.upsert({
    where:{answerSheetId:evaluation.answerSheet.id},
    update:{},
    create:{organizationId:req.auth!.organizationId,answerSheetId:evaluation.answerSheet.id},
  });
  const existing=await prisma.aIExaminerCheckedCopyRevision.findFirst({
    where:{organizationId:req.auth!.organizationId,checkedCopyId:checkedCopy.id,evaluationId:evaluation.id,status:AIExaminerCheckedCopyRevisionStatus.DRAFT},
    include:{annotations:{include:{anchor:true},orderBy:{sortOrder:"asc"}}},
    orderBy:{revision:"desc"},
  });
  if(existing) return res.json({data:existing,meta:{label:"AI Checked Copy — Draft",existing:true}});

  const source={fileName:evaluation.answerSheet.fileName,mimeType:evaluation.answerSheet.mimeType,bytes:Buffer.from(evaluation.answerSheet.fileData)};
  const inspected=await inspectAIExaminerCheckedCopySource(source);
  const latestRevision=await prisma.aIExaminerCheckedCopyRevision.findFirst({where:{checkedCopyId:checkedCopy.id},select:{revision:true},orderBy:{revision:"desc"}});
  const result=await prisma.examinationResult.findFirst({where:{organizationId:req.auth!.organizationId,examinationId:evaluation.answerSheet.examinationId,studentId:evaluation.answerSheet.studentId},select:{id:true}});
  const resultRevision=result?await prisma.aIExaminerResultRevision.findFirst({where:{organizationId:req.auth!.organizationId,resultId:result.id},select:{revision:true},orderBy:{revision:"desc"}}):null;
  const draft=buildAIExaminerCheckedCopyDraft({
    diagnostics:evaluation.diagnostics,
    questions:evaluation.questions.map(question=>({
      questionKey:question.questionKey,maxMarks:Number(question.maxMarks),finalMarks:Number(question.finalMarks),
      confidence:question.confidence==null?null:Number(question.confidence),teacherComment:question.teacherComment,feedback:question.feedback,
      rubricBreakdown:question.rubricBreakdown,
    })),
    totalMarks:Number(evaluation.answerSheet.marksObtained),maximumMarks:evaluation.answerSheet.examination.maximumMarks,
    sourcePageCount:inspected.pageCount,
  });
  const revisionNumber=(latestRevision?.revision??0)+1;
  const revision=await prisma.$transaction(async tx=>{
    const created=await tx.aIExaminerCheckedCopyRevision.create({
      data:{
        organizationId:req.auth!.organizationId,checkedCopyId:checkedCopy.id,evaluationId:evaluation.id,revision:revisionNumber,
        sourceAnswerSheetSha256:sha256Buffer(source.bytes),evaluationRevision:evaluation.revision,rubricVersion:evaluation.rubric.version,
        resultRevision:resultRevision?.revision??0,annotationRevision:1,sourcePageCount:inspected.pageCount,createdById:req.auth!.userId,
      },
    });
    for(const annotation of draft){
      await tx.aIExaminerAnnotation.create({
        data:{
          organizationId:req.auth!.organizationId,revisionId:created.id,questionKey:annotation.questionKey,rubricCriterion:annotation.rubricCriterion,
          type:annotation.type,content:annotation.content,marks:annotation.marks,confidence:annotation.confidence,sourceEvidence:annotation.sourceEvidence,
          ...(annotation.vectorData==null?{}:{vectorData:annotation.vectorData as Prisma.InputJsonValue}),
          authorType:annotation.authorType,approvalState:annotation.approvalState,sortOrder:annotation.sortOrder,
          ...(annotation.anchor?{anchor:{create:{
            organizationId:req.auth!.organizationId,pageNumber:annotation.anchor.pageNumber,x:annotation.anchor.x,y:annotation.anchor.y,
            width:annotation.anchor.width,height:annotation.anchor.height,rotation:annotation.anchor.rotation,
            placementConfidence:annotation.anchor.placementConfidence??null,evidenceText:annotation.anchor.evidenceText??null,
          }}}:{}),
        },
      });
    }
    await tx.auditLog.create({data:{organizationId:req.auth!.organizationId,actorId:req.auth!.userId,action:"AI_CHECKED_COPY_REVISION_CREATED",entity:"AIExaminerCheckedCopyRevision",entityId:created.id,metadata:{evaluationId:evaluation.id,revision:revisionNumber,sourceAnswerSheetSha256:sha256Buffer(source.bytes)}}});
    await tx.auditLog.create({data:{organizationId:req.auth!.organizationId,actorId:req.auth!.userId,action:"AI_CHECKED_COPY_GENERATED",entity:"AIExaminerCheckedCopyRevision",entityId:created.id,metadata:{annotationCount:draft.length,positionReviewRequired:draft.filter(row=>row.approvalState==="POSITION_REVIEW_REQUIRED").length}}});
    await tx.auditLog.create({data:{organizationId:req.auth!.organizationId,actorId:req.auth!.userId,action:"AI_CHECKED_COPY_ANNOTATION_CREATED",entity:"AIExaminerCheckedCopyRevision",entityId:created.id,metadata:{count:draft.length,source:"AI_DRAFT"}}});
    return tx.aIExaminerCheckedCopyRevision.findUniqueOrThrow({where:{id:created.id},include:{annotations:{include:{anchor:true},orderBy:{sortOrder:"asc"}}}});
  });
  res.status(201).json({data:revision,meta:{label:"AI Checked Copy — Draft",existing:false}});
});

router.get("/evaluations/:evaluationId/checked-copy/review", async (req:AuthRequest,res)=>{
  const evaluationId=cuid.parse(req.params.evaluationId);
  let revision=await prisma.aIExaminerCheckedCopyRevision.findFirst({
    where:{organizationId:req.auth!.organizationId,evaluationId},
    include:revisionInclude,orderBy:{revision:"desc"},
  });
  if(!revision) throw new AppError(404,"AI_CHECKED_COPY_NOT_FOUND","Create the checked-copy draft first");
  await assertManager(req,revision.checkedCopy.answerSheet.examination);

  // Safety normalization for drafts created before the ERP 4.0 placement-confidence gate.
  // Low-confidence AI placements remain visible, but must be reviewed before final approval.
  if(revision.status===AIExaminerCheckedCopyRevisionStatus.DRAFT){
    const uncertainIds=revision.annotations
      .filter(row=>
        row.authorType===AIExaminerAnnotationAuthorType.AI &&
        row.approvalState===AIExaminerAnnotationApprovalState.AI_DRAFT &&
        row.anchor &&
        Number(row.anchor.placementConfidence??0)<CHECKED_COPY_AUTO_APPROVE_PLACEMENT_CONFIDENCE
      )
      .map(row=>row.id);
    if(uncertainIds.length){
      await prisma.$transaction(async tx=>{
        await tx.aIExaminerAnnotation.updateMany({
          where:{id:{in:uncertainIds},organizationId:req.auth!.organizationId,revisionId:revision!.id},
          data:{approvalState:AIExaminerAnnotationApprovalState.POSITION_REVIEW_REQUIRED},
        });
        await tx.auditLog.create({data:{
          organizationId:req.auth!.organizationId,actorId:req.auth!.userId,action:"AI_CHECKED_COPY_LOW_CONFIDENCE_REVIEW_REQUIRED",
          entity:"AIExaminerCheckedCopyRevision",entityId:revision!.id,
          metadata:{count:uncertainIds.length,confidenceThreshold:CHECKED_COPY_AUTO_APPROVE_PLACEMENT_CONFIDENCE},
        }});
      });
      revision=await prisma.aIExaminerCheckedCopyRevision.findFirstOrThrow({
        where:{id:revision.id,organizationId:req.auth!.organizationId},
        include:revisionInclude,
      });
    }
  }

  res.json({data:sanitizedRevision(revision),meta:{label:revision.status===AIExaminerCheckedCopyRevisionStatus.DRAFT?"AI Checked Copy — Draft":"Checked Copy — Approved"}});
});


router.post("/checked-copy/revisions/:revisionId/auto-place", async (req:AuthRequest,res)=>{
  const revision=await revisionForManager(req,cuid.parse(req.params.revisionId));
  if(revision.status!==AIExaminerCheckedCopyRevisionStatus.DRAFT) throw new AppError(409,"AI_CHECKED_COPY_IMMUTABLE","Only a draft checked-copy revision can be auto-placed");
  const placements=autoPlaceCheckedCopyAnnotations({
    diagnostics:revision.evaluation.diagnostics,
    sourcePageCount:revision.sourcePageCount,
    annotations:revision.annotations.map(row=>({
      id:row.id,
      questionKey:row.questionKey,
      type:row.type,
      sourceEvidence:row.sourceEvidence,
      approvalState:row.approvalState,
      anchor:row.anchor?{
        pageNumber:row.anchor.pageNumber,
        x:Number(row.anchor.x),
        y:Number(row.anchor.y),
        width:Number(row.anchor.width),
        height:Number(row.anchor.height),
      }:null,
    })),
  });
  const lowConfidenceExisting=revision.annotations.filter(row =>
    row.authorType===AIExaminerAnnotationAuthorType.AI &&
    row.approvalState===AIExaminerAnnotationApprovalState.AI_DRAFT &&
    row.anchor &&
    Number(row.anchor.placementConfidence??0)<CHECKED_COPY_AUTO_APPROVE_PLACEMENT_CONFIDENCE
  );
  if(!placements.length&&!lowConfidenceExisting.length) return res.json({data:sanitizedRevision(revision),meta:{autoPlaced:0,reviewRequired:0}});

  let reviewRequired=0;
  await prisma.$transaction(async tx=>{
    for(const row of lowConfidenceExisting){
      await tx.aIExaminerAnnotation.update({
        where:{id:row.id},
        data:{approvalState:AIExaminerAnnotationApprovalState.POSITION_REVIEW_REQUIRED},
      });
      reviewRequired+=1;
    }
    for(const placement of placements){
      await tx.aIExaminerAnnotationAnchor.upsert({
        where:{annotationId:placement.id},
        update:{
          pageNumber:placement.anchor.pageNumber,x:placement.anchor.x,y:placement.anchor.y,width:placement.anchor.width,height:placement.anchor.height,
          rotation:placement.anchor.rotation,placementConfidence:placement.anchor.placementConfidence??null,evidenceText:placement.anchor.evidenceText??null,
        },
        create:{
          organizationId:req.auth!.organizationId,annotationId:placement.id,
          pageNumber:placement.anchor.pageNumber,x:placement.anchor.x,y:placement.anchor.y,width:placement.anchor.width,height:placement.anchor.height,
          rotation:placement.anchor.rotation,placementConfidence:placement.anchor.placementConfidence??null,evidenceText:placement.anchor.evidenceText??null,
        },
      });
      const confidence=Number(placement.anchor.placementConfidence??0);
      const state=confidence>=CHECKED_COPY_AUTO_APPROVE_PLACEMENT_CONFIDENCE
        ? AIExaminerAnnotationApprovalState.AI_DRAFT
        : AIExaminerAnnotationApprovalState.POSITION_REVIEW_REQUIRED;
      if(state===AIExaminerAnnotationApprovalState.POSITION_REVIEW_REQUIRED) reviewRequired+=1;
      await tx.aIExaminerAnnotation.update({
        where:{id:placement.id},
        data:{approvalState:state,authorType:AIExaminerAnnotationAuthorType.AI,authorId:null},
      });
    }
    await tx.aIExaminerCheckedCopyRevision.update({
      where:{id:revision.id},
      data:{annotationRevision:{increment:1}},
    });
    await tx.auditLog.create({data:{
      organizationId:req.auth!.organizationId,actorId:req.auth!.userId,action:"AI_CHECKED_COPY_AUTO_PLACED",
      entity:"AIExaminerCheckedCopyRevision",entityId:revision.id,
      metadata:{count:placements.length,reviewRequired,confidenceThreshold:CHECKED_COPY_AUTO_APPROVE_PLACEMENT_CONFIDENCE,source:"ERP4_AUTO_RED_PEN"},
    }});
  });
  const refreshed=await revisionForManager(req,revision.id);
  res.json({data:sanitizedRevision(refreshed),meta:{autoPlaced:placements.length,reviewRequired}});
});

router.get("/checked-copy/revisions/:revisionId/pages/:pageNumber", async (req:AuthRequest,res)=>{
  const revision=await revisionForManager(req,cuid.parse(req.params.revisionId));
  const pageNumber=z.coerce.number().int().min(1).max(1000).parse(req.params.pageNumber);
  if(pageNumber>revision.sourcePageCount) throw new AppError(404,"AI_CHECKED_COPY_PAGE_NOT_FOUND","Checked-copy page not found");
  const sheet=revision.checkedCopy.answerSheet;
  const page=await renderAIExaminerCheckedCopyPage({fileName:sheet.fileName,mimeType:sheet.mimeType,bytes:Buffer.from(sheet.fileData)},pageNumber);
  res.set({"Content-Type":"image/png","Cache-Control":"private, no-store","X-Checked-Copy-Page":String(pageNumber),"X-Checked-Copy-Pages":String(page.pageCount)}).send(page.png);
});

const annotationBody=z.object({
  type:checkedCopyAnnotationTypeSchema,
  questionKey:z.string().trim().min(1).max(40).nullable().optional(),
  rubricCriterion:z.string().trim().max(4000).nullable().optional(),
  content:z.string().trim().max(2000).nullable().optional(),
  sourceEvidence:z.string().trim().max(4000).nullable().optional(),
  vectorData:checkedCopyVectorDataSchema.nullable().optional(),
  anchor:checkedCopyAnchorSchema.nullable().optional(),
});

router.post("/checked-copy/revisions/:revisionId/annotations",async(req:AuthRequest,res)=>{
  const revision=await revisionForManager(req,cuid.parse(req.params.revisionId));
  if(revision.status!==AIExaminerCheckedCopyRevisionStatus.DRAFT) throw new AppError(409,"AI_CHECKED_COPY_IMMUTABLE","Only a draft checked-copy revision can be edited");
  const body=annotationBody.parse(req.body);
  if(["QUESTION_SCORE","PAGE_SCORE","TOTAL_SCORE"].includes(body.type)) throw new AppError(422,"AI_CHECKED_COPY_SCORE_MANAGED","Score annotations are generated from finalized grading and cannot be independently added");
  if(body.type==="FREEHAND"&&!body.vectorData) throw new AppError(422,"AI_CHECKED_COPY_FREEHAND_POINTS_REQUIRED","Freehand annotations require normalized path points");
  const nextOrder=(revision.annotations.at(-1)?.sortOrder??-1)+1;
  const created=await prisma.$transaction(async tx=>{
    const row=await tx.aIExaminerAnnotation.create({data:{
      organizationId:req.auth!.organizationId,revisionId:revision.id,questionKey:body.questionKey??null,rubricCriterion:body.rubricCriterion??null,
      type:body.type,content:body.content??null,sourceEvidence:body.sourceEvidence??null,
      ...(body.vectorData==null?{}:{vectorData:body.vectorData as Prisma.InputJsonValue}),
      authorType:AIExaminerAnnotationAuthorType.TEACHER,authorId:req.auth!.userId,
      approvalState:body.anchor?AIExaminerAnnotationApprovalState.APPROVED:AIExaminerAnnotationApprovalState.POSITION_REVIEW_REQUIRED,sortOrder:nextOrder,
      ...(body.anchor?{anchor:{create:{organizationId:req.auth!.organizationId,...body.anchor}}}:{}),
    },include:{anchor:true}});
    await tx.auditLog.create({data:{organizationId:req.auth!.organizationId,actorId:req.auth!.userId,action:"AI_CHECKED_COPY_ANNOTATION_CREATED",entity:"AIExaminerAnnotation",entityId:row.id,metadata:{revisionId:revision.id,type:row.type,teacherAuthored:true}}});
    return row;
  });
  res.status(201).json({data:created});
});

const annotationPatch=z.object({
  type:checkedCopyAnnotationTypeSchema.optional(),
  content:z.string().trim().max(2000).nullable().optional(),
  rubricCriterion:z.string().trim().max(4000).nullable().optional(),
  vectorData:checkedCopyVectorDataSchema.nullable().optional(),
  anchor:checkedCopyAnchorSchema.nullable().optional(),
  approvalState:z.enum(["AI_DRAFT","POSITION_REVIEW_REQUIRED","APPROVED","REJECTED"]).optional(),
}).refine(value=>Object.keys(value).length>0,{message:"At least one checked-copy change is required"});

router.patch("/checked-copy/revisions/:revisionId/annotations/:annotationId",async(req:AuthRequest,res)=>{
  const revision=await revisionForManager(req,cuid.parse(req.params.revisionId));
  if(revision.status!==AIExaminerCheckedCopyRevisionStatus.DRAFT) throw new AppError(409,"AI_CHECKED_COPY_IMMUTABLE","Only a draft checked-copy revision can be edited");
  const annotationId=cuid.parse(req.params.annotationId),current=revision.annotations.find(row=>row.id===annotationId);
  if(!current) throw new AppError(404,"AI_CHECKED_COPY_ANNOTATION_NOT_FOUND","Annotation not found");
  const body=annotationPatch.parse(req.body);
  const scoreManaged=["QUESTION_SCORE","PAGE_SCORE","TOTAL_SCORE"].includes(current.type);
  if(scoreManaged&&(body.type!==undefined||body.content!==undefined||body.vectorData!==undefined)) throw new AppError(422,"AI_CHECKED_COPY_SCORE_MANAGED","Score text and marks come from finalized grading; only placement/approval can change here");
  if(body.type&&["QUESTION_SCORE","PAGE_SCORE","TOTAL_SCORE"].includes(body.type)) throw new AppError(422,"AI_CHECKED_COPY_SCORE_MANAGED","Only grading workflow can create score annotations");
  const anchorProvided=Object.prototype.hasOwnProperty.call(body,"anchor"), requestedState=body.approvalState;
  const hasAnchor=anchorProvided?Boolean(body.anchor):Boolean(current.anchor);
  const state=requestedState==="REJECTED"?AIExaminerAnnotationApprovalState.REJECTED:
    !hasAnchor?AIExaminerAnnotationApprovalState.POSITION_REVIEW_REQUIRED:
    requestedState?requestedState as AIExaminerAnnotationApprovalState:
    current.approvalState===AIExaminerAnnotationApprovalState.POSITION_REVIEW_REQUIRED?AIExaminerAnnotationApprovalState.AI_DRAFT:current.approvalState;
  if(state===AIExaminerAnnotationApprovalState.APPROVED&&!hasAnchor) throw new AppError(422,"AI_CHECKED_COPY_POSITION_REQUIRED","Approve an annotation only after placing it on the relevant answer-sheet region");
  const updated=await prisma.$transaction(async tx=>{
    if(anchorProvided){
      if(body.anchor) await tx.aIExaminerAnnotationAnchor.upsert({where:{annotationId},update:{...body.anchor},create:{organizationId:req.auth!.organizationId,annotationId,...body.anchor}});
      else if(current.anchor) await tx.aIExaminerAnnotationAnchor.delete({where:{annotationId}});
    }
    const row=await tx.aIExaminerAnnotation.update({where:{id:annotationId},data:{
      ...(body.type?{type:body.type}:{}),...(body.content!==undefined?{content:body.content}:{}),
      ...(body.rubricCriterion!==undefined?{rubricCriterion:body.rubricCriterion}:{}),
      ...(body.vectorData!==undefined?{vectorData:body.vectorData==null?Prisma.JsonNull:body.vectorData as Prisma.InputJsonValue}:{}),
      approvalState:state,authorType:AIExaminerAnnotationAuthorType.TEACHER,authorId:req.auth!.userId,
    },include:{anchor:true}});
    await tx.auditLog.create({data:{organizationId:req.auth!.organizationId,actorId:req.auth!.userId,action:state===AIExaminerAnnotationApprovalState.REJECTED?"AI_CHECKED_COPY_ANNOTATION_REJECTED":"AI_CHECKED_COPY_ANNOTATION_EDITED",entity:"AIExaminerAnnotation",entityId:row.id,metadata:{revisionId:revision.id,approvalState:state}}});
    return row;
  });
  res.json({data:updated});
});

router.delete("/checked-copy/revisions/:revisionId/annotations/:annotationId",async(req:AuthRequest,res)=>{
  const revision=await revisionForManager(req,cuid.parse(req.params.revisionId));
  if(revision.status!==AIExaminerCheckedCopyRevisionStatus.DRAFT) throw new AppError(409,"AI_CHECKED_COPY_IMMUTABLE","Only a draft checked-copy revision can be edited");
  const annotationId=cuid.parse(req.params.annotationId),current=revision.annotations.find(row=>row.id===annotationId);
  if(!current) throw new AppError(404,"AI_CHECKED_COPY_ANNOTATION_NOT_FOUND","Annotation not found");
  if(["QUESTION_SCORE","TOTAL_SCORE"].includes(current.type)) throw new AppError(422,"AI_CHECKED_COPY_SCORE_REQUIRED","Question and total score annotations cannot be removed; reposition them instead");
  const row=await prisma.$transaction(async tx=>{
    const value=await tx.aIExaminerAnnotation.update({where:{id:annotationId},data:{approvalState:AIExaminerAnnotationApprovalState.REJECTED,authorType:AIExaminerAnnotationAuthorType.TEACHER,authorId:req.auth!.userId},include:{anchor:true}});
    await tx.auditLog.create({data:{organizationId:req.auth!.organizationId,actorId:req.auth!.userId,action:"AI_CHECKED_COPY_ANNOTATION_REJECTED",entity:"AIExaminerAnnotation",entityId:value.id,metadata:{revisionId:revision.id}}});
    return value;
  });
  res.json({data:row});
});

router.post("/checked-copy/revisions/:revisionId/pages/:pageNumber/approve",async(req:AuthRequest,res)=>{
  const revision=await revisionForManager(req,cuid.parse(req.params.revisionId));
  if(revision.status!==AIExaminerCheckedCopyRevisionStatus.DRAFT) throw new AppError(409,"AI_CHECKED_COPY_IMMUTABLE","Only a draft checked-copy revision can be approved");
  const pageNumber=z.coerce.number().int().min(1).max(revision.sourcePageCount).parse(req.params.pageNumber);
  const ids=revision.annotations.filter(row=>row.anchor?.pageNumber===pageNumber&&row.approvalState===AIExaminerAnnotationApprovalState.AI_DRAFT).map(row=>row.id);
  if(ids.length) await prisma.aIExaminerAnnotation.updateMany({where:{id:{in:ids},organizationId:req.auth!.organizationId,revisionId:revision.id},data:{approvalState:AIExaminerAnnotationApprovalState.APPROVED,authorType:AIExaminerAnnotationAuthorType.TEACHER,authorId:req.auth!.userId}});
  res.json({data:{pageNumber,approved:ids.length}});
});

router.post("/checked-copy/revisions/:revisionId/approve",async(req:AuthRequest,res)=>{
  let revision=await revisionForManager(req,cuid.parse(req.params.revisionId));
  if(revision.status!==AIExaminerCheckedCopyRevisionStatus.DRAFT&&revision.status!==AIExaminerCheckedCopyRevisionStatus.APPROVED){
    if(revision.status===AIExaminerCheckedCopyRevisionStatus.RENDERED||revision.status===AIExaminerCheckedCopyRevisionStatus.PUBLISHED) return res.json({data:sanitizedRevision(revision),meta:{label:"Checked Copy — Approved",alreadyApproved:true}});
    throw new AppError(409,"AI_CHECKED_COPY_IMMUTABLE","This checked-copy revision cannot be approved");
  }
  const sheet=revision.checkedCopy.answerSheet;
  if(!sheet.finalizedAt||sheet.marksObtained==null||revision.evaluation.status!==AIExaminerEvaluationStatus.APPROVED) throw new AppError(409,"AI_CHECKED_COPY_GRADING_INCOMPLETE","Finalized teacher-approved grading is required");
  if(revision.status===AIExaminerCheckedCopyRevisionStatus.DRAFT){
    try{
      assertCheckedCopyApprovalReady({
        annotations:revision.annotations.map(row=>({type:row.type,questionKey:row.questionKey,content:row.content,marks:row.marks,approvalState:row.approvalState,anchor:row.anchor})),
        questions:revision.evaluation.questions.map(question=>({questionKey:question.questionKey,finalMarks:Number(question.finalMarks)})),
        totalMarks:Number(sheet.marksObtained),
      });
    }catch(error){
      const message=error instanceof Error?error.message:"Checked-copy review is incomplete";
      if(message.startsWith("POSITION_REVIEW_REQUIRED:")) throw new AppError(409,"AI_CHECKED_COPY_POSITION_REVIEW_REQUIRED",`${message.split(":")[1]} annotation(s) still require teacher positioning before approval`);
      throw new AppError(409,"AI_CHECKED_COPY_APPROVAL_INTEGRITY",message);
    }
    const now=new Date();
    await prisma.$transaction(async tx=>{
      await tx.aIExaminerAnnotation.updateMany({where:{organizationId:req.auth!.organizationId,revisionId:revision.id,approvalState:AIExaminerAnnotationApprovalState.AI_DRAFT},data:{approvalState:AIExaminerAnnotationApprovalState.APPROVED,authorType:AIExaminerAnnotationAuthorType.TEACHER,authorId:req.auth!.userId}});
      const locked=await tx.aIExaminerCheckedCopyRevision.updateMany({where:{id:revision.id,organizationId:req.auth!.organizationId,status:AIExaminerCheckedCopyRevisionStatus.DRAFT},data:{status:AIExaminerCheckedCopyRevisionStatus.APPROVED,approvedById:req.auth!.userId,approvedAt:now}});
      if(locked.count!==1) throw new AppError(409,"AI_CHECKED_COPY_REVIEW_CHANGED","Checked-copy review changed; refresh and retry");
      await tx.auditLog.create({data:{organizationId:req.auth!.organizationId,actorId:req.auth!.userId,action:"AI_CHECKED_COPY_APPROVED",entity:"AIExaminerCheckedCopyRevision",entityId:revision.id,metadata:{revision:revision.revision,evaluationId:revision.evaluationId}}});
    });
    revision=await revisionForManager(req,revision.id);
  }

  const source={fileName:sheet.fileName,mimeType:sheet.mimeType,bytes:Buffer.from(sheet.fileData)};
  if(sha256Buffer(source.bytes)!==revision.sourceAnswerSheetSha256) throw new AppError(409,"AI_CHECKED_COPY_SOURCE_CHANGED","Original answer-sheet fingerprint no longer matches this revision");
  const rendered=await renderAIExaminerCheckedCopy({
    source,studentName:sheet.student.user.name,examinationName:sheet.examination.name,
    questions:revision.evaluation.questions.map(question=>({questionKey:question.questionKey,maxMarks:Number(question.maxMarks),finalMarks:Number(question.finalMarks),teacherComment:question.teacherComment,feedback:question.feedback})),
    annotations:canonicalAnnotations(revision),totalMarks:Number(sheet.marksObtained),maximumMarks:sheet.examination.maximumMarks,
    reviewerName:revision.evaluation.reviewedBy?.name??null,evaluationRevision:revision.evaluationRevision,checkedCopyRevision:revision.revision,
  });
  const renderedHash=sha256Buffer(rendered.pdf),fileName=`${sheet.fileName.replace(/\.[^.]+$/,"").replace(/[^A-Za-z0-9._-]+/g,"-").slice(0,120)||"answer-sheet"}-checked-r${revision.revision}.pdf`;
  const stored=await prisma.$transaction(async tx=>{
    const locked=await tx.aIExaminerCheckedCopyRevision.updateMany({
      where:{id:revision.id,organizationId:req.auth!.organizationId,status:AIExaminerCheckedCopyRevisionStatus.APPROVED},
      data:{status:AIExaminerCheckedCopyRevisionStatus.RENDERED,renderedFileName:fileName,renderedMimeType:"application/pdf",renderedFileSize:rendered.pdf.length,renderedFileData:new Uint8Array(rendered.pdf),renderedFileSha256:renderedHash,renderedAt:new Date()},
    });
    if(locked.count!==1) throw new AppError(409,"AI_CHECKED_COPY_RENDER_CHANGED","Checked-copy render state changed; refresh before retrying");
    await tx.aIExaminerCheckedCopyRevision.updateMany({where:{checkedCopyId:revision.checkedCopyId,id:{not:revision.id},status:{in:[AIExaminerCheckedCopyRevisionStatus.RENDERED,AIExaminerCheckedCopyRevisionStatus.PUBLISHED]}},data:{status:AIExaminerCheckedCopyRevisionStatus.SUPERSEDED}});
    await tx.auditLog.create({data:{organizationId:req.auth!.organizationId,actorId:req.auth!.userId,action:"AI_CHECKED_COPY_RENDERED",entity:"AIExaminerCheckedCopyRevision",entityId:revision.id,metadata:{renderedFileSha256:renderedHash,pageCount:rendered.pageCount,placement:rendered.placement}}});
    return tx.aIExaminerCheckedCopyRevision.findUniqueOrThrow({where:{id:revision.id},include:{annotations:{include:{anchor:true},orderBy:{sortOrder:"asc"}}}});
  });
  res.json({data:{...stored,renderedFileData:undefined},meta:{label:"Checked Copy — Approved",placement:rendered.placement,pageCount:rendered.pageCount}});
});

router.get("/checked-copy/revisions/:revisionId/preview-pdf",async(req:AuthRequest,res)=>{
  const revision=await revisionForManager(req,cuid.parse(req.params.revisionId));
  const sheet=revision.checkedCopy.answerSheet;
  if(!sheet.finalizedAt||sheet.marksObtained==null) throw new AppError(409,"AI_CHECKED_COPY_GRADING_INCOMPLETE","Finalized grading is required before previewing the checked copy");
  const source={fileName:sheet.fileName,mimeType:sheet.mimeType,bytes:Buffer.from(sheet.fileData)};
  if(sha256Buffer(source.bytes)!==revision.sourceAnswerSheetSha256) throw new AppError(409,"AI_CHECKED_COPY_SOURCE_CHANGED","Original answer-sheet fingerprint no longer matches this revision");
  const rendered=await renderAIExaminerCheckedCopy({
    source,
    studentName:sheet.student.user.name,
    examinationName:sheet.examination.name,
    questions:revision.evaluation.questions.map(question=>({
      questionKey:question.questionKey,
      maxMarks:Number(question.maxMarks),
      finalMarks:Number(question.finalMarks),
      teacherComment:question.teacherComment,
      feedback:question.feedback,
    })),
    annotations:canonicalAnnotations(revision),
    totalMarks:Number(sheet.marksObtained),
    maximumMarks:sheet.examination.maximumMarks,
    reviewerName:revision.evaluation.reviewedBy?.name??null,
    evaluationRevision:revision.evaluationRevision,
    checkedCopyRevision:revision.revision,
    renderLabel:"Draft Preview",
  });
  await prisma.auditLog.create({data:{
    organizationId:req.auth!.organizationId,
    actorId:req.auth!.userId,
    action:"AI_CHECKED_COPY_PREVIEWED",
    entity:"AIExaminerCheckedCopyRevision",
    entityId:revision.id,
    metadata:{revision:revision.revision,placement:rendered.placement,pageCount:rendered.pageCount},
  }}).catch(()=>null);
  const baseName=sheet.fileName.replace(/\.[^.]+$/,"").replace(/[^A-Za-z0-9._-]+/g,"-").slice(0,120)||"answer-sheet";
  const fileName=`${baseName}-checked-preview-r${revision.revision}.pdf`;
  res.set({
    "Content-Type":"application/pdf",
    "Content-Disposition":`attachment; filename="${fileName}"`,
    "Cache-Control":"private, no-store",
    "X-Checked-Copy-Preview":"true",
  }).send(rendered.pdf);
});

router.get("/evaluations/:evaluationId/checked-copy",async(req:AuthRequest,res)=>{
  const evaluationId=cuid.parse(req.params.evaluationId);
  const revision=await prisma.aIExaminerCheckedCopyRevision.findFirst({
    where:{organizationId:req.auth!.organizationId,evaluationId,status:{in:[AIExaminerCheckedCopyRevisionStatus.RENDERED,AIExaminerCheckedCopyRevisionStatus.PUBLISHED]}},
    include:{checkedCopy:{include:{answerSheet:{select:{examination:{select:{id:true,branchId:true,academicSessionId:true,courseId:true,batchId:true,subjectId:true,teacherId:true,examDate:true,teacher:{select:{userId:true}}}}}}}}},
    orderBy:{revision:"desc"},
  });
  if(!revision||!revision.renderedFileData||!revision.renderedFileName) throw new AppError(404,"AI_CHECKED_COPY_NOT_FOUND","Teacher-approved checked copy is not available");
  await assertManager(req,revision.checkedCopy.answerSheet.examination);
  await prisma.auditLog.create({data:{organizationId:req.auth!.organizationId,actorId:req.auth!.userId,action:"AI_CHECKED_COPY_DOWNLOADED",entity:"AIExaminerCheckedCopyRevision",entityId:revision.id,metadata:{revision:revision.revision,evaluationId}}}).catch(()=>null);
  res.set({"Content-Type":"application/pdf","Content-Disposition":`attachment; filename="${revision.renderedFileName}"`,"Cache-Control":"private, no-store","X-Checked-Copy-Revision":String(revision.revision)}).send(Buffer.from(revision.renderedFileData));
});

export default router;
