import * as React from "react"
import { Plus, Users, RefreshCw, AlertCircle, UserRound } from "lucide-react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog"
import { api } from "@/lib/api-client"

type Segment={id:string;name:string;description:string|null;criteria:Record<string,unknown>;is_dynamic:boolean;members_count:number;created_at:string}
type Lead={id:string;contact_name:string;organization_name:string|null}
type Customer={id:string;name:string}
const blank={name:"",description:"",isDynamic:false,leadStatus:""}
export default function CrmSegmentsPage(){
 const [segments,setSegments]=React.useState<Segment[]>([])
 const [leads,setLeads]=React.useState<Lead[]>([])
 const [customers,setCustomers]=React.useState<Customer[]>([])
 const [selection,setSelection]=React.useState<Record<string,string>>({})
 const [form,setForm]=React.useState(blank)
 const [open,setOpen]=React.useState(false)
 const [loading,setLoading]=React.useState(true)
 const [saving,setSaving]=React.useState(false)
 const [error,setError]=React.useState<string|null>(null)
 const load=React.useCallback(async()=>{
  setLoading(true);setError(null)
  try{const r=await Promise.all([api.get<Segment[]>("/crm/segments"),api.get<Lead[]>("/crm/leads"),api.get<Customer[]>("/crm/customers")]);setSegments(r[0]);setLeads(r[1]);setCustomers(r[2])}
  catch(e){setError(e&&typeof e==="object"&&"message" in e?String(e.message):"Could not load customer segments.")}
  finally{setLoading(false)}
 },[])
 React.useEffect(()=>{void Promise.resolve().then(load)},[load])
 async function save(){
  if(!form.name.trim()){setError("Segment name is required.");return}
  setSaving(true);setError(null)
  try{await api.post("/crm/segments",{name:form.name.trim(),description:form.description.trim()||undefined,isDynamic:form.isDynamic,criteria:{leadStatus:form.leadStatus||undefined}});setOpen(false);setForm(blank);await load()}
  catch(e){setError(e&&typeof e==="object"&&"message" in e?String(e.message):"Could not save segment.")}
  finally{setSaving(false)}
 }
 async function addMember(segment:Segment){
  const value=selection[segment.id]||""
  if(!value){setError("Choose a lead or customer to add to this segment.");return}
  const [kind,id]=value.split(":")
  try{await api.post("/crm/segments/"+segment.id+"/members",kind==="lead"?{leadId:id}:{customerId:id});setSelection({...selection,[segment.id]:""});await load()}
  catch(e){setError(e&&typeof e==="object"&&"message" in e?String(e.message):"Could not add segment member.")}
 }
 return <BaseLayout><div className="flex flex-col gap-6 px-4 lg:px-6">
  <PageHeader title="CRM customer segments" description="Build reusable audiences from company leads and customers." action={<Button onClick={()=>{setForm(blank);setOpen(true)}}><Plus className="size-4"/> New segment</Button>}/>
  {error&&<div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"><AlertCircle className="size-4"/><span className="flex-1">{error}</span><Button size="sm" variant="ghost" onClick={()=>void load()}><RefreshCw className="size-4"/> Retry</Button></div>}
  <div className="grid gap-3 sm:grid-cols-3">{[{label:"Segments",value:segments.length},{label:"Members assigned",value:segments.reduce((s,x)=>s+Number(x.members_count),0)},{label:"Dynamic segments",value:segments.filter(x=>x.is_dynamic).length}].map(m=><Card key={m.label}><CardContent className="p-4"><p className="text-sm text-muted-foreground">{m.label}</p><p className="mt-2 text-2xl font-semibold">{m.value}</p></CardContent></Card>)}</div>
  <Card><CardContent className="p-4">{loading?<div className="flex justify-center py-12"><LoadingSpinner/></div>:segments.length===0?<div className="flex flex-col items-center gap-2 py-12 text-center"><Users className="size-8 text-muted-foreground"/><p className="font-medium">No segments yet</p><p className="text-sm text-muted-foreground">Create an audience segment and add leads or customers.</p><Button variant="outline" onClick={()=>setOpen(true)}><Plus className="size-4"/> Create segment</Button></div>:<Table><TableHeader><TableRow><TableHead>Segment</TableHead><TableHead>Mode</TableHead><TableHead>Members</TableHead><TableHead>Add member</TableHead></TableRow></TableHeader><TableBody>{segments.map(s=><TableRow key={s.id}><TableCell><div className="font-medium">{s.name}</div><div className="max-w-xs text-xs text-muted-foreground">{s.description||"No description"}</div></TableCell><TableCell>{s.is_dynamic?"Dynamic criteria":"Manual"}</TableCell><TableCell>{s.members_count}</TableCell><TableCell><div className="flex flex-wrap gap-2"><select aria-label={"Choose member for "+s.name} disabled={s.is_dynamic} value={selection[s.id]||""} onChange={e=>setSelection({...selection,[s.id]:e.target.value})} className="h-9 max-w-64 rounded-md border border-input bg-background px-2 text-xs"><option value="">Choose lead/customer…</option><optgroup label="Leads">{leads.map(l=><option key={l.id} value={"lead:"+l.id}>{l.contact_name}{l.organization_name?" — "+l.organization_name:""}</option>)}</optgroup><optgroup label="Customers">{customers.map(c=><option key={c.id} value={"customer:"+c.id}>{c.name}</option>)}</optgroup></select><Button size="sm" variant="outline" onClick={()=>void addMember(s)} disabled={s.is_dynamic||!selection[s.id]}><UserRound className="size-3.5"/> Add</Button>{s.is_dynamic&&<span className="self-center text-xs text-muted-foreground">Auto-matched</span>}</div></TableCell></TableRow>)}</TableBody></Table>}</CardContent></Card>
 </div>
 <Dialog open={open} onOpenChange={setOpen}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>New customer segment</DialogTitle><DialogDescription>Create a named audience that your team can reuse for campaigns and customer follow-up.</DialogDescription></DialogHeader><div className="grid gap-4">
  <Field label="Segment name *" id="segment-name"><Input id="segment-name" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></Field>
  <Field label="Description" id="segment-description"><textarea id="segment-description" rows={3} value={form.description} onChange={e=>setForm({...form,description:e.target.value})} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"/></Field>
  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isDynamic} onChange={e=>setForm({...form,isDynamic:e.target.checked})}/> Dynamic lead segment</label>{form.isDynamic&&<Field label="Lead status filter" id="segment-status"><select id="segment-status" value={form.leadStatus} onChange={e=>setForm({...form,leadStatus:e.target.value})} className="h-9 rounded-md border border-input bg-background px-3 text-sm"><option value="">All leads</option><option value="new">New</option><option value="qualified">Qualified</option><option value="unqualified">Unqualified</option><option value="converted">Converted</option></select></Field>}
 </div><DialogFooter><DialogClose render={<Button variant="outline">Cancel</Button>}/><Button onClick={()=>void save()} disabled={saving||!form.name.trim()}>{saving?"Saving…":"Save segment"}</Button></DialogFooter></DialogContent></Dialog>
 </BaseLayout>
}
function Field({label,id,children}:{label:string;id:string;children:React.ReactNode}){return <div className="flex flex-col gap-1.5"><Label htmlFor={id}>{label}</Label>{children}</div>}
