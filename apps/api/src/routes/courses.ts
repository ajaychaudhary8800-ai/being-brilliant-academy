import { CourseStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
const router = Router();
const include = { category:true, branch:{select:{branchName:true}}, instructor:{select:{name:true,avatarUrl:true}}, _count:{select:{enrollments:true}}, modules:{include:{lessons:{select:{id:true,title:true,durationSeconds:true,preview:true,type:true}}}} } as const;
router.get("/",async(req,res)=>{const q=z.object({q:z.string().optional(),category:z.string().optional(),type:z.string().optional()}).parse(req.query);const data=await prisma.course.findMany({where:{status:CourseStatus.ACTIVE,...(q.category?{category:{slug:q.category}}:{}),...(q.type?{courseType:q.type as never}:{}),...(q.q?{OR:[{title:{contains:q.q,mode:"insensitive"}},{fullDescription:{contains:q.q,mode:"insensitive"}}]}:{})},include,orderBy:[{isFeatured:"desc"},{createdAt:"desc"}]});res.json({data})});
router.get("/:slug",async(req,res)=>{const data=await prisma.course.findUnique({where:{slug:req.params.slug},include});if(!data||data.status!==CourseStatus.ACTIVE)return res.status(404).json({error:{code:"NOT_FOUND",message:"Course not found"}});res.json({data})});
export default router;
