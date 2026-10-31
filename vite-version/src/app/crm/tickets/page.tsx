import * as React from "react"
import { Plus, Headset, RefreshCw, AlertCircle, Search } from "lucide-react"
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
import { formatDate } from "@/lib/format"

type Ticket={id:string;ticket_number:number|string;subject:string;description:string|null;status:string;priority:string;customer_id:string|null;lead_id:string|null;assigned_user_id:string|null;customer_name:string|null;lead_contact_name:string|null;assignee_name:string|null;due_at:string|null;created_at:string}
type Assignee={user_id:string;full_name:string;email:string}
type Customer={id:string;name:string}
type Lead={id:string;contact_name:string;organization_name:string|null}
const statuses=["open","in_progress","waiting_customer","resolved","closed"]
const priorities=["low","normal","high","urgent"]
const label=(s:string)=>s.replaceAll("_"," ").replace(/\b\w/g,x=>x.toUpperCase())
const blank={subject:"",description:"",customerId:"",leadId:"",priority:"normal",dueAt:""}
const priorityClass=(s:string)=>s==="urgent"?"text-red-700 dark:text-red-300":s==="high"?"text-orange-700 dark:text-orange-300":"text-muted-foreground"

export default function CrmTicketsPage(){
 const [tickets,setTickets]=React.useState<Ticket[]>([])
 const [hasMore,setHasMore]=React.useState(false)
 const [loadingMore,setLoadingMore]=React.useState(false)
 const [customers,setCustomers]=React.useState<Customer[]>([])
 const [leads,setLeads]=React.useState<Lead[]>([])
 const [assignees,setAssignees]=React.useState<Assignee[]>([])
 const [search,setSearch]=React.useState("")
 const [status,setStatus]=React.useState("all")
 const [priority,setPriority]=React.useState("all")
 const [form,setForm]=React.useState(blank)
 const [open,setOpen]=React.useState(false)
 const [loading,setLoading]=React.useState(true)
 const [saving,setSaving]=React.useState(false)
 const [error,setError]=React.useState<string|null>(null)
 const load=React.useCallback(async()=>{
  setLoading(true);setError(null)
  try{
   const p=new URLSearchParams();if(status!=="all")p.set("status",status);if(priority!=="all")p.set("priority",priority);if(search.trim())p.set("search",search.trim())
    p.set("limit","100");p.set("offset","0")
   const r=await Promise.all([api.get<Ticket[]>("/crm/tickets?"+p.toString()),api.get<Customer[]>("/crm/customers"),api.get<Lead[]>("/crm/leads"),api.get<Assignee[]>("/crm/assignees")])
   setTickets(r[0]);setHasMore(r[0].length===100);setCustomers(r[1]);setLeads(r[2]);setAssignees(r[3])
  }catch(e){setError(e&&typeof e==="object"&&"message" in e?String(e.message):"Could not load support tickets.")}
  finally{setLoading(false)}
 },[search,status,priority])
 React.useEffect(()=>{void Promise.resolve().then(load)},[load])

 async function loadMore(){
  if(loadingMore||!hasMore)return
  setLoadingMore(true);setError(null)
  try{
   const p=new URLSearchParams({limit:"100",offset:String(tickets.length)})
   if(status!=="all")p.set("status",status)
   if(priority!=="all")p.set("priority",priority)
   if(search.trim())p.set("search",search.trim())
   const next=await api.get<Ticket[]>("/crm/tickets?"+p.toString())
   setTickets(current=>[...current,...next]);setHasMore(next.length===100)
  }catch(e){setError(e&&typeof e==="object"&&"message" in e?String(e.message):"Could not load more tickets.")}
  finally{setLoadingMore(false)}
 }
 async function save(){
  if(!form.subject.trim()||(!form.customerId&&!form.leadId)){setError("Ticket subject and a linked customer or lead are required.");return}
  setSaving(true);setError(null)
  try{
   await api.post("/crm/tickets",{subject:form.subject.trim(),description:form.description.trim()||undefined,customerId:form.customerId||undefined,leadId:form.leadId||undefined,priority:form.priority,dueAt:form.dueAt?new Date(form.dueAt).toISOString():undefined})
   setOpen(false);setForm(blank);await load()
  }catch(e){setError(e&&typeof e==="object"&&"message" in e?String(e.message):"Could not create support ticket.")}
  finally{setSaving(false)}
 }
 async function update(ticket:Ticket,patch:Record<string,string|null>){
  setError(null)
  try{await api.patch("/crm/tickets/"+ticket.id,patch);await load()}
  catch(e){setError(e&&typeof e==="object"&&"message" in e?String(e.message):"Could not update ticket.")}
 }
 return <BaseLayout><div className="flex flex-col gap-6 px-4 lg:px-6">
  <PageHeader title="CRM support tickets" description="Track customer issues, priorities, ownership and resolution status." action={<Button onClick={()=>{setForm(blank);setOpen(true)}}><Plus className="size-4"/> New ticket</Button>}/>
  {error&&<div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"><AlertCircle className="size-4"/><span className="flex-1">{error}</span><Button size="sm" variant="ghost" onClick={()=>void load()}><RefreshCw className="size-4"/> Retry</Button></div>}
  <div className="grid gap-3 sm:grid-cols-4">{[{label:"All tickets",value:tickets.length},{label:"Open",value:tickets.filter(t=>t.status==="open"||t.status==="in_progress").length},{label:"Urgent",value:tickets.filter(t=>t.priority==="urgent"&&t.status!=="resolved"&&t.status!=="closed").length},{label:"Resolved",value:tickets.filter(t=>t.status==="resolved"||t.status==="closed").length}].map(m=><Card key={m.label}><CardContent className="p-4"><p className="text-sm text-muted-foreground">{m.label}</p><p className="mt-2 text-2xl font-semibold">{m.value}</p></CardContent></Card>)}</div>
  <Card><CardContent className="flex flex-col gap-4 p-4"><div className="flex flex-col gap-3 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/><Input className="pl-8" placeholder="Search ticket, customer or issue…" value={search} onChange={e=>setSearch(e.target.value)} aria-label="Search tickets"/></div><select aria-label="Filter tickets by status" value={status} onChange={e=>setStatus(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm"><option value="all">All statuses</option>{statuses.map(s=><option key={s} value={s}>{label(s)}</option>)}</select><select aria-label="Filter tickets by priority" value={priority} onChange={e=>setPriority(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm"><option value="all">All priorities</option>{priorities.map(p=><option key={p} value={p}>{label(p)}</option>)}</select></div>
  {loading?<div className="flex justify-center py-12"><LoadingSpinner/></div>:tickets.length===0?<div className="flex flex-col items-center gap-2 py-12 text-center"><Headset className="size-8 text-muted-foreground"/><p className="font-medium">No support tickets found</p><p className="text-sm text-muted-foreground">Create a ticket linked to a customer or lead to track resolution.</p><Button variant="outline" onClick={()=>setOpen(true)}><Plus className="size-4"/> Create ticket</Button></div>:<Table><TableHeader><TableRow><TableHead>Ticket</TableHead><TableHead className="hidden md:table-cell">Customer / lead</TableHead><TableHead>Priority</TableHead><TableHead>Status</TableHead><TableHead className="hidden lg:table-cell">Assigned to</TableHead><TableHead className="hidden sm:table-cell">Due</TableHead></TableRow></TableHeader><TableBody>{tickets.map(t=><TableRow key={t.id}><TableCell><div className="font-medium">#{t.ticket_number} · {t.subject}</div><div className="max-w-sm text-xs text-muted-foreground">{t.description||"No additional details"}</div></TableCell><TableCell className="hidden md:table-cell">{t.customer_name||t.lead_contact_name||"—"}</TableCell><TableCell><select aria-label={"Priority for ticket "+t.ticket_number} value={t.priority} onChange={e=>void update(t,{priority:e.target.value})} className={"rounded-md border border-input bg-background px-2 py-1.5 text-xs "+priorityClass(t.priority)}>{priorities.map(p=><option key={p} value={p}>{label(p)}</option>)}</select></TableCell><TableCell><select aria-label={"Status for ticket "+t.ticket_number} value={t.status} onChange={e=>void update(t,{status:e.target.value})} className="max-w-44 rounded-md border border-input bg-background px-2 py-1.5 text-xs">{statuses.map(s=><option key={s} value={s}>{label(s)}</option>)}</select></TableCell><TableCell className="hidden lg:table-cell"><select aria-label={"Assignee for ticket "+t.ticket_number} value={t.assigned_user_id||""} onChange={e=>void update(t,{assignedUserId:e.target.value||null})} className="max-w-48 rounded-md border border-input bg-background px-2 py-1.5 text-xs"><option value="">Unassigned</option>{assignees.map(a=><option key={a.user_id} value={a.user_id}>{a.full_name||a.email}</option>)}</select></TableCell><TableCell className="hidden sm:table-cell"><div className="flex items-center gap-2">{t.due_at?<>{formatDate(t.due_at)}<Button size="sm" variant="ghost" className="h-7 px-1.5 text-xs" title="Clear due date" onClick={()=>void update(t,{dueAt:null})}>Clear</Button></>:"—"}</div></TableCell></TableRow>)}</TableBody></Table>}{!loading&&hasMore&&<div className="flex justify-center border-t p-4"><Button variant="outline" onClick={()=>void loadMore()} disabled={loadingMore}>{loadingMore?"Loading…":"Load more tickets"}</Button></div>}
  </CardContent></Card>
 </div>
 <Dialog open={open} onOpenChange={setOpen}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>New support ticket</DialogTitle><DialogDescription>Record a customer issue and set priority and a target due date.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2">
  <Field label="Subject *" id="ticket-subject" wide><Input id="ticket-subject" value={form.subject} onChange={e=>setForm({...form,subject:e.target.value})}/></Field>
  <Field label="Customer" id="ticket-customer" wide><select id="ticket-customer" value={form.customerId} onChange={e=>setForm({...form,customerId:e.target.value,leadId:e.target.value?"":form.leadId})} className="h-9 rounded-md border border-input bg-background px-3 text-sm"><option value="">No customer selected</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
  <Field label="Or link to lead" id="ticket-lead" wide><select id="ticket-lead" value={form.leadId} onChange={e=>setForm({...form,leadId:e.target.value,customerId:e.target.value?"":form.customerId})} className="h-9 rounded-md border border-input bg-background px-3 text-sm"><option value="">No lead selected</option>{leads.map(l=><option key={l.id} value={l.id}>{l.contact_name}{l.organization_name?" — "+l.organization_name:""}</option>)}</select></Field>
  <Field label="Priority" id="ticket-priority"><select id="ticket-priority" value={form.priority} onChange={e=>setForm({...form,priority:e.target.value})} className="h-9 rounded-md border border-input bg-background px-3 text-sm">{priorities.map(p=><option key={p} value={p}>{label(p)}</option>)}</select></Field>
  <Field label="Due date & time" id="ticket-due"><Input id="ticket-due" type="datetime-local" value={form.dueAt} onChange={e=>setForm({...form,dueAt:e.target.value})}/></Field>
  <Field label="Description" id="ticket-description" wide><textarea id="ticket-description" rows={4} value={form.description} onChange={e=>setForm({...form,description:e.target.value})} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"/></Field>
 </div><DialogFooter><DialogClose render={<Button variant="outline">Cancel</Button>}/><Button onClick={()=>void save()} disabled={saving||!form.subject.trim()||(!form.customerId&&!form.leadId)}>{saving?"Saving…":"Create ticket"}</Button></DialogFooter></DialogContent></Dialog>
 </BaseLayout>
}
function Field({label,id,wide=false,children}:{label:string;id:string;wide?:boolean;children:React.ReactNode}){return <div className={"flex flex-col gap-1.5 "+(wide?"sm:col-span-2":"")}><Label htmlFor={id}>{label}</Label>{children}</div>}
