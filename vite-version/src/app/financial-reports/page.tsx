import * as React from "react";
import { Download, FileBarChart, Printer, RefreshCw } from "lucide-react";
import { BaseLayout } from "@/components/layouts/base-layout";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { api } from "@/lib/api-client";
import { formatKES } from "@/lib/format";
import { downloadCsv, escapeDocumentText, printBusinessDocument } from "@/lib/printable-document";

type TrialBalanceAccount={id:string;code:string;name:string;account_type:string;total_debits:number;total_credits:number;debit_balance:number;credit_balance:number};
type TrialBalance={asOfDate:string;accounts:TrialBalanceAccount[];totalDebits:number;totalCredits:number;variance:number;balanced:boolean};
const message=(e:unknown)=>e&&typeof e==="object"&&"message" in e?String((e as {message:unknown}).message):"The request failed. Please try again.";

export default function FinancialReportsPage(){
 const [asOfDate,setAsOfDate]=React.useState(new Date().toISOString().slice(0,10));
 const [report,setReport]=React.useState<TrialBalance|null>(null);const [loading,setLoading]=React.useState(true);const [error,setError]=React.useState<string|null>(null);
 const load=React.useCallback(async()=>{setLoading(true);setError(null);try{const q=new URLSearchParams();if(asOfDate)q.set("asOfDate",asOfDate);setReport(await api.get<TrialBalance>("/accounting/reports/trial-balance?"+q.toString()));}catch(e){setError(message(e));}finally{setLoading(false);}},[asOfDate]);
 React.useEffect(()=>{let active=true;const q=new URLSearchParams();if(asOfDate)q.set("asOfDate",asOfDate);void api.get<TrialBalance>("/accounting/reports/trial-balance?"+q.toString()).then(result=>{if(active)setReport(result);}).catch(e=>{if(active)setError(message(e));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[]);
 const exportCsv=()=>{if(!report)return;downloadCsv("omega-trial-balance-"+asOfDate+".csv",[["Account code","Account name","Account type","Debit balance","Credit balance"],...report.accounts.map(a=>[a.code,a.name,a.account_type,a.debit_balance,a.credit_balance]),["","","Totals",report.totalDebits,report.totalCredits]]);};
 const printReport=()=>{if(!report)return;const rows=report.accounts.map(a=>`<tr><td>${escapeDocumentText(a.code)}</td><td>${escapeDocumentText(a.name)}</td><td>${escapeDocumentText(a.account_type)}</td><td class="num">${formatKES(Number(a.debit_balance))}</td><td class="num">${formatKES(Number(a.credit_balance))}</td></tr>`).join("");const content=`<header class="top"><div><div class="brand">Your business</div><h1>Trial balance</h1><div class="muted">Posted ledger balances</div></div><div class="meta"><strong>As of ${escapeDocumentText(asOfDate)}</strong><div>${report.balanced?"Balanced":"Out of balance"}</div></div></header><table><thead><tr><th>Code</th><th>Account</th><th>Type</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead><tbody>${rows}</tbody></table><div class="totals"><div><span>Total debits</span><strong>${formatKES(report.totalDebits)}</strong></div><div><span>Total credits</span><strong>${formatKES(report.totalCredits)}</strong></div></div>`;printBusinessDocument("Trial balance",asOfDate,content);};

 return <BaseLayout><div className="flex flex-col gap-6 px-4 lg:px-6">
  <PageHeader title="Financial Reports" description="Review cumulative balances from posted journal entries. Additional financial statements will be enabled as their controls are completed."/>
  <Card><CardContent className="flex flex-wrap items-end gap-3 p-4">
   <div className="grid gap-2"><label className="text-sm font-medium">Trial balance as of</label><Input type="date" value={asOfDate} onChange={e=>setAsOfDate(e.target.value)}/></div>
   <Button variant="outline" onClick={()=>void load()} disabled={loading}><RefreshCw className="mr-2 size-4"/>Refresh report</Button><Button variant="outline" onClick={exportCsv} disabled={!report}><Download className="mr-2 size-4"/>Export CSV</Button><Button variant="outline" onClick={printReport} disabled={!report}><Printer className="mr-2 size-4"/>Print / Save PDF</Button>
  </CardContent></Card>
  <Card><CardContent className="p-0">
   <div className="flex flex-wrap items-center justify-between gap-2 p-4"><h2 className="font-semibold">Trial balance</h2>{report&&<span className={report.balanced?"text-sm text-emerald-600":"text-sm text-destructive"}>{report.balanced?"Debits and credits balance":"Out of balance: "+formatKES(Math.abs(report.variance))}</span>}</div>
   {loading?<div className="flex justify-center p-12"><LoadingSpinner/></div>:error?<div className="p-6 text-sm text-destructive" role="alert">{error}<Button className="ml-3" variant="outline" size="sm" onClick={()=>void load()}>Retry</Button></div>:!report||report.accounts.length===0?<EmptyState icon={FileBarChart} title="No accounts to report" description="The report will show posted account balances when the company has a chart of accounts and ledger activity."/>:
   <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-y bg-muted/40 text-left"><th className="p-3">Code</th><th className="p-3">Account</th><th className="p-3">Type</th><th className="p-3 text-right">Debit balance</th><th className="p-3 text-right">Credit balance</th></tr></thead><tbody>{report.accounts.map(a=><tr key={a.id} className="border-b last:border-0"><td className="p-3 tabular-nums">{a.code}</td><td className="p-3 font-medium">{a.name}</td><td className="p-3 capitalize">{a.account_type}</td><td className="p-3 text-right tabular-nums">{formatKES(a.debit_balance)}</td><td className="p-3 text-right tabular-nums">{formatKES(a.credit_balance)}</td></tr>)}</tbody><tfoot><tr className="bg-muted/40 font-semibold"><td className="p-3" colSpan={3}>Totals</td><td className="p-3 text-right tabular-nums">{formatKES(report.totalDebits)}</td><td className="p-3 text-right tabular-nums">{formatKES(report.totalCredits)}</td></tr></tfoot></table></div>}
  </CardContent></Card>
 </div></BaseLayout>;
}
