import * as React from "react"
import { Plus, Megaphone, RefreshCw, AlertCircle, Users } from "lucide-react"
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

type Campaign={id:string;name:string;campaign_type:string;status:string;start_date:string|null;end_date:string|null;budget:number|string;actual_cost:number|string;target_leads:number;notes:string|null;leads_count:number;responses_count:number;segments_count:number}
type Lead={id:string;contact_name:string;organization_name:string|null}
type Segment={id:string;name:string;is_dynamic:boolean}
type CampaignLead={lead_id:string;response_status:string;contact_name:string;organization_name:string|null;email:string|null;phone:string|null;added_at:string}
const blank={name:"",campaignType:"other",status:"planned",startDate:"",endDate:"",budget:"0",targetLeads:"0",notes:""}
const statuses=["planned","active","paused","completed","cancelled"]
const label=(s:string)=>s.replaceAll("_"," ").replace(/\b\w/g,x=>x.toUpperCase())

export default function CrmCampaignsPage(){
 const [campaigns,setCampaigns]=React.useState<Campaign[]>([])
 const [hasMore,setHasMore]=React.useState(false)
 const [loadingMore,setLoadingMore]=React.useState(false)
 const [leads,setLeads]=React.useState<Lead[]>([])
 const [segments,setSegments]=React.useState<Segment[]>([])
 const [segmentSelection,setSegmentSelection]=React.useState<Record<string,string>>({})
 const [audienceOpen,setAudienceOpen]=React.useState(false)
 const [audienceCampaign,setAudienceCampaign]=React.useState<Campaign|null>(null)
 const [campaignLeads,setCampaignLeads]=React.useState<CampaignLead[]>([])
 const [selection,setSelection]=React.useState<Record<string,string>>({})
 const [form,setForm]=React.useState(blank)
 const [open,setOpen]=React.useState(false)
 const [loading,setLoading]=React.useState(true)
 const [saving,setSaving]=React.useState(false)
 const [error,setError]=React.useState<string|null>(null)
 const load=React.useCallback(async()=>{
  setLoading(true);setError(null)
  try{const result=await Promise.all([api.get<Campaign[]>("/crm/campaigns?limit=100&offset=0"),api.get<Lead[]>("/crm/leads"),api.get<Segment[]>("/crm/segments")]);setCampaigns(result[0]);setHasMore(result[0].length===100);setLeads(result[1]);setSegments(result[2])}
  catch(e){setError(e&&typeof e==="object"&&"message" in e?String(e.message):"Could not load campaigns.")}
  finally{setLoading(false)}
 },[])
 React.useEffect(()=>{void Promise.resolve().then(load)},[load])

 async function loadMore(){
  if(loadingMore||!hasMore)return
  setLoadingMore(true);setError(null)
  try{const next=await api.get<Campaign[]>("/crm/campaigns?limit=100&offset="+campaigns.length);setCampaigns(current=>[...current,...next]);setHasMore(next.length===100)}
  catch(e){setError(e&&typeof e==="object"&&"message" in e?String(e.message):"Could not load more campaigns.")}
  finally{setLoadingMore(false)}
 }
 async function save(){
  if(!form.name.trim()){setError("Campaign name is required.");return}
  setSaving(true);setError(null)
  try{await api.post("/crm/campaigns",{name:form.name.trim(),campaignType:form.campaignType,status:form.status,startDate:form.startDate||undefined,endDate:form.endDate||undefined,budget:Number(form.budget)||0,targetLeads:Number(form.targetLeads)||0,notes:form.notes.trim()||undefined});setOpen(false);setForm(blank);await load()}
  catch(e){setError(e&&typeof e==="object"&&"message" in e?String(e.message):"Could not save campaign.")}
  finally{setSaving(false)}
 }
 async function viewAudience(c:Campaign){setAudienceCampaign(c);setAudienceOpen(true);try{setCampaignLeads(await api.get<CampaignLead[]>("/crm/campaigns/"+c.id+"/leads"))}catch(e){setError(e&&typeof e==="object"&&"message" in e?String(e.message):"Could not load campaign audience.")}}
 async function updateResponse(lead:CampaignLead,responseStatus:string){if(!audienceCampaign)return;try{await api.patch("/crm/campaigns/"+audienceCampaign.id+"/leads/"+lead.lead_id,{responseStatus});setCampaignLeads(campaignLeads.map(x=>x.lead_id===lead.lead_id?{...x,response_status:responseStatus}:x));await load()}catch(e){setError(e&&typeof e==="object"&&"message" in e?String(e.message):"Could not update campaign response.")}}
 async function addSegment(c:Campaign){const segmentId=segmentSelection[c.id];if(!segmentId){setError("Select a segment to attach to this campaign.");return}try{await api.post("/crm/campaigns/"+c.id+"/segments",{segmentId});setSegmentSelection({...segmentSelection,[c.id]:""});await load()}catch(e){setError(e&&typeof e==="object"&&"message" in e?String(e.message):"Could not attach segment.")}}
 async function changeStatus(c:Campaign,status:string){
  try{await api.patch("/crm/campaigns/"+c.id,{status});await load()}
  catch(e){setError(e&&typeof e==="object"&&"message" in e?String(e.message):"Could not update campaign.")}
 }
 async function addLead(c:Campaign){
  const leadId=selection[c.id]
  if(!leadId){setError("Select a lead to add to the campaign.");return}
  try{await api.post("/crm/campaigns/"+c.id+"/leads",{leadId});setSelection({...selection,[c.id]:""});await load()}
  catch(e){setError(e&&typeof e==="object"&&"message" in e?String(e.message):"Could not add lead to campaign.")}
 }
 return <BaseLayout><div className="flex flex-col gap-6 px-4 lg:px-6">
  <PageHeader title="CRM campaigns" description="Plan outreach, manage target audiences and track campaign responses." action={<Button onClick={()=>{setForm(blank);setOpen(true)}}><Plus className="size-4"/> New campaign</Button>}/>
  {error&&<div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"><AlertCircle className="size-4"/><span className="flex-1">{error}</span><Button size="sm" variant="ghost" onClick={()=>void load()}><RefreshCw className="size-4"/> Retry</Button></div>}
  <div className="grid gap-3 sm:grid-cols-3">{[{label:"Campaigns",value:campaigns.length},{label:"Active",value:campaigns.filter(c=>c.status==="active").length},{label:"Leads targeted",value:campaigns.reduce((s,c)=>s+Number(c.leads_count),0)}].map(m=><Card key={m.label}><CardContent className="p-4"><p className="text-sm text-muted-foreground">{m.label}</p><p className="mt-2 text-2xl font-semibold">{m.value}</p></CardContent></Card>)}</div>
  <Card><CardContent className="p-4">{loading?<div className="flex justify-center py-12"><LoadingSpinner/></div>:campaigns.length===0?<div className="flex flex-col items-center gap-2 py-12 text-center"><Megaphone className="size-8 text-muted-foreground"/><p className="font-medium">No campaigns yet</p><p className="text-sm text-muted-foreground">Create a campaign and add leads to start tracking outreach.</p><Button variant="outline" onClick={()=>setOpen(true)}><Plus className="size-4"/> Create campaign</Button></div>:<Table><TableHeader><TableRow><TableHead>Campaign</TableHead><TableHead>Status</TableHead><TableHead className="hidden md:table-cell">Dates</TableHead><TableHead className="text-right">Budget</TableHead><TableHead>Audience</TableHead></TableRow></TableHeader><TableBody>{campaigns.map(c=><TableRow key={c.id}><TableCell><div className="font-medium">{c.name}</div><div className="text-xs text-muted-foreground">{label(c.campaign_type)} · {Number(c.responses_count)} responses</div><div className="mt-2 flex flex-wrap items-center gap-2"><select aria-label={"Select lead for "+c.name} value={selection[c.id]||""} onChange={e=>setSelection({...selection,[c.id]:e.target.value})} className="h-8 max-w-52 rounded-md border border-input bg-background px-2 text-xs"><option value="">Add lead…</option>{leads.map(l=><option key={l.id} value={l.id}>{l.contact_name}{l.organization_name?" — "+l.organization_name:""}</option>)}</select><Button size="sm" variant="outline" onClick={()=>void addLead(c)} disabled={!selection[c.id]}><Users className="size-3.5"/> Add lead</Button><select aria-label={"Select segment for "+c.name} value={segmentSelection[c.id]||""} onChange={e=>setSegmentSelection({...segmentSelection,[c.id]:e.target.value})} className="h-8 max-w-44 rounded-md border border-input bg-background px-2 text-xs"><option value="">Attach segment…</option>{segments.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select><Button size="sm" variant="outline" onClick={()=>void addSegment(c)} disabled={!segmentSelection[c.id]}>Attach</Button><Button size="sm" variant="ghost" onClick={()=>void viewAudience(c)}>View audience</Button></div></TableCell><TableCell><select aria-label={"Status for "+c.name} value={c.status} onChange={e=>void changeStatus(c,e.target.value)} className="rounded-md border border-input bg-background px-2 py-1.5 text-xs">{statuses.map(s=><option key={s} value={s}>{label(s)}</option>)}</select></TableCell><TableCell className="hidden md:table-cell text-sm">{c.start_date?formatDate(c.start_date):"—"}{c.end_date?" – "+formatDate(c.end_date):""}</TableCell><TableCell className="text-right tabular-nums">{formatKES(Number(c.budget))}</TableCell><TableCell>{c.leads_count}/{c.target_leads||"—"}<div className="text-xs text-muted-foreground">{c.segments_count||0} segments</div></TableCell></TableRow>)}</TableBody></Table>}{!loading&&hasMore&&<div className="flex justify-center border-t p-4"><Button variant="outline" onClick={()=>void loadMore()} disabled={loadingMore}>{loadingMore?"Loading…":"Load more campaigns"}</Button></div>}</CardContent></Card>
 </div>
 <Dialog open={open} onOpenChange={setOpen}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>New campaign</DialogTitle><DialogDescription>Set outreach dates, budget and lead targets. Costs and values are in KES.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2">
  <Field label="Campaign name *" id="campaign-name" wide><Input id="campaign-name" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></Field>
  <Field label="Type" id="campaign-type"><select id="campaign-type" value={form.campaignType} onChange={e=>setForm({...form,campaignType:e.target.value})} className="h-9 rounded-md border border-input bg-background px-3 text-sm">{["email","phone","event","social","referral","other"].map(s=><option key={s} value={s}>{label(s)}</option>)}</select></Field>
  <Field label="Status" id="campaign-status"><select id="campaign-status" value={form.status} onChange={e=>setForm({...form,status:e.target.value})} className="h-9 rounded-md border border-input bg-background px-3 text-sm">{statuses.map(s=><option key={s} value={s}>{label(s)}</option>)}</select></Field>
  <Field label="Start date" id="campaign-start"><Input id="campaign-start" type="date" value={form.startDate} onChange={e=>setForm({...form,startDate:e.target.value})}/></Field>
  <Field label="End date" id="campaign-end"><Input id="campaign-end" type="date" value={form.endDate} onChange={e=>setForm({...form,endDate:e.target.value})}/></Field>
  <Field label="Budget (KSh)" id="campaign-budget"><Input id="campaign-budget" type="number" min="0" value={form.budget} onChange={e=>setForm({...form,budget:e.target.value})}/></Field>
  <Field label="Target leads" id="campaign-target"><Input id="campaign-target" type="number" min="0" value={form.targetLeads} onChange={e=>setForm({...form,targetLeads:e.target.value})}/></Field>
  <Field label="Notes" id="campaign-notes" wide><textarea id="campaign-notes" rows={3} value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"/></Field>
 </div><DialogFooter><DialogClose render={<Button variant="outline">Cancel</Button>}/><Button onClick={()=>void save()} disabled={saving||!form.name.trim()}>{saving?"Saving…":"Save campaign"}</Button></DialogFooter></DialogContent></Dialog>

 <Dialog open={audienceOpen} onOpenChange={setAudienceOpen}><DialogContent className="sm:max-w-3xl"><DialogHeader><DialogTitle>Campaign audience{audienceCampaign?" — "+audienceCampaign.name:""}</DialogTitle><DialogDescription>Track whether each targeted lead was contacted, responded or converted.</DialogDescription></DialogHeader>{campaignLeads.length===0?<p className="py-8 text-center text-sm text-muted-foreground">No leads have been added to this campaign yet.</p>:<Table><TableHeader><TableRow><TableHead>Lead</TableHead><TableHead>Contact</TableHead><TableHead>Response status</TableHead></TableRow></TableHeader><TableBody>{campaignLeads.map(l=><TableRow key={l.lead_id}><TableCell><div className="font-medium">{l.contact_name}</div><div className="text-xs text-muted-foreground">{l.organization_name||"Independent contact"}</div></TableCell><TableCell><div>{l.email||"—"}</div><div className="text-xs text-muted-foreground">{l.phone||""}</div></TableCell><TableCell><select aria-label={"Response status for "+l.contact_name} value={l.response_status} onChange={e=>void updateResponse(l,e.target.value)} className="rounded-md border border-input bg-background px-2 py-1.5 text-xs">{["targeted","contacted","responded","converted","unresponsive"].map(s=><option key={s} value={s}>{label(s)}</option>)}</select></TableCell></TableRow>)}</TableBody></Table>}<DialogFooter><DialogClose render={<Button variant="outline">Close</Button>}/></DialogFooter></DialogContent></Dialog>
 </BaseLayout>
}
function Field({label,id,wide=false,children}:{label:string;id:string;wide?:boolean;children:React.ReactNode}){return <div className={"flex flex-col gap-1.5 "+(wide?"sm:col-span-2":"")}><Label htmlFor={id}>{label}</Label>{children}</div>}
