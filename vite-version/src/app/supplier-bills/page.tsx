import * as React from "react";
import { AlertCircle, Eye, FileText, Loader2, Plus, RefreshCw, Wallet } from "lucide-react";
import { BaseLayout } from "@/components/layouts/base-layout";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api-client";
import { formatKES, formatDate } from "@/lib/format";

type Supplier={id:string;name:string;is_active:boolean;status:string};
type POLine={id:string;product_name:string;sku:string|null;quantity:string|number;received_quantity:string|number;billed_quantity?:string|number;unit_cost:string|number;tax_rate?:string|number};
type PO={id:string;order_number:string;supplier_id:string;supplier_name:string;status:string;items?:POLine[]};
type BillLine={description:string;quantity:string;unitCost:string;taxRate:string;taxTreatment:"legacy"|"standard"|"zero_rated"|"exempt"|"out_of_scope";purchaseOrderItemId?:string};
type Bill={id:string;bill_number:string;supplier_name:string;supplier_id:string;purchase_order_id:string|null;supplier_invoice_number:string|null;bill_date:string;due_date:string|null;status:"open"|"partially_paid"|"paid"|"void";total:string|number;paid_amount:string|number;balance:string|number;item_count:number};
type BillDetail=Bill&{items:Array<{id:string;description:string;quantity:string|number;unit_cost:string|number;tax_rate:string|number;line_total:string|number}>;payments:Array<{id:string;amount:string|number;cash_amount?:string|number;withholding_tax_amount?:string|number;withholding_certificate_number?:string|null;payment_date:string;method:string;reference?:string|null}>};
const statusLabel:Record<Bill["status"],string>={open:"Open",partially_paid:"Partially paid",paid:"Paid",void:"Void"};
function messageOf(e:unknown){return e&&typeof e==="object"&&"message" in e?String((e as {message:unknown}).message):"Request failed. Please try again."}
function statusStyle(s:Bill["status"]){return s==="paid"?"bg-emerald-500/10 text-emerald-700":s==="void"?"bg-destructive/10 text-destructive":s==="partially_paid"?"bg-amber-500/10 text-amber-700":"bg-muted text-muted-foreground"}
export default function SupplierBillsPage(){
 const [bills,setBills]=React.useState<Bill[]>([]);
 const [suppliers,setSuppliers]=React.useState<Supplier[]>([]);
 const [orders,setOrders]=React.useState<PO[]>([]);
 const [loading,setLoading]=React.useState(true);
 const [saving,setSaving]=React.useState(false);
 const [busyId,setBusyId]=React.useState("");
 const [error,setError]=React.useState("");
 const [showForm,setShowForm]=React.useState(false);
 const [supplierId,setSupplierId]=React.useState("");
 const [purchaseOrderId,setPurchaseOrderId]=React.useState("");
 const [supplierInvoiceNumber,setSupplierInvoiceNumber]=React.useState("");
 const [billDate,setBillDate]=React.useState(new Date().toISOString().slice(0,10));
 const [dueDate,setDueDate]=React.useState("");
 const [notes,setNotes]=React.useState("");
 const [lines,setLines]=React.useState<BillLine[]>([{description:"",quantity:"1",unitCost:"0",taxRate:"16",taxTreatment:"legacy"}]);
 const [payBill,setPayBill]=React.useState<Bill|null>(null);
 const [detail,setDetail]=React.useState<BillDetail|null>(null);
 const [detailLoading,setDetailLoading]=React.useState(false);
 const [paymentAmount,setPaymentAmount]=React.useState("");
 const [paymentDate,setPaymentDate]=React.useState(new Date().toISOString().slice(0,10));
 const [paymentMethod,setPaymentMethod]=React.useState("bank_transfer");
 const [paymentWithholdingTaxAmount,setPaymentWithholdingTaxAmount]=React.useState("0");
 const [paymentWithholdingCertificateNumber,setPaymentWithholdingCertificateNumber]=React.useState("");
 const [paymentReference,setPaymentReference]=React.useState("");
 const [search,setSearch]=React.useState("");
 const [statusFilter,setStatusFilter]=React.useState("all");
 const refresh=React.useCallback(async()=>{
  setLoading(true);setError("");
  try{
   const [b,s,p]=await Promise.all([api.get<Bill[]>("/supplier-bills"),api.get<Supplier[]>("/suppliers"),api.get<PO[]>("/purchase-orders")]);
   setBills(b);setSuppliers(s.filter(x=>x.is_active&&x.status==="active"));setOrders(p.filter(x=>["ordered","partially_received","received"].includes(x.status)));
   setSupplierId(current=>current||s.find(x=>x.is_active&&x.status==="active")?.id||"");
  }catch(e){setError(messageOf(e))}finally{setLoading(false)}
 },[]);
 React.useEffect(()=>{let active=true;void Promise.all([api.get<Bill[]>("/supplier-bills"),api.get<Supplier[]>("/suppliers"),api.get<PO[]>("/purchase-orders")]).then(([b,s,p])=>{if(active){setBills(b);setSuppliers(s.filter(x=>x.is_active&&x.status==="active"));setOrders(p.filter(x=>["ordered","partially_received","received"].includes(x.status)));setSupplierId(current=>current||s.find(x=>x.is_active&&x.status==="active")?.id||"");}}).catch(e=>{if(active)setError(messageOf(e));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[]);
 const chooseOrder=async(id:string)=>{
  setPurchaseOrderId(id);
  if(!id){setLines([{description:"",quantity:"1",unitCost:"0",taxRate:"16",taxTreatment:"legacy"}]);return}
  setError("");
  try{
   const po=await api.get<PO>(`/purchase-orders/${id}`);
   setSupplierId(po.supplier_id);
   const received=(po.items??[]).map(i=>({...i,unbilledQuantity:Math.max(0,Number(i.received_quantity)-Number(i.billed_quantity??0))})).filter(i=>i.unbilledQuantity>0).map(i=>({description:i.product_name,quantity:String(i.unbilledQuantity),unitCost:String(i.unit_cost),taxRate:String(i.tax_rate??0),taxTreatment:"legacy" as const,purchaseOrderItemId:i.id}));
   if(!received.length){setError("This order has no unbilled received quantities available to bill.");setLines([{description:"",quantity:"1",unitCost:"0",taxRate:"16",taxTreatment:"legacy"}]);return}
   setLines(received);
  }catch(e){setError(messageOf(e))}
 };
 const viewBill=async(b:Bill)=>{setDetailLoading(true);setError("");try{setDetail(await api.get<BillDetail>(`/supplier-bills/${b.id}`))}catch(e){setError(messageOf(e))}finally{setDetailLoading(false)}};
 const createBill=async()=>{
  if(!supplierId||lines.some(l=>!l.description.trim()||Number(l.quantity)<=0||Number(l.unitCost)<0||Number(l.taxRate)<0||Number(l.taxRate)>100)){setError("Choose a supplier and complete each bill line with valid quantities, costs and tax rates.");return}
  if(purchaseOrderId&&lines.some(l=>!l.purchaseOrderItemId)){setError("All lines on a purchase-order bill must be linked to received order lines.");return}
  setSaving(true);setError("");
  try{
   await api.post("/supplier-bills",{supplierId,purchaseOrderId:purchaseOrderId||undefined,supplierInvoiceNumber:supplierInvoiceNumber.trim()||undefined,billDate:billDate||undefined,dueDate:dueDate||undefined,notes:notes.trim()||undefined,items:lines.map(l=>({description:l.description.trim(),quantity:Number(l.quantity),unitCost:Number(l.unitCost),taxRate:Number(l.taxRate||0),taxTreatment:l.taxTreatment,purchaseOrderItemId:l.purchaseOrderItemId}))});
   setShowForm(false);setPurchaseOrderId("");setSupplierInvoiceNumber("");setDueDate("");setNotes("");setLines([{description:"",quantity:"1",unitCost:"0",taxRate:"16",taxTreatment:"legacy"}]);await refresh();
  }catch(e){setError(messageOf(e))}finally{setSaving(false)}
 };
 const recordPayment=async()=>{
  if(!payBill)return;
  const amount=Number(paymentAmount);
  if(!Number.isFinite(amount)||amount<=0||amount>Number(payBill.balance)+0.000001){setError("Enter a payment greater than zero and no more than the outstanding balance.");return}
  setBusyId(payBill.id);setError("");
  try{
   await api.post(`/supplier-bills/${payBill.id}/payments`,{amount,paymentDate:paymentDate||undefined,method:paymentMethod,reference:paymentReference.trim()||undefined,withholdingTaxAmount:Number(paymentWithholdingTaxAmount||0),withholdingCertificateNumber:paymentWithholdingCertificateNumber.trim()||undefined});
   setPayBill(null);setPaymentAmount("");setPaymentReference("");setPaymentWithholdingTaxAmount("0");setPaymentWithholdingCertificateNumber("");await refresh();
  }catch(e){setError(messageOf(e))}finally{setBusyId("")}
 };
 const outstanding=bills.filter(b=>b.status==="open"||b.status==="partially_paid").reduce((sum,b)=>sum+Number(b.balance),0);
 const today=new Date();today.setHours(0,0,0,0);
 const outstandingBills=bills.filter(b=>(b.status==="open"||b.status==="partially_paid")&&Number(b.balance)>0);
 const overdue=bills.filter(b=>(b.status==="open"||b.status==="partially_paid")&&b.due_date&&new Date(b.due_date+"T00:00:00")<today).reduce((sum,b)=>sum+Number(b.balance),0);
 const aging={current:0,days1to30:0,days31to60:0,days61plus:0};
 for(const b of outstandingBills){if(!b.due_date||new Date(b.due_date+"T00:00:00")>=today){aging.current+=Number(b.balance);continue}const days=Math.floor((today.getTime()-new Date(b.due_date+"T00:00:00").getTime())/86400000);if(days<=30)aging.days1to30+=Number(b.balance);else if(days<=60)aging.days31to60+=Number(b.balance);else aging.days61plus+=Number(b.balance)}
 const filteredBills=bills.filter(b=>(statusFilter==="all"||b.status===statusFilter)&&[b.bill_number,b.supplier_name,b.supplier_invoice_number??""].some(v=>v.toLowerCase().includes(search.trim().toLowerCase())));
 return <BaseLayout><div className="flex flex-col gap-6 px-4 lg:px-6">
  <PageHeader title="Supplier Bills" description="Track supplier invoices, outstanding payables, due dates and payments against received goods." action={<div className="flex gap-2"><Button variant="outline" onClick={()=>void refresh()} disabled={loading}><RefreshCw className="size-4"/>Refresh</Button><Button onClick={()=>setShowForm(v=>!v)}><Plus className="size-4"/>{showForm?"Close form":"New supplier bill"}</Button></div>}/>
  {error&&<div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0"/>{error}</div>}
  <div className="grid gap-3 sm:grid-cols-3"><Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Supplier bills</p><p className="text-2xl font-semibold tabular-nums">{bills.length}</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Outstanding payables</p><p className="text-2xl font-semibold tabular-nums">{formatKES(outstanding)}</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Overdue balance</p><p className="text-2xl font-semibold tabular-nums">{formatKES(overdue)}</p></CardContent></Card></div>
  <Card><CardContent className="flex flex-col gap-3 p-4"><div><h2 className="font-semibold">Payables ageing</h2><p className="text-sm text-muted-foreground">Outstanding balances grouped by due date. Bills without a due date are included in Current / no due date.</p></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><div className="rounded-lg border p-3"><p className="text-sm text-muted-foreground">Current / no due date</p><p className="text-xl font-semibold tabular-nums">{formatKES(aging.current)}</p></div><div className="rounded-lg border p-3"><p className="text-sm text-muted-foreground">1–30 days overdue</p><p className="text-xl font-semibold tabular-nums">{formatKES(aging.days1to30)}</p></div><div className="rounded-lg border p-3"><p className="text-sm text-muted-foreground">31–60 days overdue</p><p className="text-xl font-semibold tabular-nums">{formatKES(aging.days31to60)}</p></div><div className="rounded-lg border p-3"><p className="text-sm text-muted-foreground">61+ days overdue</p><p className="text-xl font-semibold tabular-nums">{formatKES(aging.days61plus)}</p></div></div></CardContent></Card>
  {showForm&&<Card><CardContent className="flex flex-col gap-4 p-4">
   <div><h2 className="font-semibold">Create supplier bill</h2><p className="text-sm text-muted-foreground">You can enter a standalone supplier invoice or link it to a purchase order. Linked lines can only bill quantities already received and not previously billed.</p></div>
   <div className="grid gap-4 md:grid-cols-2">
    <div className="flex flex-col gap-1"><Label htmlFor="bill-supplier">Supplier</Label><select id="bill-supplier" className="h-9 rounded-md border bg-background px-3 text-sm" value={supplierId} onChange={e=>setSupplierId(e.target.value)} disabled={!!purchaseOrderId}><option value="">Choose supplier</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
    <div className="flex flex-col gap-1"><Label htmlFor="bill-po">Link purchase order (optional)</Label><select id="bill-po" className="h-9 rounded-md border bg-background px-3 text-sm" value={purchaseOrderId} onChange={e=>void chooseOrder(e.target.value)}><option value="">Standalone bill</option>{orders.map(o=><option key={o.id} value={o.id}>{o.order_number} — {o.supplier_name}</option>)}</select></div>
    <div className="flex flex-col gap-1"><Label htmlFor="supplier-invoice">Supplier invoice number</Label><Input id="supplier-invoice" value={supplierInvoiceNumber} onChange={e=>setSupplierInvoiceNumber(e.target.value)} maxLength={120}/></div>
    <div className="flex flex-col gap-1"><Label htmlFor="bill-date">Bill date</Label><Input id="bill-date" type="date" value={billDate} onChange={e=>setBillDate(e.target.value)}/></div>
    <div className="flex flex-col gap-1"><Label htmlFor="bill-due">Due date</Label><Input id="bill-due" type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)}/></div>
   </div>
   <div className="flex flex-col gap-3"><div className="flex items-center justify-between"><h3 className="text-sm font-medium">Bill lines</h3>{!purchaseOrderId&&<Button type="button" variant="outline" size="sm" onClick={()=>setLines(v=>[...v,{description:"",quantity:"1",unitCost:"0",taxRate:"16",taxTreatment:"legacy"}])}><Plus className="size-3.5"/>Add line</Button>}</div>
    {lines.map((line,index)=><div key={line.purchaseOrderItemId??index} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[minmax(180px,2fr)_100px_130px_100px_minmax(170px,1fr)_auto]">
     <div className="flex flex-col gap-1"><Label>Description</Label><Input value={line.description} onChange={e=>setLines(v=>v.map((x,i)=>i===index?{...x,description:e.target.value}:x))} disabled={!!purchaseOrderId}/></div>
     <div className="flex flex-col gap-1"><Label>Quantity</Label><Input type="number" min="0.001" step="0.001" value={line.quantity} onChange={e=>setLines(v=>v.map((x,i)=>i===index?{...x,quantity:e.target.value}:x))}/></div>
     <div className="flex flex-col gap-1"><Label>Unit cost (KSh)</Label><Input type="number" min="0" step="0.01" value={line.unitCost} onChange={e=>setLines(v=>v.map((x,i)=>i===index?{...x,unitCost:e.target.value}:x))}/></div>
     <div className="flex flex-col gap-1"><Label>Tax %</Label><Input type="number" min="0" max="100" step="0.01" value={line.taxRate} onChange={e=>setLines(v=>v.map((x,i)=>i===index?{...x,taxRate:e.target.value}:x))}/></div>
     <div className="flex flex-col gap-1"><Label>Tax treatment</Label><Select value={line.taxTreatment} onValueChange={value=>value&&setLines(v=>v.map((x,i)=>i===index?{...x,taxTreatment:value as BillLine["taxTreatment"]}:x))}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="legacy">Legacy</SelectItem><SelectItem value="standard">Standard-rated</SelectItem><SelectItem value="zero_rated">Zero-rated</SelectItem><SelectItem value="exempt">Exempt</SelectItem><SelectItem value="out_of_scope">Out of scope</SelectItem></SelectContent></Select></div>
     {!purchaseOrderId&&<div className="flex items-end"><Button type="button" variant="ghost" disabled={lines.length===1} onClick={()=>setLines(v=>v.filter((_,i)=>i!==index))}>Remove</Button></div>}
    </div>)}
   </div>
   <div className="flex flex-col gap-1"><Label htmlFor="bill-notes">Notes</Label><Input id="bill-notes" value={notes} onChange={e=>setNotes(e.target.value)} maxLength={2000}/></div>
   <div className="flex justify-end"><Button onClick={()=>void createBill()} disabled={saving||suppliers.length===0||lines.length===0}>{saving?<Loader2 className="size-4 animate-spin"/>:<Plus className="size-4"/>}Create bill</Button></div>
  </CardContent></Card>}
  {detailLoading&&<p className="text-sm text-muted-foreground">Loading bill details and payment history…</p>}
  {detail&&<Card><CardContent className="flex flex-col gap-3 p-4"><div className="flex items-center justify-between"><div><h2 className="font-semibold">{detail.bill_number}</h2><p className="text-sm text-muted-foreground">{detail.supplier_name} · {detail.supplier_invoice_number||"No supplier invoice reference"}</p></div><Button variant="outline" size="sm" onClick={()=>setDetail(null)}>Close</Button></div><p className="text-sm">Total: <strong>{formatKES(Number(detail.total))}</strong> · Paid: <strong>{formatKES(Number(detail.paid_amount))}</strong> · Balance: <strong>{formatKES(Number(detail.balance))}</strong></p><h3 className="font-medium">Bill lines</h3>{detail.items.map(i=><div key={i.id} className="flex flex-wrap justify-between gap-2 border-b py-2 text-sm"><span>{i.description} · Qty {Number(i.quantity)}</span><span>{formatKES(Number(i.line_total))}</span></div>)}<h3 className="font-medium">Payment history</h3>{detail.payments.length===0?<p className="text-sm text-muted-foreground">No payments recorded.</p>:detail.payments.map(p=><div key={p.id} className="flex flex-wrap justify-between gap-2 border-b py-2 text-sm"><span>{formatDate(p.payment_date)} · {p.method.replaceAll("_"," ")} · {p.reference||"No reference"}</span><span className="text-right"><strong>{formatKES(Number(p.amount))}</strong>{Number(p.withholding_tax_amount??0)>0&&<span className="block text-xs text-muted-foreground">Cash {formatKES(Number(p.cash_amount??0))} · WHT {formatKES(Number(p.withholding_tax_amount))} · Cert {p.withholding_certificate_number||"—"}</span>}</span></div>)}</CardContent></Card>}
  {payBill&&<Card><CardContent className="flex flex-col gap-4 p-4"><div><h2 className="font-semibold">Record payment — {payBill.bill_number}</h2><p className="text-sm text-muted-foreground">Outstanding balance: {formatKES(Number(payBill.balance))}</p></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div className="flex flex-col gap-1"><Label htmlFor="pay-amount">Gross amount settled (KSh)</Label><Input id="pay-amount" type="number" min="0.01" max={Number(payBill.balance)} step="0.01" value={paymentAmount} onChange={e=>setPaymentAmount(e.target.value)}/></div><div className="flex flex-col gap-1"><Label htmlFor="pay-date">Payment date</Label><Input id="pay-date" type="date" value={paymentDate} onChange={e=>setPaymentDate(e.target.value)}/></div><div className="flex flex-col gap-1"><Label htmlFor="pay-method">Method</Label><select id="pay-method" className="h-9 rounded-md border bg-background px-3 text-sm" value={paymentMethod} onChange={e=>setPaymentMethod(e.target.value)}>{[["bank_transfer","Bank transfer"],["mpesa","M-Pesa"],["cash","Cash"],["cheque","Cheque"],["card","Card"],["other","Other"]].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div><div className="flex flex-col gap-1"><Label htmlFor="pay-reference">Reference</Label><Input id="pay-reference" value={paymentReference} onChange={e=>setPaymentReference(e.target.value)} maxLength={120}/></div><div className="flex flex-col gap-1"><Label htmlFor="pay-withholding">Withholding tax (KSh)</Label><Input id="pay-withholding" type="number" min="0" max={Number(paymentAmount||0)} step="0.01" value={paymentWithholdingTaxAmount} onChange={e=>setPaymentWithholdingTaxAmount(e.target.value)}/></div><div className="flex flex-col gap-1"><Label htmlFor="pay-withholding-cert">Withholding certificate / reference</Label><Input id="pay-withholding-cert" value={paymentWithholdingCertificateNumber} onChange={e=>setPaymentWithholdingCertificateNumber(e.target.value)} maxLength={120} placeholder="Required when withholding tax is entered"/></div></div><div className="rounded-md bg-muted/50 p-3 text-sm">Net cash paid: <strong className="tabular-nums">{formatKES(Math.max(0,Number(paymentAmount||0)-Number(paymentWithholdingTaxAmount||0)))}</strong><span className="ml-2 text-muted-foreground">plus withholding tax credited to KRA payable</span></div><div className="flex justify-end gap-2"><Button variant="outline" onClick={()=>setPayBill(null)} disabled={busyId===payBill.id}>Cancel</Button><Button onClick={()=>void recordPayment()} disabled={busyId===payBill.id}>{busyId===payBill.id?<Loader2 className="size-4 animate-spin"/>:<Wallet className="size-4"/>}Record payment</Button></div></CardContent></Card>}
  <Card><CardContent className="flex flex-col gap-4 p-4"><div><h2 className="font-semibold">Accounts payable register</h2><p className="text-sm text-muted-foreground">Balances update transactionally when payments are recorded. No sample bills are inserted.</p></div><div className="grid gap-3 sm:grid-cols-[minmax(220px,1fr)_200px]"><div className="flex flex-col gap-1"><Label htmlFor="bill-search">Search bills</Label><Input id="bill-search" placeholder="Bill number, supplier or invoice…" value={search} onChange={e=>setSearch(e.target.value)}/></div><div className="flex flex-col gap-1"><Label htmlFor="bill-status-filter">Status</Label><select id="bill-status-filter" className="h-9 rounded-md border bg-background px-3 text-sm" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="all">All statuses</option><option value="open">Open</option><option value="partially_paid">Partially paid</option><option value="paid">Paid</option><option value="void">Void</option></select></div></div>
   {loading?<div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground"/></div>:bills.length===0?<div className="flex flex-col items-center gap-2 py-12 text-center"><FileText className="size-8 text-muted-foreground"/><p className="font-medium">No supplier bills yet</p><p className="text-sm text-muted-foreground">Create a bill to begin tracking amounts due to suppliers.</p></div>:filteredBills.length===0?<p className="py-8 text-center text-sm text-muted-foreground">No bills match the selected search and status.</p>:<div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Bill #</TableHead><TableHead>Supplier</TableHead><TableHead>Supplier invoice</TableHead><TableHead>Bill date</TableHead><TableHead>Due date</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Paid</TableHead><TableHead className="text-right">Balance</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{filteredBills.map(b=><TableRow key={b.id}><TableCell className="font-medium">{b.bill_number}</TableCell><TableCell>{b.supplier_name}</TableCell><TableCell>{b.supplier_invoice_number||"—"}</TableCell><TableCell>{formatDate(b.bill_date)}</TableCell><TableCell>{b.due_date?formatDate(b.due_date):"—"}</TableCell><TableCell><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusStyle(b.status)}`}>{statusLabel[b.status]}</span></TableCell><TableCell className="text-right tabular-nums">{formatKES(Number(b.total))}</TableCell><TableCell className="text-right tabular-nums">{formatKES(Number(b.paid_amount))}</TableCell><TableCell className="text-right font-medium tabular-nums">{formatKES(Number(b.balance))}</TableCell><TableCell><div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={()=>void viewBill(b)}><Eye className="size-3.5"/>View</Button>{(b.status==="open"||b.status==="partially_paid")&&<Button size="sm" variant="outline" disabled={busyId===b.id} onClick={()=>{setPayBill(b);setPaymentAmount(String(b.balance));setPaymentReference("");setPaymentWithholdingTaxAmount("0");setPaymentWithholdingCertificateNumber("")}}><Wallet className="size-3.5"/>Pay</Button>}</div></TableCell></TableRow>)}</TableBody></Table></div>}
  </CardContent></Card>
 </div></BaseLayout>;
}
