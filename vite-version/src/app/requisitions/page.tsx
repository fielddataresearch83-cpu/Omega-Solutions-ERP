import * as React from "react";
import { AlertCircle, ClipboardList, Loader2, Plus, RefreshCw, Send } from "lucide-react";
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
const statusLabels:Record<string,string>={draft:"Draft",pending_approval:"Pending approval",approved:"Approved",rejected:"Rejected",cancelled:"Cancelled"};
function errorText(e:unknown){return e&&typeof e==="object"&&"message" in e?String((e as {message:unknown}).message):"Request failed. Please try again."}
export default function RequisitionsPage(){
 const {user}=useAuth();const [rows,setRows]=React.useState<Requisition[]>([]);const [products,setProducts]=React.useState<Product[]>([]);
 const [title,setTitle]=React.useState("");const [notes,setNotes]=React.useState("");const [productId,setProductId]=React.useState("");const [quantity,setQuantity]=React.useState("1");
 const [loading,setLoading]=React.useState(true);const [saving,setSaving]=React.useState(false);const [busy,setBusy]=React.useState("");const [error,setError]=React.useState("");
 const refresh=React.useCallback(async()=>{setLoading(true);setError("");try{const result=await Promise.all([api.get<Requisition[]>("/requisitions"),api.get<Product[]>("/products")]);setRows(result[0]);setProducts(result[1].filter(p=>p.is_active));setProductId(v=>v||result[1].find(p=>p.is_active)?.id||"");}catch(e){setError(errorText(e));}finally{setLoading(false);}},[]);
 React.useEffect(()=>{let active=true;void Promise.all([api.get<Requisition[]>("/requisitions"),api.get<Product[]>("/products")]).then(result=>{if(!active)return;setRows(result[0]);setProducts(result[1].filter(p=>p.is_active));setProductId(v=>v||result[1].find(p=>p.is_active)?.id||"");}).catch(e=>{if(active)setError(errorText(e));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[]);
 const create=async()=>{if(!title.trim()||!productId||!(Number(quantity)>0)){setError("Enter a title, active product and quantity greater than zero.");return;}setSaving(true);setError("");try{await api.post("/requisitions",{title:title.trim(),notes:notes.trim()||undefined,items:[{productId,quantity:Number(quantity)}]});setTitle("");setNotes("");setQuantity("1");await refresh();}catch(e){setError(errorText(e));}finally{setSaving(false);}};
 const submit=async(id:string)=>{setBusy(id);setError("");try{await api.post("/requisitions/"+id+"/submit");await refresh();}catch(e){setError(errorText(e));}finally{setBusy("");}};
 return <BaseLayout><div className="flex flex-col gap-5 px-4 lg:px-6">
  <PageHeader title="Purchase Requisitions" description="Request items for purchasing. Approval does not issue stock or post accounting entries." action={<Button variant="outline" onClick={()=>void refresh()} disabled={loading}><RefreshCw className="mr-2 size-4"/>Refresh</Button>}/>
  {error&&<div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/30 p-3 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0"/>{error}</div>}
  <Card><CardHeader><CardTitle className="flex items-center gap-2"><Plus className="size-4"/>New requisition</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-2">
   <div className="grid gap-2"><Label htmlFor="req-title">Request title</Label><Input id="req-title" value={title} onChange={e=>setTitle(e.target.value)} placeholder="Workshop consumables"/></div>
   <div className="grid gap-2"><Label htmlFor="req-product">Product</Label><select id="req-product" className="h-9 rounded-md border bg-background px-3 text-sm" value={productId} onChange={e=>setProductId(e.target.value)}><option value="">Select active product</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}{p.sku?" · "+p.sku:""}</option>)}</select></div>
   <div className="grid gap-2"><Label htmlFor="req-qty">Quantity</Label><Input id="req-qty" type="number" min="0.001" step="0.001" value={quantity} onChange={e=>setQuantity(e.target.value)}/></div>
   <div className="grid gap-2"><Label htmlFor="req-notes">Notes (optional)</Label><Input id="req-notes" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Purpose or delivery notes"/></div>
   <div className="md:col-span-2"><Button onClick={()=>void create()} disabled={saving||!products.length}>{saving?<Loader2 className="mr-2 size-4 animate-spin"/>:<Plus className="mr-2 size-4"/>}Save draft</Button>{!products.length&&!loading&&<p className="mt-2 text-sm text-muted-foreground">No active products are available for requisition.</p>}</div>
  </CardContent></Card>
  <Card><CardHeader><CardTitle className="flex items-center gap-2"><ClipboardList className="size-4"/>Requisition register</CardTitle></CardHeader><CardContent>
   {loading?<div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin"/>Loading requisitions…</div>:rows.length===0?<div className="py-10 text-center"><ClipboardList className="mx-auto mb-3 size-8 text-muted-foreground"/><p className="font-medium">No requisitions yet</p><p className="text-sm text-muted-foreground">Create a draft above to get started.</p></div>:<div className="space-y-3">{rows.map(r=><div key={r.id} className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{r.request_number}</span><span className="rounded-full bg-muted px-2 py-0.5 text-xs">{statusLabels[r.status]||r.status}</span></div><p className="mt-1 font-medium">{r.title}</p><p className="text-sm text-muted-foreground">{r.requester_name} · {r.item_count} line(s) · {new Date(r.created_at).toLocaleDateString()}</p>{r.notes&&<p className="mt-1 text-sm text-muted-foreground">{r.notes}</p>}</div>{r.status==="draft"&&r.requester_user_id===user?.userId&&<Button size="sm" onClick={()=>void submit(r.id)} disabled={busy===r.id}>{busy===r.id?<Loader2 className="mr-2 size-4 animate-spin"/>:<Send className="mr-2 size-4"/>}Submit for approval</Button>}</div>)}</div>}
  </CardContent></Card>
 </div></BaseLayout>;
}
