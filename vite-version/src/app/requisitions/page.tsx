import * as React from "react";
import { AlertCircle, ClipboardList, Loader2, Plus, RefreshCw, Send, Pencil, Trash2, X } from "lucide-react";
import { BaseLayout } from "@/components/layouts/base-layout";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";
import { useAuth } from "@/contexts/auth-context";

type Product={id:string;name:string;sku:string;is_active:boolean};
type Requisition={id:string;request_number:string;title:string;status:string;notes:string|null;requester_user_id:string;requester_name:string;created_at:string;item_count:number};
type RequisitionLine={productId:string;quantity:string;notes:string};
type RequisitionDetail=Requisition&{required_by:string|null;items:Array<{id:string;product_id:string;quantity:string|number;notes:string|null}>};
const statusLabels:Record<string,string>={draft:"Draft",pending_approval:"Pending approval",approved:"Approved",rejected:"Rejected",cancelled:"Cancelled"};
function errorText(e:unknown){return e&&typeof e==="object"&&"message" in e?String((e as {message:unknown}).message):"Request failed. Please try again."}
const blankLine=():RequisitionLine=>({productId:"",quantity:"1",notes:""});

export default function RequisitionsPage(){
 const {user}=useAuth();
 const [rows,setRows]=React.useState<Requisition[]>([]);
 const [products,setProducts]=React.useState<Product[]>([]);
 const [title,setTitle]=React.useState("");
 const [notes,setNotes]=React.useState("");
 const [requiredBy,setRequiredBy]=React.useState("");
 const [lines,setLines]=React.useState<RequisitionLine[]>([blankLine()]);
 const [editingId,setEditingId]=React.useState("");
 const [loading,setLoading]=React.useState(true);
 const [saving,setSaving]=React.useState(false);
 const [busy,setBusy]=React.useState("");
 const [error,setError]=React.useState("");

 const refresh=React.useCallback(async()=>{
  setLoading(true);setError("");
  try{
   const [requisitions,productRows]=await Promise.all([api.get<Requisition[]>("/requisitions"),api.get<Product[]>("/products")]);
   setRows(requisitions);
   setProducts(productRows.filter(p=>p.is_active));
  }catch(e){setError(errorText(e));}
  finally{setLoading(false);}
 },[]);
 React.useEffect(()=>{let active=true;void Promise.all([api.get<Requisition[]>("/requisitions"),api.get<Product[]>("/products")]).then(([requisitions,productRows])=>{if(active){setRows(requisitions);setProducts(productRows.filter(p=>p.is_active));}}).catch(e=>{if(active)setError(errorText(e));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[]);

 const resetForm=()=>{setEditingId("");setTitle("");setNotes("");setRequiredBy("");setLines([blankLine()]);};
 const updateLine=(index:number,key:keyof RequisitionLine,value:string)=>setLines(current=>current.map((line,i)=>i===index?{...line,[key]:value}:line));
 const edit=async(id:string)=>{
  setBusy(id);setError("");
  try{
   const detail=await api.get<RequisitionDetail>("/requisitions/"+id);
   setEditingId(id);setTitle(detail.title);setNotes(detail.notes||"");setRequiredBy(detail.required_by?.slice(0,10)||"");
   setLines(detail.items.map(item=>({productId:item.product_id,quantity:String(item.quantity),notes:item.notes||""})));
   window.scrollTo({top:0,behavior:"smooth"});
  }catch(e){setError(errorText(e));}
  finally{setBusy("");}
 };
 const save=async()=>{
  if(!title.trim()||!lines.length||lines.some(line=>!line.productId||!Number.isFinite(Number(line.quantity))||Number(line.quantity)<=0)){
   setError("Enter a title and complete every product line with a quantity greater than zero.");return;
  }
  setSaving(true);setError("");
  const payload={title:title.trim(),notes:notes.trim()||undefined,requiredBy:requiredBy||null,items:lines.map(line=>({productId:line.productId,quantity:Number(line.quantity),notes:line.notes.trim()||undefined}))};
  try{
   if(editingId) await api.patch("/requisitions/"+editingId,payload);
   else await api.post("/requisitions",payload);
   resetForm();await refresh();
  }catch(e){setError(errorText(e));}
  finally{setSaving(false);}
 };
 const submit=async(id:string)=>{
  setBusy(id);setError("");
  try{await api.post("/requisitions/"+id+"/submit");await refresh();}
  catch(e){setError(errorText(e));}
  finally{setBusy("");}
 };

 return <BaseLayout><div className="flex flex-col gap-5 px-4 lg:px-6">
  <PageHeader title="Purchase Requisitions" description="Create and edit itemized purchase requests. Approved requisitions can be converted into supplier purchase orders." action={<Button variant="outline" onClick={()=>void refresh()} disabled={loading}><RefreshCw className="mr-2 size-4"/>Refresh</Button>}/>
  {error&&<div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/30 p-3 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0"/>{error}</div>}
  <Card><CardHeader><CardTitle className="flex items-center gap-2"><Plus className="size-4"/>{editingId?"Edit requisition":"New requisition"}</CardTitle></CardHeader><CardContent className="flex flex-col gap-4">
   <div className="grid gap-4 md:grid-cols-2">
    <div className="grid gap-2"><Label htmlFor="req-title">Request title</Label><Input id="req-title" value={title} onChange={e=>setTitle(e.target.value)} maxLength={200} placeholder="Workshop consumables"/></div>
    <div className="grid gap-2"><Label htmlFor="req-required-by">Required by (optional)</Label><Input id="req-required-by" type="date" value={requiredBy} onChange={e=>setRequiredBy(e.target.value)}/></div>
    <div className="grid gap-2 md:col-span-2"><Label htmlFor="req-notes">Request notes (optional)</Label><Input id="req-notes" value={notes} onChange={e=>setNotes(e.target.value)} maxLength={2000} placeholder="Purpose or delivery notes"/></div>
   </div>
   <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Requested items</h3><Button type="button" variant="outline" size="sm" onClick={()=>setLines(current=>[...current,blankLine()])}><Plus className="mr-1 size-4"/>Add item</Button></div>
   {lines.map((line,index)=><div key={index} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[minmax(180px,2fr)_120px_minmax(150px,1fr)_auto]">
    <div className="grid gap-1"><Label htmlFor={`req-product-${index}`}>Product</Label><select id={`req-product-${index}`} className="h-9 rounded-md border bg-background px-3 text-sm" value={line.productId} onChange={e=>updateLine(index,"productId",e.target.value)}><option value="">Select active product</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}{p.sku?" · "+p.sku:""}</option>)}</select></div>
    <div className="grid gap-1"><Label htmlFor={`req-quantity-${index}`}>Quantity</Label><Input id={`req-quantity-${index}`} type="number" min="0.001" step="0.001" value={line.quantity} onChange={e=>updateLine(index,"quantity",e.target.value)}/></div>
    <div className="grid gap-1"><Label htmlFor={`req-line-notes-${index}`}>Line notes</Label><Input id={`req-line-notes-${index}`} value={line.notes} onChange={e=>updateLine(index,"notes",e.target.value)} maxLength={500} placeholder="Optional"/></div>
    <div className="flex items-end"><Button type="button" variant="ghost" size="icon" aria-label="Remove item" disabled={lines.length===1} onClick={()=>setLines(current=>current.filter((_,i)=>i!==index))}><Trash2 className="size-4"/></Button></div>
   </div>)}
   <div className="flex flex-wrap gap-2"><Button onClick={()=>void save()} disabled={saving||!products.length}>{saving?<Loader2 className="mr-2 size-4 animate-spin"/>:<Plus className="mr-2 size-4"/>}{editingId?"Save changes":"Save draft"}</Button>{editingId&&<Button type="button" variant="outline" onClick={resetForm} disabled={saving}><X className="mr-2 size-4"/>Cancel edit</Button>}</div>
   {!products.length&&!loading&&<p className="text-sm text-muted-foreground">No active products are available for requisition.</p>}
  </CardContent></Card>
  <Card><CardHeader><CardTitle className="flex items-center gap-2"><ClipboardList className="size-4"/>Requisition register</CardTitle></CardHeader><CardContent>
   {loading?<div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin"/>Loading requisitions…</div>:rows.length===0?<div className="py-10 text-center"><ClipboardList className="mx-auto mb-3 size-8 text-muted-foreground"/><p className="font-medium">No requisitions yet</p><p className="text-sm text-muted-foreground">Create a draft above to get started.</p></div>:<div className="space-y-3">{rows.map(row=><div key={row.id} className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{row.request_number}</span><span className="rounded-full bg-muted px-2 py-0.5 text-xs">{statusLabels[row.status]||row.status}</span></div><p className="mt-1 font-medium">{row.title}</p><p className="text-sm text-muted-foreground">{row.requester_name} · {row.item_count} line(s) · {new Date(row.created_at).toLocaleDateString()}</p>{row.notes&&<p className="mt-1 text-sm text-muted-foreground">{row.notes}</p>}</div>{(row.status==="draft"||row.status==="rejected")&&row.requester_user_id===user?.userId&&<div className="flex gap-2"><Button size="sm" variant="outline" onClick={()=>void edit(row.id)} disabled={busy===row.id}>{busy===row.id?<Loader2 className="mr-2 size-4 animate-spin"/>:<Pencil className="mr-2 size-4"/>}Edit</Button><Button size="sm" onClick={()=>void submit(row.id)} disabled={busy===row.id}>{busy===row.id?<Loader2 className="mr-2 size-4 animate-spin"/>:<Send className="mr-2 size-4"/>}Submit for approval</Button></div>}</div>)}</div>}
  </CardContent></Card>
 </div></BaseLayout>;
}
