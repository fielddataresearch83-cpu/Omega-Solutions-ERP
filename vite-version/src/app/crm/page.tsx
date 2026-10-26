import * as React from "react"
import { Plus, Search, Users, AlertCircle, RefreshCw, Target, CalendarClock, CheckCircle2, Phone, Mail, CalendarDays, ClipboardCheck, UserCheck, Pencil } from "lucide-react"
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
import { formatKES, formatDate } from "@/lib/format"

type Customer = { id:string; name:string; email:string|null; phone:string|null }
type Lead = { id:string; contact_name:string; organization_name:string|null; email:string|null; phone:string|null; source:string|null; status:"new"|"qualified"|"unqualified"|"converted"; estimated_value:number|string; currency:string; notes:string|null; created_at:string }
type Opportunity = { id:string; title:string; stage:"qualification"|"needs_analysis"|"proposal"|"negotiation"|"won"|"lost"; expected_value:number|string; probability:number; weighted_value:number|string; expected_close_date:string|null; loss_reason:string|null; lead_id:string|null; customer_id:string|null; lead_contact_name:string|null; customer_name:string|null; created_at:string }
type Activity = { id:string; activity_type:"call"|"email"|"meeting"|"task"|"note"; subject:string; description:string|null; due_at:string|null; completed_at:string|null; lead_id:string|null; opportunity_id:string|null; lead_contact_name:string|null; opportunity_title:string|null; customer_name:string|null; created_at:string }
type Pipeline = { leads:Array<{status:string;count:number;value:string|number}>; opportunities:Array<{stage:string;count:number;value:string|number;weighted_value:string|number}>; activities?:{pending:number;overdue:number}; currency:string }
type Tab = "leads"|"opportunities"|"activities"
const blankLead = {contactName:"",organizationName:"",email:"",phone:"",source:"",estimatedValue:"0",notes:""}
const blankOpportunity = {title:"",leadId:"",expectedValue:"0",probability:"25",stage:"qualification",expectedCloseDate:"",lossReason:""}
const blankActivity = {activityType:"task",subject:"",description:"",leadId:"",opportunityId:"",customerId:"",dueAt:""}
const stages = ["qualification","needs_analysis","proposal","negotiation","won","lost"] as const
const stageLabel = (value:string) => value.replaceAll("_"," ").replace(/\b\w/g, x=>x.toUpperCase())
const statusClass = (value:string) => value==="qualified"||value==="won" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" : value==="lost"||value==="unqualified" ? "bg-muted text-muted-foreground" : value==="converted" ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
const badge = (value:string) => <span className={"inline-flex rounded-full px-2.5 py-1 text-xs font-medium "+statusClass(value)}>{stageLabel(value)}</span>

export default function CrmPage() {
 const [tab,setTab]=React.useState<Tab>("leads")
 const [leads,setLeads]=React.useState<Lead[]>([])
 const [customers,setCustomers]=React.useState<Customer[]>([])
 const [opportunities,setOpportunities]=React.useState<Opportunity[]>([])
 const [activities,setActivities]=React.useState<Activity[]>([])
 const [pipeline,setPipeline]=React.useState<Pipeline|null>(null)
 const [loading,setLoading]=React.useState(true)
 const [saving,setSaving]=React.useState(false)
 const [error,setError]=React.useState<string|null>(null)
 const [search,setSearch]=React.useState("")
 const [leadStatus,setLeadStatus]=React.useState("all")
 const [opportunityStage,setOpportunityStage]=React.useState("all")
 const [activityPending,setActivityPending]=React.useState(true)
 const [leadDialog,setLeadDialog]=React.useState(false)
 const [editingLeadId,setEditingLeadId]=React.useState<string|null>(null)
 const [opportunityDialog,setOpportunityDialog]=React.useState(false)
 const [editingOpportunityId,setEditingOpportunityId]=React.useState<string|null>(null)
 const [activityDialog,setActivityDialog]=React.useState(false)
 const [leadForm,setLeadForm]=React.useState(blankLead)
 const [opportunityForm,setOpportunityForm]=React.useState(blankOpportunity)
 const [activityForm,setActivityForm]=React.useState(blankActivity)

 const load=React.useCallback(async()=>{
  setLoading(true);setError(null)
  try {
   const leadParams=new URLSearchParams();if(search.trim())leadParams.set("search",search.trim());if(leadStatus!=="all")leadParams.set("status",leadStatus)
   const oppParams=new URLSearchParams();if(search.trim())oppParams.set("search",search.trim());if(opportunityStage!=="all")oppParams.set("stage",opportunityStage)
   const results=await Promise.all([
    api.get<Lead[]>("/crm/leads"+(tab==="leads"&&leadParams.size?"?"+leadParams.toString():"")),
    api.get<Customer[]>("/crm/customers"),
    api.get<Opportunity[]>("/crm/opportunities"+(tab==="opportunities"&&oppParams.size?"?"+oppParams.toString():"")),
    api.get<Activity[]>("/crm/activities?pending="+(activityPending?"true":"false")),
    api.get<Pipeline>("/crm/pipeline")
   ])
   setLeads(results[0]);setCustomers(results[1]);setOpportunities(results[2]);setActivities(results[3]);setPipeline(results[4])
  } catch(e) {setError(e&&typeof e==="object"&&"message" in e?String(e.message):"Could not load CRM data.")}
  finally {setLoading(false)}
 },[search,tab,leadStatus,opportunityStage,activityPending])
 React.useEffect(()=>{void load()},[load])

 const leadCount=pipeline?.leads.reduce((s,x)=>s+Number(x.count),0)??leads.length
 const leadValue=pipeline?.leads.reduce((s,x)=>s+Number(x.value),0)??0
 const qualifiedCount=pipeline?.leads.filter(x=>x.status==="qualified").reduce((s,x)=>s+Number(x.count),0)??0
 const weightedValue=pipeline?.opportunities.reduce((s,x)=>s+Number(x.weighted_value),0)??0

 async function saveLead(){
  if(!leadForm.contactName.trim()){setError("Contact name is required.");return}
  setSaving(true);setError(null)
  try {
   await api.post<Lead>("/crm/leads",{contactName:leadForm.contactName.trim(),organizationName:leadForm.organizationName.trim()||undefined,email:leadForm.email.trim()||undefined,phone:leadForm.phone.trim()||undefined,source:leadForm.source.trim()||undefined,estimatedValue:Math.max(0,Number(leadForm.estimatedValue)||0),currency:"KES",notes:leadForm.notes.trim()||undefined})
   setLeadDialog(false);setLeadForm(blankLead);await load()
  } catch(e){setError(e&&typeof e==="object"&&"message" in e?String(e.message):"Could not save lead.")} finally{setSaving(false)}
 }
 async function saveOpportunity(){
  if(!opportunityForm.title.trim()||(!editingOpportunityId&&!opportunityForm.leadId)){setError("Opportunity title and linked lead are required.");return}
  setSaving(true);setError(null)
  try {
   const payload={title:opportunityForm.title.trim(),expectedValue:Math.max(0,Number(opportunityForm.expectedValue)||0),probability:Math.min(100,Math.max(0,Number(opportunityForm.probability)||0)),stage:opportunityForm.stage,expectedCloseDate:opportunityForm.expectedCloseDate||undefined,lossReason:opportunityForm.lossReason.trim()||undefined}
   if(editingOpportunityId) await api.patch<Opportunity>("/crm/opportunities/"+editingOpportunityId,payload); else await api.post<Opportunity>("/crm/opportunities",{...payload,leadId:opportunityForm.leadId})
   setOpportunityDialog(false);setEditingOpportunityId(null);setOpportunityForm(blankOpportunity);setTab("opportunities");await load()
  } catch(e){setError(e&&typeof e==="object"&&"message" in e?String(e.message):"Could not save opportunity.")} finally{setSaving(false)}
 }
 async function saveActivity(){
  if(!activityForm.subject.trim()||(!activityForm.leadId&&!activityForm.opportunityId&&!activityForm.customerId)){setError("Activity subject and linked lead or opportunity are required.");return}
  setSaving(true);setError(null)
  try {
   await api.post<Activity>("/crm/activities",{activityType:activityForm.activityType,subject:activityForm.subject.trim(),description:activityForm.description.trim()||undefined,leadId:activityForm.leadId||undefined,opportunityId:activityForm.opportunityId||undefined,customerId:activityForm.customerId||undefined,dueAt:activityForm.dueAt?new Date(activityForm.dueAt).toISOString():undefined})
   setActivityDialog(false);setActivityForm(blankActivity);setTab("activities");await load()
  } catch(e){setError(e&&typeof e==="object"&&"message" in e?String(e.message):"Could not save activity.")} finally{setSaving(false)}
 }
 function editLead(lead:Lead){setEditingLeadId(lead.id);setLeadForm({contactName:lead.contact_name,organizationName:lead.organization_name||"",email:lead.email||"",phone:lead.phone||"",source:lead.source||"",estimatedValue:String(lead.estimated_value||0),notes:lead.notes||""});setLeadDialog(true)}
 async function updateLeadStatus(lead:Lead,status:string){
  try{await api.patch<Lead>("/crm/leads/"+lead.id,{status});await load()}
  catch(e){setError(e&&typeof e==="object"&&"message" in e?String(e.message):"Could not update lead status.")}
 }
 async function convertLead(lead:Lead){
  setError(null)
  try{await api.post("/crm/leads/"+lead.id+"/convert");await load()}
  catch(e){setError(e&&typeof e==="object"&&"message" in e?String(e.message):"Could not convert lead to customer.")}
 }
 function editOpportunity(o:Opportunity){setEditingOpportunityId(o.id);setOpportunityForm({title:o.title,leadId:o.lead_id||"",expectedValue:String(o.expected_value||0),probability:String(o.probability??0),stage:o.stage,expectedCloseDate:String(o.expected_close_date||"").slice(0,10),lossReason:o.loss_reason||""});setOpportunityDialog(true)}
 async function updateStage(o:Opportunity,stage:string){
  setError(null)
  const defaultProbability:Record<string,number>={qualification:10,needs_analysis:25,proposal:50,negotiation:75,won:100,lost:0}
  try{await api.patch<Opportunity>("/crm/opportunities/"+o.id,{stage,probability:defaultProbability[stage]??o.probability});await load()}
  catch(e){setError(e&&typeof e==="object"&&"message" in e?String(e.message):"Could not update stage.")}
 }
 async function completeActivity(a:Activity,completed:boolean){
  try{await api.patch<Activity>("/crm/activities/"+a.id,{completed});await load()}
  catch(e){setError(e&&typeof e==="object"&&"message" in e?String(e.message):"Could not update activity.")}
 }

 const action=tab==="leads"?<Button onClick={()=>{setEditingLeadId(null);setLeadForm(blankLead);setLeadDialog(true)}}><Plus className="size-4"/> Add lead</Button>:tab==="opportunities"?<Button onClick={()=>{setEditingOpportunityId(null);setOpportunityForm(blankOpportunity);setOpportunityDialog(true)}}><Plus className="size-4"/> Add opportunity</Button>:<Button onClick={()=>{setActivityForm(blankActivity);setActivityDialog(true)}}><Plus className="size-4"/> Schedule activity</Button>

 return <BaseLayout><div className="mx-auto flex w-full min-w-0 max-w-[1600px] flex-col gap-5 px-4 py-1 lg:px-6">
  <PageHeader title="Customer relationship management" description="Manage prospects, opportunities, sales follow-ups and customer engagement." action={action}/>
  {error&&<div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0"/><span className="flex-1">{error}</span><Button size="sm" variant="ghost" onClick={()=>void load()}><RefreshCw className="size-3.5"/> Retry</Button></div>}
  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
   {label:"Total leads",value:String(leadCount),hint:"Across all statuses"},
   {label:"Qualified leads",value:String(qualifiedCount),hint:"Ready for follow-up"},
   {label:"Estimated lead value",value:formatKES(leadValue),hint:"Potential sales"},
   {label:"Weighted pipeline",value:formatKES(weightedValue),hint:"Probability-adjusted opportunities"}
  ].map(m=><Card key={m.label}><CardContent className="p-4"><p className="text-sm text-muted-foreground">{m.label}</p><p className="mt-2 text-2xl font-semibold tracking-tight">{m.value}</p><p className="mt-1 text-xs text-muted-foreground">{m.hint}</p></CardContent></Card>)}</div>
  <div className="flex flex-wrap gap-2 border-b pb-3">{([{id:"leads",label:"Leads",icon:Users},{id:"opportunities",label:"Opportunities",icon:Target},{id:"activities",label:"Activities & follow-ups",icon:CalendarClock}] as const).map(item=><Button key={item.id} size="sm" variant={tab===item.id?"default":"outline"} onClick={()=>setTab(item.id)}><item.icon className="size-4"/>{item.label}</Button>)}</div>
  <Card className="min-w-0 overflow-hidden"><CardContent className="flex min-w-0 flex-col gap-4 p-3 sm:p-4">
   <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">{tab!=="activities"&&<div className="relative flex-1"><Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/><Input className="pl-8" placeholder={tab==="leads"?"Search contacts, companies, email or phone…":"Search opportunities or contacts…"} value={search} onChange={e=>setSearch(e.target.value)} aria-label="Search CRM"/></div>}
    {tab==="leads"&&<select aria-label="Filter leads by status" value={leadStatus} onChange={e=>setLeadStatus(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm sm:w-48"><option value="all">All statuses</option><option value="new">New</option><option value="qualified">Qualified</option><option value="unqualified">Unqualified</option><option value="converted">Converted</option></select>}
    {tab==="opportunities"&&<select aria-label="Filter opportunities by stage" value={opportunityStage} onChange={e=>setOpportunityStage(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm sm:w-56"><option value="all">All stages</option>{stages.map(s=><option key={s} value={s}>{stageLabel(s)}</option>)}</select>}
    {tab==="activities"&&<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={activityPending} onChange={e=>setActivityPending(e.target.checked)}/> Pending only</label>}
   </div>
   {loading?<div className="flex justify-center py-12"><LoadingSpinner/></div>:tab==="leads"?(
    leads.length===0?<Empty icon={<Users className="size-6"/>} title="No leads found" description="Add a prospect to start tracking your pipeline." action={()=>{setLeadForm(blankLead);setLeadDialog(true)}}/>:
    <div className="w-full min-w-0 overflow-x-auto rounded-lg border"><Table className="w-full min-w-[760px] table-fixed"><TableHeader><TableRow><TableHead className="w-[19%]">Contact</TableHead><TableHead className="hidden w-[16%] md:table-cell">Organization</TableHead><TableHead className="hidden w-[22%] lg:table-cell">Email / phone</TableHead><TableHead className="w-[14%]">Status</TableHead><TableHead className="w-[13%] text-right">Est. value</TableHead><TableHead className="hidden w-[10%] sm:table-cell">Created</TableHead><TableHead className="w-[16%] text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{leads.map(l=><TableRow key={l.id}><TableCell><div className="truncate font-medium" title={l.contact_name}>{l.contact_name}</div><div className="mt-1 text-xs text-muted-foreground md:hidden">{l.organization_name||"Independent contact"}</div></TableCell><TableCell className="hidden md:table-cell">{l.organization_name||"—"}</TableCell><TableCell className="hidden lg:table-cell"><div className="truncate" title={l.email||""}>{l.email||"—"}</div><div className="truncate text-xs text-muted-foreground" title={l.phone||""}>{l.phone||""}</div></TableCell><TableCell>{badge(l.status)}<select aria-label={"Change status for "+l.contact_name} value={l.status} onChange={e=>void updateLeadStatus(l,e.target.value)} className="mt-1 w-full max-w-32 rounded-md border border-input bg-background px-2 py-1 text-xs">{["new","qualified","unqualified"].map(s=><option key={s} value={s}>{stageLabel(s)}</option>)}{l.status==="converted"&&<option value="converted">Converted</option>}</select></TableCell><TableCell className="text-right font-medium tabular-nums">{formatKES(Number(l.estimated_value))}</TableCell><TableCell className="hidden sm:table-cell text-muted-foreground">{formatDate(l.created_at)}</TableCell><TableCell><div className="flex flex-nowrap justify-end gap-1"><Button size="icon" className="size-8 shrink-0" variant="outline" title="Edit lead" aria-label={"Edit lead "+l.contact_name} onClick={()=>editLead(l)}><Pencil className="size-3.5"/></Button>{l.status==="converted"?<span className="self-center whitespace-nowrap text-xs text-muted-foreground">Customer</span>:<Button size="icon" className="size-8 shrink-0" variant="outline" title="Convert to customer" aria-label={"Convert "+l.contact_name+" to customer"} onClick={()=>void convertLead(l)}><UserCheck className="size-3.5"/></Button>}</div></TableCell></TableRow>)}</TableBody></Table></div>
   ):tab==="opportunities"?(
    opportunities.length===0?<Empty icon={<Target className="size-6"/>} title="No opportunities yet" description="Turn a lead into a tracked sales opportunity." action={()=>{setOpportunityForm(blankOpportunity);setOpportunityDialog(true)}}/>:
    <Table><TableHeader><TableRow><TableHead>Opportunity</TableHead><TableHead className="hidden md:table-cell">Contact</TableHead><TableHead>Stage</TableHead><TableHead className="text-right">Value</TableHead><TableHead className="hidden lg:table-cell">Weighted</TableHead><TableHead className="hidden sm:table-cell">Expected close</TableHead></TableRow></TableHeader><TableBody>{opportunities.map(o=><TableRow key={o.id}><TableCell><div className="font-medium">{o.title}</div><div className="text-xs text-muted-foreground">{o.probability}% probability</div><Button size="sm" variant="ghost" className="mt-1 h-7 px-2" onClick={()=>editOpportunity(o)}><Pencil className="size-3.5"/> Edit deal</Button></TableCell><TableCell className="hidden md:table-cell">{o.lead_contact_name||o.customer_name||"—"}</TableCell><TableCell><select aria-label={"Stage for "+o.title} value={o.stage} onChange={e=>void updateStage(o,e.target.value)} className="max-w-40 rounded-md border border-input bg-background px-2 py-1.5 text-xs">{stages.map(s=><option key={s} value={s}>{stageLabel(s)}</option>)}</select></TableCell><TableCell className="text-right tabular-nums">{formatKES(Number(o.expected_value))}</TableCell><TableCell className="hidden lg:table-cell text-right tabular-nums">{formatKES(Number(o.weighted_value||0))}</TableCell><TableCell className="hidden sm:table-cell">{o.expected_close_date?formatDate(o.expected_close_date):"—"}</TableCell></TableRow>)}</TableBody></Table>
   ):activities.length===0?<Empty icon={<CalendarClock className="size-6"/>} title={activityPending?"No pending follow-ups":"No activities found"} description="Schedule a call, email, meeting or task against a lead or opportunity." action={()=>{setActivityForm(blankActivity);setActivityDialog(true)}}/>:
    <Table><TableHeader><TableRow><TableHead>Activity</TableHead><TableHead className="hidden md:table-cell">Linked record</TableHead><TableHead>Due</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{activities.map(a=><TableRow key={a.id}><TableCell><div className="flex items-start gap-2"><ActivityIcon type={a.activity_type}/><div><div className="font-medium">{a.subject}</div><div className="text-xs text-muted-foreground capitalize">{a.activity_type}{a.description?" · "+a.description:""}</div></div></div></TableCell><TableCell className="hidden md:table-cell">{a.lead_contact_name||a.opportunity_title||a.customer_name||"—"}</TableCell><TableCell>{a.due_at?formatDate(a.due_at):"—"}</TableCell><TableCell>{a.completed_at?<span className="text-xs text-muted-foreground">Completed</span>:<span className="text-xs font-medium text-amber-700 dark:text-amber-300">Pending</span>}</TableCell><TableCell className="text-right">{a.completed_at?<Button size="sm" variant="outline" onClick={()=>void completeActivity(a,false)}>Reopen</Button>:<Button size="sm" variant="outline" onClick={()=>void completeActivity(a,true)}><CheckCircle2 className="size-3.5"/> Complete</Button>}</TableCell></TableRow>)}</TableBody></Table>}
  </CardContent></Card>
 </div>

 <Dialog open={leadDialog} onOpenChange={open=>{setLeadDialog(open);if(!open)setEditingLeadId(null)}}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>{editingLeadId?"Edit CRM lead":"Add CRM lead"}</DialogTitle><DialogDescription>Record a prospect in your company CRM. Amounts use Kenyan shillings (KES).</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2">
  <Field label="Contact name *" id="crm-contact"><Input id="crm-contact" value={leadForm.contactName} onChange={e=>setLeadForm({...leadForm,contactName:e.target.value})}/></Field>
  <Field label="Organization" id="crm-org"><Input id="crm-org" value={leadForm.organizationName} onChange={e=>setLeadForm({...leadForm,organizationName:e.target.value})}/></Field>
  <Field label="Email" id="crm-email"><Input id="crm-email" type="email" value={leadForm.email} onChange={e=>setLeadForm({...leadForm,email:e.target.value})}/></Field>
  <Field label="Phone" id="crm-phone"><Input id="crm-phone" value={leadForm.phone} onChange={e=>setLeadForm({...leadForm,phone:e.target.value})}/></Field>
  <Field label="Source" id="crm-source"><Input id="crm-source" placeholder="Referral, website…" value={leadForm.source} onChange={e=>setLeadForm({...leadForm,source:e.target.value})}/></Field>
  <Field label="Estimated value (KSh)" id="crm-value"><Input id="crm-value" type="number" min="0" value={leadForm.estimatedValue} onChange={e=>setLeadForm({...leadForm,estimatedValue:e.target.value})}/></Field>
  <Field label="Notes" id="crm-notes" wide><textarea id="crm-notes" rows={3} value={leadForm.notes} onChange={e=>setLeadForm({...leadForm,notes:e.target.value})} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"/></Field>
 </div><DialogFooter><DialogClose render={<Button variant="outline">Cancel</Button>}/><Button onClick={()=>void saveLead()} disabled={saving||!leadForm.contactName.trim()}>{saving?"Saving…":editingLeadId?"Save changes":"Save lead"}</Button></DialogFooter></DialogContent></Dialog>

 <Dialog open={opportunityDialog} onOpenChange={open=>{setOpportunityDialog(open);if(!open)setEditingOpportunityId(null)}}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>{editingOpportunityId?"Edit sales opportunity":"Add sales opportunity"}</DialogTitle><DialogDescription>Track a potential deal through sales stages and weighted forecasts.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2">
  <Field label="Opportunity title *" id="opp-title" wide><Input id="opp-title" value={opportunityForm.title} onChange={e=>setOpportunityForm({...opportunityForm,title:e.target.value})}/></Field>
  <Field label="Linked lead *" id="opp-lead" wide><select id="opp-lead" value={opportunityForm.leadId} onChange={e=>setOpportunityForm({...opportunityForm,leadId:e.target.value})} className="h-9 rounded-md border border-input bg-background px-3 text-sm"><option value="">Choose a lead</option>{leads.map(l=><option key={l.id} value={l.id}>{l.contact_name}{l.organization_name?" — "+l.organization_name:""}</option>)}</select></Field>
  <Field label="Expected value (KSh)" id="opp-value"><Input id="opp-value" type="number" min="0" value={opportunityForm.expectedValue} onChange={e=>setOpportunityForm({...opportunityForm,expectedValue:e.target.value})}/></Field>
  <Field label="Probability (%)" id="opp-prob"><Input id="opp-prob" type="number" min="0" max="100" value={opportunityForm.probability} onChange={e=>setOpportunityForm({...opportunityForm,probability:e.target.value})}/></Field>
  <Field label="Stage" id="opp-stage"><select id="opp-stage" value={opportunityForm.stage} onChange={e=>setOpportunityForm({...opportunityForm,stage:e.target.value})} className="h-9 rounded-md border border-input bg-background px-3 text-sm">{stages.map(s=><option key={s} value={s}>{stageLabel(s)}</option>)}</select></Field>
  <Field label="Expected close date" id="opp-date"><Input id="opp-date" type="date" value={opportunityForm.expectedCloseDate} onChange={e=>setOpportunityForm({...opportunityForm,expectedCloseDate:e.target.value})}/></Field>
  {opportunityForm.stage==="lost"&&<Field label="Reason lost" id="opp-reason" wide><Input id="opp-reason" value={opportunityForm.lossReason} onChange={e=>setOpportunityForm({...opportunityForm,lossReason:e.target.value})}/></Field>}
 </div><DialogFooter><DialogClose render={<Button variant="outline">Cancel</Button>}/><Button onClick={()=>void saveOpportunity()} disabled={saving||!opportunityForm.title.trim()||(!editingOpportunityId&&!opportunityForm.leadId)}>{saving?"Saving…":editingOpportunityId?"Save changes":"Save opportunity"}</Button></DialogFooter></DialogContent></Dialog>

 <Dialog open={activityDialog} onOpenChange={setActivityDialog}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Schedule follow-up</DialogTitle><DialogDescription>Log a call, email, meeting, task or note against a lead or opportunity.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2">
  <Field label="Activity type" id="activity-type"><select id="activity-type" value={activityForm.activityType} onChange={e=>setActivityForm({...activityForm,activityType:e.target.value})} className="h-9 rounded-md border border-input bg-background px-3 text-sm">{["call","email","meeting","task","note"].map(t=><option key={t} value={t}>{stageLabel(t)}</option>)}</select></Field>
  <Field label="Due date & time" id="activity-due"><Input id="activity-due" type="datetime-local" value={activityForm.dueAt} onChange={e=>setActivityForm({...activityForm,dueAt:e.target.value})}/></Field>
  <Field label="Subject *" id="activity-subject" wide><Input id="activity-subject" value={activityForm.subject} onChange={e=>setActivityForm({...activityForm,subject:e.target.value})}/></Field>
  <Field label="Link to lead" id="activity-lead" wide><select id="activity-lead" value={activityForm.leadId} onChange={e=>setActivityForm({...activityForm,leadId:e.target.value,opportunityId:e.target.value?"":activityForm.opportunityId,customerId:e.target.value?"":activityForm.customerId})} className="h-9 rounded-md border border-input bg-background px-3 text-sm"><option value="">No lead selected</option>{leads.map(l=><option key={l.id} value={l.id}>{l.contact_name}{l.organization_name?" — "+l.organization_name:""}</option>)}</select></Field>
  <Field label="Or link to opportunity" id="activity-opportunity" wide><select id="activity-opportunity" value={activityForm.opportunityId} onChange={e=>setActivityForm({...activityForm,opportunityId:e.target.value,leadId:e.target.value?"":activityForm.leadId,customerId:e.target.value?"":activityForm.customerId})} className="h-9 rounded-md border border-input bg-background px-3 text-sm"><option value="">No opportunity selected</option>{opportunities.map(o=><option key={o.id} value={o.id}>{o.title}</option>)}</select></Field>
  <Field label="Or link to customer" id="activity-customer" wide><select id="activity-customer" value={activityForm.customerId} onChange={e=>setActivityForm({...activityForm,customerId:e.target.value,leadId:e.target.value?"":activityForm.leadId,opportunityId:e.target.value?"":activityForm.opportunityId})} className="h-9 rounded-md border border-input bg-background px-3 text-sm"><option value="">No customer selected</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
  <Field label="Description / notes" id="activity-description" wide><textarea id="activity-description" rows={3} value={activityForm.description} onChange={e=>setActivityForm({...activityForm,description:e.target.value})} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"/></Field>
 </div><DialogFooter><DialogClose render={<Button variant="outline">Cancel</Button>}/><Button onClick={()=>void saveActivity()} disabled={saving||!activityForm.subject.trim()||(!activityForm.leadId&&!activityForm.opportunityId&&!activityForm.customerId)}>{saving?"Saving…":"Schedule activity"}</Button></DialogFooter></DialogContent></Dialog>
 </BaseLayout>
}

function Field({label,id,wide=false,children}:{label:string;id:string;wide?:boolean;children:React.ReactNode}) {
 return <div className={"flex flex-col gap-1.5 "+(wide?"sm:col-span-2":"")}><Label htmlFor={id}>{label}</Label>{children}</div>
}
function Empty({icon,title,description,action}:{icon:React.ReactNode;title:string;description:string;action:()=>void}) {
 return <div className="flex flex-col items-center gap-2 py-12 text-center"><div className="rounded-full bg-muted p-3 text-muted-foreground">{icon}</div><p className="font-medium">{title}</p><p className="max-w-sm text-sm text-muted-foreground">{description}</p><Button variant="outline" onClick={action}><Plus className="size-4"/> Add new</Button></div>
}
function ActivityIcon({type}:{type:Activity["activity_type"]}) {
 const cls="mt-0.5 size-4 shrink-0 text-muted-foreground"
 if(type==="call")return <Phone className={cls}/>
 if(type==="email")return <Mail className={cls}/>
 if(type==="meeting")return <CalendarDays className={cls}/>
 if(type==="task")return <ClipboardCheck className={cls}/>
 return <Users className={cls}/>
}
