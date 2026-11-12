import * as React from "react"
import { Banknote, FileUp, Plus, RefreshCw, CheckCircle2, Link2 } from "lucide-react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/lib/api-client"
import { formatKES } from "@/lib/format"

type Account = { id:string;code:string;name:string;system_code:string|null;is_active:boolean }
type StatementImport = { id:string;account_code:string;account_name:string;statement_start:string;statement_end:string;opening_balance:number|string;closing_balance:number|string;status:string;line_count:number;matched_count:number;unmatched_count:number;closing_variance:number|string }
type StatementLine = { id:string;transaction_date:string;description:string;reference:string|null;debit:number|string;credit:number|string;running_balance:number|string|null;status:string;matched_entry_number?:string|null;matched_entry_date?:string|null;matched_entry_description?:string|null }
type StatementDetail = StatementImport & { bank_account_id:string;lines:StatementLine[];lineCount:number;matchedCount:number;unmatchedCount:number;calculatedClosingBalance:number;closingVariance:number }
type Candidate = { id:string;entry_number:string;entry_date:string;description:string;bank_movement:number|string }
type DraftLine = { transactionDate:string;description:string;reference:string;debit:string;credit:string;runningBalance:string }

const today = () => new Date().toISOString().slice(0,10)
const emptyLine = ():DraftLine => ({transactionDate:today(),description:"",reference:"",debit:"",credit:"",runningBalance:""})
const errorText = (error:unknown) => error && typeof error==="object" && "message" in error ? String((error as {message:unknown}).message) : "The request failed. Please try again."
const parseAmount = (value:string) => {
 const normalized=value.trim().replace(/,/g,"").replace(/^\((.*)\)$/,"-$1")
 if(!normalized)return 0
 const amount=Number(normalized)
 if(!Number.isFinite(amount))throw new Error("A statement amount could not be read.")
 return Math.round(amount*100)/100
}
function parseCsvRows(text:string):string[][] {
 const rows:string[][]=[];let row:string[]=[];let cell="";let quoted=false
 for(let i=0;i<text.length;i++){
  const ch=text[i]
  if(ch==='"'&&quoted&&text[i+1]==='"'){cell+='"';i++}
  else if(ch==='"')quoted=!quoted
  else if(ch===','&&!quoted){row.push(cell.trim());cell=""}
  else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell.trim());if(row.some(v=>v!==""))rows.push(row);row=[];cell=""}
  else cell+=ch
 }
 row.push(cell.trim());if(row.some(v=>v!==""))rows.push(row)
 return rows
}
function csvDate(value:string):string {
 const raw=value.trim()
 if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return raw
 const match=raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/)
 if(match)return match[3]+"-"+match[2].padStart(2,"0")+"-"+match[1].padStart(2,"0")
 const parsed=new Date(raw)
 if(Number.isNaN(parsed.getTime()))throw new Error("A statement date could not be read. Use YYYY-MM-DD or DD/MM/YYYY.")
 return parsed.toISOString().slice(0,10)
}
function parseStatementCsv(text:string):DraftLine[] {
 const rows=parseCsvRows(text)
 if(rows.length<2)throw new Error("The CSV must contain a header and at least one transaction.")
 const headers=rows[0].map(v=>v.toLowerCase().replace(/[^a-z0-9]+/g," ").trim())
 const find=(names:string[])=>headers.findIndex(h=>names.some(n=>h===n||h.includes(n)))
 const dateIndex=find(["date","transaction date","value date"])
 const descriptionIndex=find(["description","narration","details","transaction details"])
 const referenceIndex=find(["reference","transaction id","receipt number","ref"])
 const debitIndex=find(["debit","withdrawal","money out"])
 const creditIndex=find(["credit","deposit","money in"])
 const balanceIndex=find(["balance","running balance"])
 if(dateIndex<0||descriptionIndex<0||debitIndex<0||creditIndex<0)throw new Error("CSV headers must include date, description, debit and credit columns.")
 return rows.slice(1).map((row,index)=>({
  transactionDate:csvDate(row[dateIndex]??""),
  description:(row[descriptionIndex]??"").trim(),
  reference:referenceIndex>=0?(row[referenceIndex]??"").trim():"",
  debit:String(parseAmount(row[debitIndex]??"")),
  credit:String(parseAmount(row[creditIndex]??"")),
  runningBalance:balanceIndex>=0&&row[balanceIndex]?String(parseAmount(row[balanceIndex])):"",
 }))
}

export default function BankReconciliationPage(){
 const [accounts,setAccounts]=React.useState<Account[]>([])
 const [imports,setImports]=React.useState<StatementImport[]>([])
 const [detail,setDetail]=React.useState<StatementDetail|null>(null)
 const [accountId,setAccountId]=React.useState("")
 const [statementStart,setStatementStart]=React.useState(today().slice(0,8)+"01")
 const [statementEnd,setStatementEnd]=React.useState(today())
 const [openingBalance,setOpeningBalance]=React.useState("")
 const [closingBalance,setClosingBalance]=React.useState("")
 const [fileName,setFileName]=React.useState("")
 const [lines,setLines]=React.useState<DraftLine[]>([emptyLine()])
 const [candidates,setCandidates]=React.useState<Record<string,Candidate[]>>({})
 const [selectedCandidates,setSelectedCandidates]=React.useState<Record<string,string>>({})
 const [loading,setLoading]=React.useState(true)
 const [saving,setSaving]=React.useState(false)
 const [workingLine,setWorkingLine]=React.useState<string|null>(null)
 const [error,setError]=React.useState<string|null>(null)

 const load=React.useCallback(async()=>{
  setLoading(true);setError(null)
  try{
   const [accountRows,statementRows]=await Promise.all([
    api.get<Account[]>("/accounting/accounts"),
    api.get<StatementImport[]>("/accounting/bank-statements"),
   ])
   const eligible=accountRows.filter(a=>a.is_active&&(a.system_code==="bank"||a.system_code==="mpesa"))
   setAccounts(eligible);setAccountId(current=>current||eligible[0]?.id||"")
   setImports(statementRows)
  }catch(e){setError(errorText(e))}
  finally{setLoading(false)}
 },[])
 React.useEffect(()=>{void load()},[load])

 const openImport=async(id:string)=>{
  setError(null)
  try{const value=await api.get<StatementDetail>("/accounting/bank-statements/"+id);setDetail(value);setCandidates({});setSelectedCandidates({})}
  catch(e){setError(errorText(e))}
 }
 const importStatement=async()=>{
  if(!accountId){setError("Select a bank or M-Pesa account.");return}
  if(openingBalance===""||closingBalance===""){setError("Enter the statement opening and closing balances.");return}
  setSaving(true);setError(null)
  try{
   await api.post("/accounting/bank-statements",{accountId,statementStart,statementEnd,openingBalance:Number(openingBalance),closingBalance:Number(closingBalance),fileName:fileName||undefined,lines:lines.map(line=>({transactionDate:line.transactionDate,description:line.description,reference:line.reference||undefined,debit:Number(line.debit||0),credit:Number(line.credit||0),runningBalance:line.runningBalance===""?undefined:Number(line.runningBalance)}))})
   setLines([emptyLine()]);setOpeningBalance("");setClosingBalance("");setFileName("");await load()
  }catch(e){setError(errorText(e))}
  finally{setSaving(false)}
 }
 const loadCandidates=async(line:StatementLine)=>{
  if(!detail)return
  setWorkingLine(line.id);setError(null)
  try{const values=await api.get<Candidate[]>(`/accounting/bank-statements/${detail.id}/lines/${line.id}/candidates`);setCandidates(current=>({...current,[line.id]:values}));setSelectedCandidates(current=>({...current,[line.id]:values[0]?.id??""}))}
  catch(e){setError(errorText(e))}
  finally{setWorkingLine(null)}
 }
 const unmatchLine=async(line:StatementLine)=>{
  if(!detail)return
  if(!window.confirm("Remove the match for this statement line? The journal entry remains posted and can be matched again."))return
  setWorkingLine(line.id);setError(null)
  try{const value=await api.post<StatementDetail>(`/accounting/bank-statements/${detail.id}/lines/${line.id}/unmatch`,{});setDetail(value);await load()}
  catch(e){setError(errorText(e))}
  finally{setWorkingLine(null)}
 }
 const matchLine=async(line:StatementLine)=>{
  if(!detail)return
  const journalEntryId=selectedCandidates[line.id]
  if(!journalEntryId){setError("Select a journal entry to match.");return}
  setWorkingLine(line.id);setError(null)
  try{const value=await api.post<StatementDetail>(`/accounting/bank-statements/${detail.id}/lines/${line.id}/match`,{journalEntryId});setDetail(value);await load()}
  catch(e){setError(errorText(e))}
  finally{setWorkingLine(null)}
 }
 const handleCsv=async(file?:File)=>{
  if(!file)return
  setError(null)
  try{const parsed=parseStatementCsv(await file.text());setLines(parsed);setFileName(file.name)}
  catch(e){setError(errorText(e))}
 }

 return <BaseLayout><div className="flex flex-col gap-6 px-4 lg:px-6">
  <PageHeader title="Bank & M-Pesa reconciliation" description="Import bank or M-Pesa statement lines, match them to posted ledger entries and verify statement closing balances." action={<Button variant="outline" onClick={()=>void load()} disabled={loading}><RefreshCw className="size-4"/>Refresh</Button>}/>
  {error&&<div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
  <Card><CardContent className="flex flex-col gap-4 p-4">
   <div><h2 className="font-semibold">Import statement</h2><p className="text-sm text-muted-foreground">Upload a CSV with date, description, debit and credit columns, or enter statement lines manually. Statement debit means money out; credit means money in.</p></div>
   <div className="grid gap-3 md:grid-cols-3">
    <div className="flex flex-col gap-1"><Label>Bank / M-Pesa ledger account</Label><select className="h-9 rounded-md border bg-background px-3 text-sm" value={accountId} onChange={e=>setAccountId(e.target.value)}><option value="">Select account</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></div>
    <div className="flex flex-col gap-1"><Label>Statement start</Label><Input type="date" value={statementStart} onChange={e=>setStatementStart(e.target.value)}/></div>
    <div className="flex flex-col gap-1"><Label>Statement end</Label><Input type="date" value={statementEnd} onChange={e=>setStatementEnd(e.target.value)}/></div>
    <div className="flex flex-col gap-1"><Label>Opening balance (KES)</Label><Input type="number" step="0.01" value={openingBalance} onChange={e=>setOpeningBalance(e.target.value)}/></div>
    <div className="flex flex-col gap-1"><Label>Closing balance (KES)</Label><Input type="number" step="0.01" value={closingBalance} onChange={e=>setClosingBalance(e.target.value)}/></div>
    <div className="flex flex-col gap-1"><Label>Statement CSV</Label><Input type="file" accept=".csv,text/csv" onChange={e=>void handleCsv(e.target.files?.[0])}/></div>
   </div>
   {fileName&&<p className="text-xs text-muted-foreground">Loaded: {fileName} · {lines.length} transaction lines</p>}
   <div className="flex flex-col gap-3">
    {lines.map((line,index)=><div key={index} className="grid gap-2 rounded-lg border p-3 md:grid-cols-[150px_minmax(180px,2fr)_140px_120px_120px_auto]">
     <div className="flex flex-col gap-1"><Label>Date</Label><Input type="date" value={line.transactionDate} onChange={e=>setLines(current=>current.map((v,i)=>i===index?{...v,transactionDate:e.target.value}:v))}/></div>
     <div className="flex flex-col gap-1"><Label>Description</Label><Input value={line.description} onChange={e=>setLines(current=>current.map((v,i)=>i===index?{...v,description:e.target.value}:v))}/></div>
     <div className="flex flex-col gap-1"><Label>Reference</Label><Input value={line.reference} onChange={e=>setLines(current=>current.map((v,i)=>i===index?{...v,reference:e.target.value}:v))}/></div>
     <div className="flex flex-col gap-1"><Label>Debit / Out</Label><Input type="number" step="0.01" min="0" value={line.debit} onChange={e=>setLines(current=>current.map((v,i)=>i===index?{...v,debit:e.target.value,credit:e.target.value?"0":v.credit}:v))}/></div>
     <div className="flex flex-col gap-1"><Label>Credit / In</Label><Input type="number" step="0.01" min="0" value={line.credit} onChange={e=>setLines(current=>current.map((v,i)=>i===index?{...v,credit:e.target.value,debit:e.target.value?"0":v.debit}:v))}/></div>
     <div className="flex items-end"><Button type="button" variant="outline" size="sm" disabled={lines.length<=1} onClick={()=>setLines(current=>current.filter((_,i)=>i!==index))}>Remove</Button></div>
    </div>)}
   </div>
   <div className="flex flex-wrap justify-between gap-2"><Button variant="outline" onClick={()=>setLines(current=>[...current,emptyLine()])}><Plus className="size-4"/>Add statement line</Button><Button onClick={()=>void importStatement()} disabled={saving||loading||!accountId}>{saving?<LoadingSpinner className="size-4"/>:<FileUp className="size-4"/>}Import statement</Button></div>
  </CardContent></Card>

  <Card><CardContent className="flex flex-col gap-3 p-4"><div><h2 className="font-semibold">Statement imports</h2><p className="text-sm text-muted-foreground">Match each statement line to a posted journal entry. A statement is reconciled only when all lines are matched and the closing balance agrees.</p></div>
   {loading?<div className="flex justify-center py-8"><LoadingSpinner/></div>:imports.length===0?<EmptyState icon={Banknote} title="No statements imported" description="Import a bank or M-Pesa statement to start reconciliation."/>:<div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Account</TableHead><TableHead>Period</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Matched</TableHead><TableHead className="text-right">Unmatched</TableHead><TableHead className="text-right">Closing variance</TableHead><TableHead/></TableRow></TableHeader><TableBody>{imports.map(item=><TableRow key={item.id}><TableCell><div className="font-medium">{item.account_name}</div><div className="text-xs text-muted-foreground">{item.account_code}</div></TableCell><TableCell>{item.statement_start} – {item.statement_end}</TableCell><TableCell><span className={item.status==="reconciled"?"text-emerald-600":"text-amber-600"}>{item.status}</span></TableCell><TableCell className="text-right tabular-nums">{item.matched_count}/{item.line_count}</TableCell><TableCell className="text-right tabular-nums">{item.unmatched_count}</TableCell><TableCell className="text-right tabular-nums">{formatKES(Number(item.closing_variance))}</TableCell><TableCell><Button size="sm" variant="outline" onClick={()=>void openImport(item.id)}>Open</Button></TableCell></TableRow>)}</TableBody></Table></div>}
  </CardContent></Card>

  {detail&&<Card><CardContent className="flex flex-col gap-4 p-4">
   <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="font-semibold">{detail.account_name} · {detail.statement_start} – {detail.statement_end}</h2><p className="text-sm text-muted-foreground">Opening {formatKES(Number(detail.opening_balance))} · Statement closing {formatKES(Number(detail.closing_balance))} · Calculated closing {formatKES(detail.calculatedClosingBalance)}</p></div><Button variant="outline" size="sm" onClick={()=>setDetail(null)}>Close</Button></div>
   <div className="flex flex-wrap gap-3 text-sm"><span>{detail.matchedCount} matched</span><span>{detail.unmatchedCount} unmatched</span><span className={Math.abs(detail.closingVariance)<0.01?"text-emerald-600":"text-destructive"}>Closing variance {formatKES(detail.closingVariance)}</span></div>
   <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Description</TableHead><TableHead>Reference</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead><TableHead>Status / Match</TableHead><TableHead/></TableRow></TableHeader><TableBody>{detail.lines.map(line=><TableRow key={line.id}><TableCell>{line.transaction_date}</TableCell><TableCell><div>{line.description}</div>{line.matched_entry_number&&<div className="text-xs text-muted-foreground">{line.matched_entry_number} · {line.matched_entry_description}</div>}</TableCell><TableCell>{line.reference||"—"}</TableCell><TableCell className="text-right tabular-nums">{formatKES(Number(line.debit))}</TableCell><TableCell className="text-right tabular-nums">{formatKES(Number(line.credit))}</TableCell><TableCell>{line.status==="matched"?<span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 className="size-4"/>Matched</span>:"Unmatched"}</TableCell><TableCell>{line.status==="unmatched"?<Button size="sm" variant="outline" disabled={workingLine===line.id} onClick={()=>void loadCandidates(line)}><Link2 className="size-3.5"/>Find match</Button>:<Button size="sm" variant="ghost" disabled={workingLine===line.id} onClick={()=>void unmatchLine(line)}>Unmatch</Button>}</TableCell></TableRow>)}</TableBody></Table></div>
   {detail.lines.filter(line=>line.status==="unmatched"&&candidates[line.id]).map(line=><div key={line.id} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_auto]"><div className="flex flex-col gap-2"><Label>Matching journal for {line.description}</Label><select className="h-9 rounded-md border bg-background px-3 text-sm" value={selectedCandidates[line.id]??""} onChange={e=>setSelectedCandidates(current=>({...current,[line.id]:e.target.value}))}><option value="">Select a candidate</option>{(candidates[line.id]??[]).map(candidate=><option key={candidate.id} value={candidate.id}>{candidate.entry_number} · {candidate.entry_date} · {candidate.description} · {formatKES(Number(candidate.bank_movement))}</option>)}</select>{(candidates[line.id]??[]).length===0&&<p className="text-xs text-muted-foreground">No posted journal matches this amount, account and seven-day date window. Post the missing transaction first, then refresh candidates.</p>}</div><div className="flex items-end"><Button size="sm" disabled={!selectedCandidates[line.id]||workingLine===line.id} onClick={()=>void matchLine(line)}>{workingLine===line.id?<LoadingSpinner className="size-4"/>:<CheckCircle2 className="size-4"/>}Match line</Button></div></div>)}
  </CardContent></Card>}
 </div></BaseLayout>
}
