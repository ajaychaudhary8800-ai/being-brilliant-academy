"use client";

/* eslint-disable @next/next/no-img-element -- authenticated blob page previews must not pass through the Next.js image optimizer */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Download, Loader2, Minus, Plus, Save, ShieldCheck } from "lucide-react";
import { getAccessToken } from "./auth-provider";
import { openAuthenticatedDocument } from "./authenticated-download";
import Sidebar from "./sidebar";

const API=process.env.NEXT_PUBLIC_API_URL??"http://localhost:4000/api/v1";
const authHeaders=()=>({"Content-Type":"application/json",Authorization:`Bearer ${getAccessToken()??""}`});
type Anchor={pageNumber:number;x:number;y:number;width:number;height:number;rotation:number;placementConfidence:number|null;evidenceText:string|null};
type Annotation={id:string;questionKey:string|null;type:string;content:string|null;marks:number|string|null;approvalState:string;sortOrder:number;vectorData:any;anchor:Anchor|null};
type Revision={id:string;revision:number;status:string;sourcePageCount:number;evaluationRevision:number;resultRevision:number;annotations:Annotation[];checkedCopy:{answerSheet:{id:string;fileName:string;student:{user:{name:string}};examination:{name:string}}};evaluation:{id:string;questions:Array<{questionKey:string;maxMarks:number|string;finalMarks:number|string|null}>}};
type Tool="SELECT"|"TICK"|"CROSS"|"UNDERLINE"|"CIRCLE"|"RECTANGLE"|"HIGHLIGHT"|"ARROW"|"FREEHAND"|"TEXT_COMMENT"|"QUESTION_MARK"|"STEP_MARK";
const tools:Tool[]=["SELECT","TICK","CROSS","UNDERLINE","CIRCLE","RECTANGLE","HIGHLIGHT","ARROW","FREEHAND","TEXT_COMMENT","QUESTION_MARK","STEP_MARK"];
const scoreTypes=new Set(["QUESTION_SCORE","PAGE_SCORE","TOTAL_SCORE"]);
function pageAnnotationText(annotation:Annotation){
  const raw=annotation.content??"";
  if(annotation.type==="ERROR_LABEL")return "✕ Recheck solution";
  if(annotation.type!=="RUBRIC_NOTE")return raw;
  const score=raw.match(/([+-]?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if(!score)return raw;
  const awarded=Number(score[1]),maximum=Number(score[2]),label=`${score[1]!.replace(/^\+/,"")}/${score[2]}`;
  return awarded<=0?`✕ ${label}`:Number.isFinite(maximum)&&awarded>=maximum?`✓ ${label}`:label;
}

async function jsonRequest(url:string,init?:RequestInit){
  const response=await fetch(url,{...init,headers:{...authHeaders(),...(init?.headers??{})}});
  const json=await response.json().catch(()=>null);
  if(!response.ok)throw Object.assign(new Error(json?.error?.message??"Request failed"),{status:response.status});
  return json;
}
const clamp=(value:number,min=0,max=1)=>Math.max(min,Math.min(max,value));
const pct=(value:number)=>`${value*100}%`;

export function AIExaminerCheckedCopyEditor({evaluationId,teacherView=false}:{evaluationId:string;teacherView?:boolean}){
  const [revision,setRevision]=useState<Revision|null>(null),[page,setPage]=useState(1),[pageUrl,setPageUrl]=useState(""),[zoom,setZoom]=useState(1);
  const [tool,setTool]=useState<Tool>("SELECT"),[selectedId,setSelectedId]=useState<string|null>(null),[placingId,setPlacingId]=useState<string|null>(null),[newText,setNewText]=useState("Check this step"),[editingText,setEditingText]=useState("");
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const canvasRef=useRef<HTMLDivElement|null>(null);
  const dragRef=useRef<{id:string;mode:"move"|"resize";startX:number;startY:number;anchor:Anchor}|null>(null);
  const freehandRef=useRef<Array<{x:number;y:number}>>([]);

  const load=useCallback(async()=>{
    setLoading(true);setError("");
    try{
      let json;
      try{json=await jsonRequest(`${API}/ai-examiner/evaluations/${evaluationId}/checked-copy/review`);}
      catch(cause:any){if(cause?.status!==404)throw cause;await jsonRequest(`${API}/ai-examiner/evaluations/${evaluationId}/checked-copy/draft`,{method:"POST"});json=await jsonRequest(`${API}/ai-examiner/evaluations/${evaluationId}/checked-copy/review`);}
      setRevision(json.data as Revision);setPage(current=>Math.min(Math.max(1,current),(json.data as Revision).sourcePageCount));
    }catch(cause){setError(cause instanceof Error?cause.message:"Unable to load checked copy");}
    finally{setLoading(false);}
  },[evaluationId]);
  useEffect(()=>{void load();},[load]);

  const revisionId=revision?.id;
  useEffect(()=>{
    if(!revisionId)return;
    let active=true,objectUrl="";
    void fetch(`${API}/ai-examiner/checked-copy/revisions/${revisionId}/pages/${page}`,{headers:{Authorization:`Bearer ${getAccessToken()??""}`}})
      .then(async response=>{if(!response.ok)throw new Error((await response.json().catch(()=>null))?.error?.message??"Page preview unavailable");return response.blob();})
      .then(blob=>{if(active){objectUrl=URL.createObjectURL(blob);setPageUrl(objectUrl);}})
      .catch(cause=>{if(active)setError(cause instanceof Error?cause.message:"Page preview unavailable");});
    return()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[revisionId,page]);

  const selected=revision?.annotations.find(row=>row.id===selectedId)??null;
  useEffect(()=>{setEditingText(selected?.content??"");},[selectedId,selected?.content]);
  const activeAnnotations=useMemo(()=>revision?.annotations.filter(row=>row.approvalState!=="REJECTED")??[],[revision]);
  const pageAnnotations=useMemo(()=>activeAnnotations.filter(row=>row.anchor?.pageNumber===page),[activeAnnotations,page]);
  const unresolvedAnnotations=useMemo(()=>activeAnnotations.filter(row=>row.approvalState==="POSITION_REVIEW_REQUIRED"||!row.anchor),[activeAnnotations]);
  const unresolved=unresolvedAnnotations.length;

  function point(event:ReactPointerEvent){const rect=canvasRef.current!.getBoundingClientRect();return{x:clamp((event.clientX-rect.left)/rect.width),y:clamp((event.clientY-rect.top)/rect.height)};}
  function updateLocal(id:string,anchor:Anchor){setRevision(current=>current?{...current,annotations:current.annotations.map(row=>row.id===id?{...row,anchor}:row)}:current);}
  async function patchAnnotation(id:string,body:Record<string,unknown>){
    if(!revision)return;setSaving(true);setError("");
    try{const json=await jsonRequest(`${API}/ai-examiner/checked-copy/revisions/${revision.id}/annotations/${id}`,{method:"PATCH",body:JSON.stringify(body)});setRevision(current=>current?{...current,annotations:current.annotations.map(row=>row.id===id?json.data:row)}:current);}
    catch(cause){setError(cause instanceof Error?cause.message:"Unable to update annotation");await load();}finally{setSaving(false);}
  }
  async function createAnnotation(type:Tool,anchor:Anchor,vectorData?:unknown){
    if(!revision||type==="SELECT")return;const content=type==="TEXT_COMMENT"?newText:type==="QUESTION_MARK"?"?":type==="STEP_MARK"?"+1":null;setSaving(true);setError("");
    try{const json=await jsonRequest(`${API}/ai-examiner/checked-copy/revisions/${revision.id}/annotations`,{method:"POST",body:JSON.stringify({type,content,anchor,vectorData:vectorData??null})});setRevision(current=>current?{...current,annotations:[...current.annotations,json.data]}:current);setSelectedId(json.data.id);setTool("SELECT");}
    catch(cause){setError(cause instanceof Error?cause.message:"Unable to add annotation");}finally{setSaving(false);}
  }
  function placementSize(type:string):[number,number]{
    const sizes:Record<string,[number,number]>={TICK:[.05,.05],CROSS:[.045,.045],UNDERLINE:[.2,.025],CIRCLE:[.18,.08],RECTANGLE:[.18,.08],HIGHLIGHT:[.2,.06],ARROW:[.18,.08],TEXT_COMMENT:[.24,.07],QUESTION_MARK:[.05,.05],STEP_MARK:[.08,.04],QUESTION_SCORE:[.13,.04],PAGE_SCORE:[.14,.05],TOTAL_SCORE:[.19,.05],RUBRIC_NOTE:[.09,.035],ERROR_LABEL:[.18,.04]};
    return sizes[type]??[.22,.07];
  }
  function handleCanvasDown(event:ReactPointerEvent<HTMLDivElement>){
    if(!revision||revision.status!=="DRAFT"||(event.target as HTMLElement).closest("[data-annotation]"))return;
    const p=point(event);
    if(placingId){
      const row=revision.annotations.find(item=>item.id===placingId);
      if(!row)return;
      const [width,height]=placementSize(row.type),anchor={pageNumber:page,x:clamp(p.x-width/2,0,1-width),y:clamp(p.y-height/2,0,1-height),width,height,rotation:0,placementConfidence:1,evidenceText:row.anchor?.evidenceText??null};
      updateLocal(row.id,anchor);setPlacingId(null);void patchAnnotation(row.id,{anchor});return;
    }
    if(tool==="SELECT")return;
    if(tool==="FREEHAND"){freehandRef.current=[p];event.currentTarget.setPointerCapture(event.pointerId);return;}
    const [width,height]=placementSize(tool);void createAnnotation(tool,{pageNumber:page,x:clamp(p.x-width/2,0,1-width),y:clamp(p.y-height/2,0,1-height),width,height,rotation:0,placementConfidence:1,evidenceText:null});
  }
  function handleCanvasMove(event:ReactPointerEvent<HTMLDivElement>){
    if(freehandRef.current.length){const p=point(event),last=freehandRef.current.at(-1)!;if(Math.hypot(p.x-last.x,p.y-last.y)>.003)freehandRef.current.push(p);return;}
    const drag=dragRef.current;if(!drag||!canvasRef.current)return;const rect=canvasRef.current.getBoundingClientRect(),dx=(event.clientX-drag.startX)/rect.width,dy=(event.clientY-drag.startY)/rect.height,a=drag.anchor;
    updateLocal(drag.id,drag.mode==="move"?{...a,x:clamp(a.x+dx,0,1-a.width),y:clamp(a.y+dy,0,1-a.height)}:{...a,width:clamp(a.width+dx,.015,1-a.x),height:clamp(a.height+dy,.015,1-a.y)});
  }
  function handleCanvasUp(event:ReactPointerEvent<HTMLDivElement>){
    if(freehandRef.current.length){const points=[...freehandRef.current];freehandRef.current=[];if(points.length>1){const xs=points.map(p=>p.x),ys=points.map(p=>p.y),x=Math.min(...xs),y=Math.min(...ys),maxX=Math.max(...xs),maxY=Math.max(...ys);void createAnnotation("FREEHAND",{pageNumber:page,x,y,width:Math.max(.01,maxX-x),height:Math.max(.01,maxY-y),rotation:0,placementConfidence:1,evidenceText:null},{points});}try{event.currentTarget.releasePointerCapture(event.pointerId);}catch{}return;}
    const drag=dragRef.current;dragRef.current=null;if(drag){const row=revision?.annotations.find(item=>item.id===drag.id);if(row?.anchor)void patchAnnotation(row.id,{anchor:row.anchor});}
  }
  function startDrag(event:ReactPointerEvent,id:string,mode:"move"|"resize"){
    if(!revision||revision.status!=="DRAFT")return;event.stopPropagation();const row=revision.annotations.find(item=>item.id===id);if(!row?.anchor||row.type==="FREEHAND")return;
    dragRef.current={id,mode,startX:event.clientX,startY:event.clientY,anchor:{...row.anchor}};setSelectedId(id);canvasRef.current?.setPointerCapture(event.pointerId);
  }
  async function approvePage(){if(!revision)return;setSaving(true);setError("");try{await jsonRequest(`${API}/ai-examiner/checked-copy/revisions/${revision.id}/pages/${page}/approve`,{method:"POST"});setNotice(`Page ${page} annotations approved.`);await load();}catch(cause){setError(cause instanceof Error?cause.message:"Unable to approve page");}finally{setSaving(false);}}
  async function autoPlace(){if(!revision)return;setSaving(true);setError("");setNotice("");try{const json=await jsonRequest(`${API}/ai-examiner/checked-copy/revisions/${revision.id}/auto-place`,{method:"POST"});const count=Number(json?.meta?.autoPlaced??0);setRevision(json.data as Revision);setNotice(count?`Auto Red-Pen placed ${count} annotation(s). Review the remaining exceptions only.`:"No additional annotations could be placed automatically.");}catch(cause){setError(cause instanceof Error?cause.message:"Unable to auto-place checked-copy annotations");}finally{setSaving(false);}}
  async function approveCopy(){if(!revision)return;setSaving(true);setError("");setNotice("");try{await jsonRequest(`${API}/ai-examiner/checked-copy/revisions/${revision.id}/approve`,{method:"POST"});setNotice("Checked Copy — Approved and rendered.");await load();}catch(cause){setError(cause instanceof Error?cause.message:"Unable to approve checked copy");}finally{setSaving(false);}}
  async function previewPdf(){if(!revision)return;try{await openAuthenticatedDocument({url:`${API}/ai-examiner/checked-copy/revisions/${revision.id}/preview-pdf`,token:getAccessToken()??"",fileName:"checked-copy-preview.download",fallbackError:"Checked copy preview unavailable"});}catch(cause){setError(cause instanceof Error?cause.message:"Checked copy preview unavailable");}}
  async function download(){if(!revision)return;try{await openAuthenticatedDocument({url:`${API}/ai-examiner/evaluations/${evaluationId}/checked-copy`,token:getAccessToken()??"",fileName:`${revision.checkedCopy.answerSheet.fileName.replace(/\.[^.]+$/,"")}-checked.pdf`,fallbackError:"Approved checked copy unavailable"});}catch(cause){setError(cause instanceof Error?cause.message:"Approved checked copy unavailable");}}

  const back=teacherView?"/teacher/ai-examiner":"/admin/ai-examiner";
  return <div className="min-h-screen bg-slate-50">{!teacherView&&<Sidebar/>}<main className={`p-4 md:p-8 ${teacherView?"":"md:ml-64"}`}><div className="mx-auto max-w-[1500px]">
    <Link href={back} className="font-bold text-brand-700">← Ranpal AI Examiner</Link>
    <header className="mt-3 flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-bold text-brand-700">RANPAL AI EXAMINER</p><h1 className="text-3xl font-black">Checked Copy Review</h1><p className="text-sm text-slate-500">Non-destructive red-pen annotations over the immutable original answer sheet.</p></div><ShieldCheck size={34} className="text-brand-700"/></header>
    {notice&&<p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}{error&&<p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {loading?<Loader2 className="mx-auto my-24 animate-spin"/>:revision&&<>
      <div className="mt-5 flex flex-wrap items-center gap-2 rounded-2xl border bg-white p-4 text-sm"><b>{revision.status==="DRAFT"?"AI Checked Copy — Draft":"Checked Copy — Approved"}</b><span>· Revision {revision.revision}</span><span>· Evaluation {revision.evaluationRevision}</span><span>· Result revision {revision.resultRevision}</span><span className={`rounded-full px-2 py-1 font-bold ${unresolved?"bg-amber-50 text-amber-800":"bg-emerald-50 text-emerald-800"}`}>{unresolved} position review required</span><span className="ml-auto">{revision.checkedCopy.answerSheet.student.user.name} · {revision.checkedCopy.answerSheet.examination.name}</span></div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[240px_minmax(0,1fr)_300px]">
        <aside className="rounded-2xl border bg-white p-4"><h2 className="font-black">Tools</h2><div className="mt-3 grid grid-cols-2 gap-2">{tools.map(item=><button key={item} disabled={revision.status!=="DRAFT"} onClick={()=>{setTool(item);setPlacingId(null);}} className={`rounded-lg border px-2 py-2 text-xs font-bold ${tool===item?"bg-red-50 text-red-700 ring-2 ring-red-200":""}`}>{item.replace("_"," ")}</button>)}</div>{tool==="TEXT_COMMENT"&&<textarea className="field mt-3 min-h-20 text-sm" value={newText} onChange={e=>setNewText(e.target.value)} maxLength={2000}/>}<p className="mt-3 text-xs text-slate-500">{placingId?"Placement mode active: click the exact answer-sheet location for the selected annotation.":tool==="SELECT"?"Select an annotation to move, resize, approve, reject or edit it.":tool==="FREEHAND"?"Draw directly on the page.":"Click the exact page location to add the selected mark."}</p><div className="mt-4 border-t pt-4"><h3 className="text-xs font-bold uppercase text-slate-500">Question scores</h3><div className="mt-2 space-y-1">{activeAnnotations.filter(row=>row.type==="QUESTION_SCORE").map(row=><button key={row.id} onClick={()=>{setSelectedId(row.id);setTool("SELECT");if(row.anchor){setPlacingId(null);setPage(row.anchor.pageNumber);}else setPlacingId(row.id);}} className={`block w-full rounded-lg px-2 py-1 text-left text-sm hover:bg-slate-50 ${placingId===row.id?"bg-amber-50 ring-1 ring-amber-300":""}`}>{row.content}{!row.anchor&&<span className="ml-1 text-amber-700">• place</span>}</button>)}</div></div><div className="mt-4 border-t pt-4"><h3 className="text-xs font-bold uppercase text-slate-500">Needs placement</h3><div className="mt-2 max-h-64 space-y-1 overflow-auto">{unresolvedAnnotations.filter(row=>row.type!=="QUESTION_SCORE").map(row=><button key={row.id} onClick={()=>{setSelectedId(row.id);setTool("SELECT");setPlacingId(row.id);}} className={`block w-full rounded-lg px-2 py-2 text-left text-xs hover:bg-slate-50 ${placingId===row.id?"bg-amber-50 ring-1 ring-amber-300":""}`}><b>{row.questionKey?`${row.questionKey} · `:""}{row.type.replaceAll("_"," ")}</b>{row.content&&<span className="mt-1 block line-clamp-2 text-slate-500">{row.content}</span>}<span className="text-amber-700">• place</span></button>)}</div></div></aside>
        <section className="min-w-0 rounded-2xl border bg-slate-200 p-3">
          <div className="mb-3 flex flex-wrap items-center gap-2"><button className="btn" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Previous</button><b>Page {page}/{revision.sourcePageCount}</b><button className="btn" disabled={page>=revision.sourcePageCount} onClick={()=>setPage(p=>p+1)}>Next</button><button className="btn ml-auto" onClick={()=>setZoom(z=>Math.max(.6,z-.1))}><Minus size={15}/></button><span>{Math.round(zoom*100)}%</span><button className="btn" onClick={()=>setZoom(z=>Math.min(1.8,z+.1))}><Plus size={15}/></button></div>
          <div className="overflow-auto"><div className="mx-auto origin-top" style={{width:`${zoom*100}%`,maxWidth:"none"}}><div ref={canvasRef} className="relative select-none bg-white shadow" onPointerDown={handleCanvasDown} onPointerMove={handleCanvasMove} onPointerUp={handleCanvasUp}>{pageUrl?<img src={pageUrl} alt={`Answer sheet page ${page}`} className="block h-auto w-full pointer-events-none"/>:<div className="aspect-[3/4] animate-pulse bg-slate-100"/>}<div className="absolute inset-0">
            {pageAnnotations.map(annotation=>{const a=annotation.anchor!,selectedNow=selectedId===annotation.id;const base:CSSProperties={left:pct(a.x),top:pct(a.y),width:pct(a.width),height:pct(a.height),transform:`rotate(${a.rotation||0}deg)`};const common=`absolute cursor-move text-red-600 ${selectedNow?"ring-2 ring-blue-500 ring-offset-1":""}`;let content:any=null;
              if(annotation.type==="TICK")content=<span className="text-4xl font-black leading-none">✓</span>;else if(annotation.type==="CROSS")content=<span className="text-4xl font-black leading-none">✕</span>;else if(annotation.type==="QUESTION_MARK")content=<span className="text-3xl font-black">?</span>;else if(annotation.type==="CIRCLE")content=<span className="block h-full w-full rounded-full border-[3px] border-red-600"/>;else if(annotation.type==="RECTANGLE")content=<span className="block h-full w-full border-[3px] border-red-600"/>;else if(annotation.type==="UNDERLINE")content=<span className="block h-full w-full border-b-[3px] border-red-600"/>;else if(annotation.type==="HIGHLIGHT")content=<span className="block h-full w-full border border-red-400 bg-red-200/25"/>;else if(annotation.type==="ARROW")content=<span className="block text-4xl font-black leading-none">→</span>;else if(annotation.type==="FREEHAND"){const pts=Array.isArray(annotation.vectorData?.points)?annotation.vectorData.points:[];content=<svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"><polyline points={pts.map((p:any)=>`${((p.x-a.x)/a.width)*100},${((p.y-a.y)/a.height)*100}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke"/></svg>;}else content=<span className={`block whitespace-pre-wrap font-semibold italic leading-tight ${scoreTypes.has(annotation.type)?"text-lg font-black":annotation.type==="RUBRIC_NOTE"?"text-base font-black":""}`}>{pageAnnotationText(annotation)}</span>;
              return <div data-annotation="true" key={annotation.id} style={base} className={common} onPointerDown={e=>startDrag(e,annotation.id,"move")} onClick={e=>{e.stopPropagation();setSelectedId(annotation.id);}}>{content}{selectedNow&&revision.status==="DRAFT"&&annotation.type!=="FREEHAND"&&<button aria-label="Resize annotation" onPointerDown={e=>startDrag(e,annotation.id,"resize")} className="absolute -bottom-2 -right-2 h-4 w-4 rounded-full border-2 border-white bg-blue-600"/>}</div>;
            })}
          </div></div></div></div>{revision.status==="DRAFT"&&<div className="mt-3 flex justify-end"><button className="btn" disabled={saving} onClick={()=>void approvePage()}>Approve page annotations</button></div>}</section>
        <aside className="rounded-2xl border bg-white p-4"><h2 className="font-black">Annotation review</h2>{revision.status==="DRAFT"&&unresolved>0&&<button className="btn mb-3 w-full border-red-200 bg-red-50 text-red-800" disabled={saving} onClick={()=>void autoPlace()}>Auto-place remaining ({unresolved})</button>}{selected?<div className="mt-3 space-y-3 text-sm"><div><b>{selected.type.replaceAll("_"," ")}</b><p className="text-xs text-slate-500">{selected.questionKey??"Page annotation"} · {selected.approvalState.replaceAll("_"," ")}</p></div>{!scoreTypes.has(selected.type)&&!["TICK","CROSS","CIRCLE","RECTANGLE","UNDERLINE","HIGHLIGHT","ARROW","FREEHAND"].includes(selected.type)&&<label className="block font-semibold">Comment<textarea disabled={revision.status!=="DRAFT"} className="field mt-1 min-h-24" value={editingText} onChange={e=>setEditingText(e.target.value)}/></label>}{revision.status==="DRAFT"&&<>{!selected.anchor&&<button className="btn w-full border-amber-300 bg-amber-50 text-amber-800" onClick={()=>{setTool("SELECT");setPlacingId(selected.id);}}>Place on current page</button>}{placingId===selected.id&&!selected.anchor&&<p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">Placement mode active. Click the exact location on the answer sheet.</p>}{!scoreTypes.has(selected.type)&&<button className="btn w-full" onClick={()=>void patchAnnotation(selected.id,{content:editingText})}><Save size={15}/>Save text</button>}{selected.approvalState!=="APPROVED"&&selected.anchor&&<button className="btn w-full bg-emerald-700 text-white" onClick={()=>void patchAnnotation(selected.id,{approvalState:"APPROVED"})}>Approve annotation</button>}{!scoreTypes.has(selected.type)&&<button className="btn w-full border-red-200 text-red-700" onClick={()=>void patchAnnotation(selected.id,{approvalState:"REJECTED"})}>Reject annotation</button>}</>}</div>:<p className="mt-3 text-sm text-slate-500">Select a red mark on the page.</p>}<div className="mt-5 border-t pt-4">{revision.status==="DRAFT"?<div className="space-y-2"><button className="btn w-full" onClick={()=>void previewPdf()}><Download size={16}/>Download draft PDF preview</button><button disabled={saving||unresolved>0} onClick={()=>void approveCopy()} className="btn w-full bg-red-700 text-white disabled:opacity-40"><ShieldCheck size={16}/>Approve whole checked copy</button></div>:<button className="btn w-full bg-red-700 text-white" onClick={()=>void download()}><Download size={16}/>Download checked copy PDF</button>}{unresolved>0&&revision.status==="DRAFT"&&<p className="mt-2 text-xs text-amber-700">{unresolved} exception(s) still need review before final approval.</p>}</div></aside>
      </div>{saving&&<div className="fixed bottom-5 right-5 rounded-xl bg-slate-900 px-4 py-2 text-sm text-white"><Loader2 className="mr-2 inline animate-spin" size={15}/>Saving</div>}
    </>}</div></main></div>;
}
