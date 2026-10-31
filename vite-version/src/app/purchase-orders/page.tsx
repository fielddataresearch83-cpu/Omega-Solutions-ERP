import * as React from "react";
import { AlertCircle, ClipboardList, Loader2, Plus, RefreshCw, ShieldCheck, Truck } from "lucide-react";
import { BaseLayout } from "@/components/layouts/base-layout";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api-client";
import { formatKES, formatDate } from "@/lib/format";

type Supplier={id:string;name:string;is_active:boolean;status:string};
type Product={id:string;name:string;sku:string;cost_price:number|string;is_service:boolean;is_active:boolean;unit:string};
type Warehouse={id:string;name:string;code:string;is_active:boolean};
type Line={productId:string;quantity:string;unitCost:string;taxRate:string};
type Item={id:string;product_id:string;product_name:string;sku:string|null;quantity:string|number;received_quantity:string|number;unit_cost:string|number;line_total:string|number};
type PurchaseOrder={id:string;order_number:string;supplier_name:string;order_date:string;expected_date:string|null;status:"draft"|"ordered"|"partially_received"|"received"|"cancelled";approval_status?:"pending"|"approved"|"rejected"|"cancelled"|null;total:string|number;item_count:number;items?:Item[]};
type ReceiptItem={id:string;product_name:string;quantity:string|number;unit_cost:string|number;line_value:string|number};
type Receipt={id:string;warehouse_name:string;receipt_reference:string|null;notes:string|null;received_at:string;receipt_value:string|number;items:ReceiptItem[]};
const statusLabel:Record<PurchaseOrder["status"],string>={draft:"Draft",ordered:"Ordered",partially_received:"Partially received",received:"Received",cancelled:"Cancelled"};
function messageOf(e:unknown){return e&&typeof e==="object"&&"message" in e?String((e as {message:unknown}).message):"Request failed. Please try again."}
function statusStyle(s:PurchaseOrder["status"]){return s==="received"?"bg-emerald-500/10 text-emerald-700":s==="cancelled"?"bg-destructive/10 text-destructive":s==="partially_received"?"bg-amber-500/10 text-amber-700":s==="ordered"?"bg-blue-500/10 text-blue-700":"bg-muted text-muted-foreground"}
export default function PurchaseOrdersPage(){
 const [orders,setOrders]=React.useState<PurchaseOrder[]>([]);
 const [suppliers,setSuppliers]=React.useState<Supplier[]>([]);
 const [products,setProducts]=React.useState<Product[]>([]);
 const [warehouses,setWarehouses]=React.useState<Warehouse[]>([]);
 const [loading,setLoading]=React.useState(true);
 const [saving,setSaving]=React.useState(false);
 const [busyId,setBusyId]=React.useState("");
 const [error,setError]=React.useState("");
 const [showForm,setShowForm]=React.useState(false);
 const [supplierId,setSupplierId]=React.useState("");
 const [expectedDate,setExpectedDate]=React.useState("");
 const [notes,setNotes]=React.useState("");
 const [lines,setLines]=React.useState<Line[]>([{productId:"",quantity:"1",unitCost:"0",taxRate:"16"}]);
 const [receiveWarehouse,setReceiveWarehouse]=React.useState("");
 const [receivingOrder,setReceivingOrder]=React.useState<PurchaseOrder|null>(null);
 const [receiveItems,setReceiveItems]=React.useState<Item[]>([]);
 const [receiveQuantities,setReceiveQuantities]=React.useState<Record<string,string>>({});
 const [receiveReference,setReceiveReference]=React.useState("");
 const [receiveNotes,setReceiveNotes]=React.useState("");
 const [filter,setFilter]=React.useState("all");
 const [receiptOrder,setReceiptOrder]=React.useState<PurchaseOrder|null>(null);
 const [receiptHistory,setReceiptHistory]=React.useState<Receipt[]>([]);
 const [receiptsLoading,setReceiptsLoading]=React.useState(false);
 const refresh=React.useCallback(async()=>{
  setLoading(true);setError("");
  try{
   const [po,sup,prod,wh]=await Promise.all([
    api.get<PurchaseOrder[]>("/purchase-orders"),api.get<Supplier[]>("/suppliers"),api.get<Product[]>("/products"),api.get<Warehouse[]>("/inventory/warehouses")
   ]);
   setOrders(po);setSuppliers(sup.filter(s=>s.is_active&&s.status==="active"));setProducts(prod.filter(p=>p.is_active&&!p.is_service));setWarehouses(wh.filter(w=>w.is_active));
   setSupplierId(current=>current||sup.find(s=>s.is_active&&s.status==="active")?.id||"");
   setReceiveWarehouse(current=>wh.some(w=>w.id===current&&w.is_active)?current:wh.find(w=>w.is_active)?.id||"");
  }catch(e){setError(messageOf(e))}
  finally{setLoading(false)}
 },[]);
 React.useEffect(()=>{let active=true;void Promise.all([api.get<PurchaseOrder[]>("/purchase-orders"),api.get<Supplier[]>("/suppliers"),api.get<Product[]>("/products"),api.get<Warehouse[]>("/inventory/warehouses")]).then(([po,sup,prod,wh])=>{if(active){setOrders(po);setSuppliers(sup.filter(s=>s.is_active&&s.status==="active"));setProducts(prod.filter(p=>p.is_active&&!p.is_service));setWarehouses(wh.filter(w=>w.is_active));setSupplierId(current=>current||sup.find(s=>s.is_active&&s.status==="active")?.id||"");setReceiveWarehouse(current=>wh.some(w=>w.id===current&&w.is_active)?current:wh.find(w=>w.is_active)?.id||"");}}).catch(e=>{if(active)setError(messageOf(e));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[]);
 const updateLine=(index:number,key:keyof Line,value:string)=>{
  setLines(current=>current.map((line,i)=>i===index?{...line,[key]:value}:line));
  if(key==="productId"){const product=products.find(p=>p.id===value);if(product)setLines(current=>current.map((line,i)=>i===index?{...line,productId:value,unitCost:String(product.cost_price??0)}:line))}
 };
 const createOrder=async()=>{
  if(!supplierId||lines.some(l=>!l.productId||Number(l.quantity)<=0||Number(l.unitCost)<0)){setError("Choose a supplier and complete each product line with valid quantities and costs.");return}
  setSaving(true);setError("");
  try{
   await api.post("/purchase-orders",{supplierId,expectedDate:expectedDate||undefined,notes:notes.trim()||undefined,items:lines.map(l=>({productId:l.productId,quantity:Number(l.quantity),unitCost:Number(l.unitCost),taxRate:Number(l.taxRate||0)}))});
   setShowForm(false);setLines([{productId:"",quantity:"1",unitCost:"0",taxRate:"16"}]);setNotes("");setExpectedDate("");await refresh();
  }catch(e){setError(messageOf(e))}finally{setSaving(false)}
 };
 const submitForApproval=async(order:PurchaseOrder)=>{
  setBusyId(order.id);setError("");
  try{await api.post(`/approvals/purchase-orders/${order.id}/submit`,{});await refresh()}catch(e){setError(messageOf(e))}finally{setBusyId("")}
 };
 const changeStatus=async(order:PurchaseOrder,status:"cancelled")=>{
  setBusyId(order.id);setError("");
  try{await api.patch(`/purchase-orders/${order.id}/status`,{status});await refresh()}catch(e){setError(messageOf(e))}finally{setBusyId("")}
 };
 const receive=async(order:PurchaseOrder)=>{
  if(!receiveWarehouse){setError("Create and activate a warehouse before receiving stock.");return}
  setBusyId(order.id);setError("");
  try{
   const full=await api.get<PurchaseOrder>(`/purchase-orders/${order.id}`);
   const outstanding=(full.items??[]).filter(i=>Number(i.quantity)-Number(i.received_quantity)>0);
   if(!outstanding.length){setError("There are no outstanding quantities to receive.");return}
   setReceivingOrder(full);setReceiveItems(outstanding);
   setReceiveQuantities(Object.fromEntries(outstanding.map(i=>[i.id,""])));
   setReceiveReference(full.order_number);setReceiveNotes("");
  }catch(e){setError(messageOf(e))}finally{setBusyId("")}
 };
 const viewReceiptHistory=async(order:PurchaseOrder)=>{
  setReceiptOrder(order);setReceiptHistory([]);setReceiptsLoading(true);setError("");
  try{setReceiptHistory(await api.get<Receipt[]>(`/purchase-orders/${order.id}/receipts`))}
  catch(e){setError(messageOf(e));setReceiptOrder(null)}
  finally{setReceiptsLoading(false)}
 };
 const submitReceipt=async()=>{
  if(!receivingOrder||!receiveWarehouse)return;
  const items=receiveItems.map(i=>({itemId:i.id,quantity:Number(receiveQuantities[i.id]||0)})).filter(i=>i.quantity>0);
  if(!items.length){setError("Enter a quantity for at least one line to receive.");return}
  for(const item of items){
   const line=receiveItems.find(i=>i.id===item.itemId)!;
   const remaining=Number(line.quantity)-Number(line.received_quantity);
   if(item.quantity>remaining+0.0000001){setError(`Receipt quantity exceeds the remaining ${remaining} for ${line.product_name}.`);return}
  }
  setBusyId(receivingOrder.id);setError("");
  try{
   await api.post(`/purchase-orders/${receivingOrder.id}/receive`,{warehouseId:receiveWarehouse,items,reference:receiveReference.trim()||receivingOrder.order_number,notes:receiveNotes.trim()||undefined});
   setReceivingOrder(null);setReceiveItems([]);setReceiveQuantities({});await refresh();
   await viewReceiptHistory(receivingOrder);
  }catch(e){setError(messageOf(e))}finally{setBusyId("")}
 };
 const visible=orders.filter(o=>filter==="all"||o.status===filter);
 const openCount=orders.filter(o=>["draft","ordered","partially_received"].includes(o.status)).length;
 const receivedValue=orders.filter(o=>o.status==="received"||o.status==="partially_received").reduce((s,o)=>s+Number(o.total),0);
 return <BaseLayout><div className="flex flex-col gap-6 px-4 lg:px-6">
  <PageHeader title="Purchase Orders" description="Create draft supplier orders, submit them for approval, and track approved orders and warehouse receipts." action={<div className="flex gap-2"><Button variant="outline" onClick={()=>void refresh()} disabled={loading}><RefreshCw className="size-4"/>Refresh</Button><Button onClick={()=>setShowForm(v=>!v)}><Plus className="size-4"/>{showForm?"Close form":"New purchase order"}</Button></div>}/>
  {error&&<div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0"/>{error}</div>}
  <div className="grid gap-3 sm:grid-cols-3">
   <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Purchase orders</p><p className="text-2xl font-semibold tabular-nums">{orders.length}</p></CardContent></Card>
   <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Open orders</p><p className="text-2xl font-semibold tabular-nums">{openCount}</p></CardContent></Card>
   <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Received / partially received value</p><p className="text-2xl font-semibold tabular-nums">{formatKES(receivedValue)}</p></CardContent></Card>
  </div>
  {showForm&&<Card><CardContent className="flex flex-col gap-4 p-4">
   <div><h2 className="font-semibold">New purchase order</h2><p className="text-sm text-muted-foreground">Orders start as drafts and must be approved before they can be ordered or received.</p></div>
   {suppliers.length===0&&<p className="text-sm text-amber-700">Add an active supplier before creating a purchase order.</p>}
   <div className="grid gap-4 md:grid-cols-2">
    <div className="flex flex-col gap-2"><Label htmlFor="po-supplier">Supplier</Label><select id="po-supplier" className="h-9 rounded-md border bg-background px-3 text-sm" value={supplierId} onChange={e=>setSupplierId(e.target.value)}><option value="">Choose supplier</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
    <div className="flex flex-col gap-2"><Label htmlFor="po-date">Expected delivery</Label><Input id="po-date" type="date" value={expectedDate} onChange={e=>setExpectedDate(e.target.value)}/></div>
   </div>
   <div className="flex flex-col gap-3">
    <div className="flex items-center justify-between"><h3 className="text-sm font-medium">Order lines</h3><Button type="button" variant="outline" size="sm" onClick={()=>setLines(v=>[...v,{productId:"",quantity:"1",unitCost:"0",taxRate:"16"}])}><Plus className="size-3.5"/>Add line</Button></div>
    {lines.map((line,index)=><div key={index} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[minmax(180px,2fr)_100px_130px_100px_auto]">
     <div className="flex flex-col gap-1"><Label>Product</Label><select className="h-9 rounded-md border bg-background px-2 text-sm" value={line.productId} onChange={e=>updateLine(index,"productId",e.target.value)}><option value="">Choose product</option>{products.map(p=><option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}</select></div>
     <div className="flex flex-col gap-1"><Label>Quantity</Label><Input type="number" min="0.001" step="0.001" value={line.quantity} onChange={e=>updateLine(index,"quantity",e.target.value)}/></div>
     <div className="flex flex-col gap-1"><Label>Unit cost (KSh)</Label><Input type="number" min="0" step="0.01" value={line.unitCost} onChange={e=>updateLine(index,"unitCost",e.target.value)}/></div>
     <div className="flex flex-col gap-1"><Label>Tax %</Label><Input type="number" min="0" max="100" step="0.01" value={line.taxRate} onChange={e=>updateLine(index,"taxRate",e.target.value)}/></div>
     <div className="flex items-end"><Button type="button" variant="ghost" disabled={lines.length===1} onClick={()=>setLines(v=>v.filter((_,i)=>i!==index))}>Remove</Button></div>
    </div>)}
   </div>
   <div className="flex flex-col gap-2"><Label htmlFor="po-notes">Notes</Label><Input id="po-notes" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Optional delivery or supplier notes"/></div>
   <div className="flex justify-end"><Button onClick={()=>void createOrder()} disabled={saving||suppliers.length===0||products.length===0}>{saving?<Loader2 className="size-4 animate-spin"/>:<Plus className="size-4"/>}Create draft order</Button></div>
  </CardContent></Card>}
  {receivingOrder&&<Card><CardContent className="flex flex-col gap-4 p-4">
   <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">Receive stock — {receivingOrder.order_number}</h2><p className="text-sm text-muted-foreground">Enter only the quantities delivered now. Leave other lines blank to receive them later.</p></div><Button variant="ghost" onClick={()=>setReceivingOrder(null)} disabled={busyId===receivingOrder.id}>Close</Button></div>
   <div className="grid gap-3 sm:grid-cols-2"><div className="flex flex-col gap-1"><Label htmlFor="receipt-reference">Receipt reference</Label><Input id="receipt-reference" value={receiveReference} onChange={e=>setReceiveReference(e.target.value)} maxLength={120}/></div><div className="flex flex-col gap-1"><Label htmlFor="receipt-notes">Notes</Label><Input id="receipt-notes" value={receiveNotes} onChange={e=>setReceiveNotes(e.target.value)} maxLength={2000} placeholder="Optional delivery note"/></div></div>
   <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Product</TableHead><TableHead className="text-right">Ordered</TableHead><TableHead className="text-right">Received</TableHead><TableHead className="text-right">Remaining</TableHead><TableHead className="w-40">Receive now</TableHead></TableRow></TableHeader><TableBody>{receiveItems.map(item=>{const remaining=Number(item.quantity)-Number(item.received_quantity);return <TableRow key={item.id}><TableCell><div className="font-medium">{item.product_name}</div><div className="text-xs text-muted-foreground">{item.sku||"No SKU"}</div></TableCell><TableCell className="text-right tabular-nums">{Number(item.quantity)}</TableCell><TableCell className="text-right tabular-nums">{Number(item.received_quantity)}</TableCell><TableCell className="text-right tabular-nums">{remaining}</TableCell><TableCell><Input aria-label={`Receive quantity for ${item.product_name}`} type="number" min="0" max={remaining} step="0.001" value={receiveQuantities[item.id]??""} onChange={e=>setReceiveQuantities(current=>({...current,[item.id]:e.target.value}))} placeholder="0"/></TableCell></TableRow>})}</TableBody></Table></div>
   <div className="flex justify-end gap-2"><Button variant="outline" onClick={()=>setReceivingOrder(null)} disabled={busyId===receivingOrder.id}>Cancel</Button><Button onClick={()=>void submitReceipt()} disabled={busyId===receivingOrder.id||!receiveWarehouse}>{busyId===receivingOrder.id?<Loader2 className="size-4 animate-spin"/>:<Truck className="size-4"/>}Post receipt</Button></div>
  </CardContent></Card>}
  {receiptOrder&&<Card><CardContent className="flex flex-col gap-4 p-4">
   <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">Goods receipt history — {receiptOrder.order_number}</h2><p className="text-sm text-muted-foreground">Posted deliveries for this purchase order, including their warehouse and valuation.</p></div><Button variant="outline" onClick={()=>setReceiptOrder(null)}>Close history</Button></div>
   {receiptsLoading?<div className="flex justify-center py-6"><Loader2 className="size-5 animate-spin"/></div>:receiptHistory.length===0?<p className="py-4 text-sm text-muted-foreground">No posted receipts found for this purchase order.</p>:<div className="flex flex-col gap-3">{receiptHistory.map(receipt=><div key={receipt.id} className="rounded-lg border p-3">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-medium">{receipt.receipt_reference||"Goods receipt"}</p><p className="text-sm text-muted-foreground">{formatDate(receipt.received_at)} · {receipt.warehouse_name}</p>{receipt.notes&&<p className="mt-1 text-sm text-muted-foreground">{receipt.notes}</p>}</div><p className="font-semibold tabular-nums">{formatKES(Number(receipt.receipt_value))}</p></div>
    <div className="mt-3 overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Product</TableHead><TableHead className="text-right">Quantity</TableHead><TableHead className="text-right">Unit cost</TableHead><TableHead className="text-right">Line value</TableHead></TableRow></TableHeader><TableBody>{receipt.items.map(item=><TableRow key={item.id}><TableCell>{item.product_name}</TableCell><TableCell className="text-right tabular-nums">{Number(item.quantity)}</TableCell><TableCell className="text-right tabular-nums">{formatKES(Number(item.unit_cost))}</TableCell><TableCell className="text-right tabular-nums">{formatKES(Number(item.line_value))}</TableCell></TableRow>)}</TableBody></Table></div>
   </div>)}</div>}
  </CardContent></Card>}
  <Card><CardContent className="flex flex-col gap-4 p-4">
   <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold">Purchase order register</h2><p className="text-sm text-muted-foreground">Receiving updates stock levels and records a receipt movement atomically.</p></div><div className="flex items-center gap-2 text-sm"><Label htmlFor="po-receive-warehouse" className="whitespace-nowrap">Receive into</Label><select id="po-receive-warehouse" className="h-9 rounded-md border bg-background px-3 text-sm" value={receiveWarehouse} onChange={e=>setReceiveWarehouse(e.target.value)}><option value="">Choose warehouse</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}</select></div></div>
   <div className="flex justify-end"><select aria-label="Filter purchase order status" className="h-9 rounded-md border bg-background px-3 text-sm" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All statuses</option>{Object.entries(statusLabel).map(([s,l])=><option key={s} value={s}>{l}</option>)}</select></div>
   {loading?<div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground"/></div>:visible.length===0?<div className="flex flex-col items-center gap-2 py-12 text-center"><ClipboardList className="size-8 text-muted-foreground"/><p className="font-medium">{orders.length?"No orders in this status":"No purchase orders yet"}</p><p className="max-w-lg text-sm text-muted-foreground">{orders.length?"Choose another status filter.":"Create a purchase order to start tracking supplier deliveries."}</p></div>:<div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>PO #</TableHead><TableHead>Supplier</TableHead><TableHead>Order date</TableHead><TableHead>Expected</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Lines</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{visible.map(order=><TableRow key={order.id}><TableCell className="font-medium">{order.order_number}</TableCell><TableCell>{order.supplier_name}</TableCell><TableCell>{formatDate(order.order_date)}</TableCell><TableCell>{order.expected_date?formatDate(order.expected_date):"—"}</TableCell><TableCell><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusStyle(order.status)}`}>{statusLabel[order.status]}</span></TableCell><TableCell className="text-right tabular-nums">{order.item_count}</TableCell><TableCell className="text-right font-medium tabular-nums">{formatKES(Number(order.total))}</TableCell><TableCell><div className="flex justify-end gap-1"><Button size="sm" variant="ghost" disabled={busyId===order.id} onClick={()=>void viewReceiptHistory(order)}><ClipboardList className="size-3.5"/>Receipts</Button>{order.status==="draft"&&(order.approval_status==="pending"?<Button size="sm" variant="outline" disabled><ShieldCheck className="size-3.5"/>Awaiting approval</Button>:<Button size="sm" variant="outline" disabled={busyId===order.id} onClick={()=>void submitForApproval(order)}>{busyId===order.id?<Loader2 className="size-3.5 animate-spin"/>:<ShieldCheck className="size-3.5"/>}Submit for approval</Button>)}{["ordered","partially_received"].includes(order.status)&&<Button size="sm" variant="outline" disabled={busyId===order.id||!receiveWarehouse} onClick={()=>void receive(order)}>{busyId===order.id?<Loader2 className="size-3.5 animate-spin"/>:<Truck className="size-3.5"/>}Receive</Button>}{["draft","ordered"].includes(order.status)&&order.approval_status!=="pending"&&<Button size="sm" variant="ghost" disabled={busyId===order.id} onClick={()=>void changeStatus(order,"cancelled")}>Cancel</Button>}</div></TableCell></TableRow>)}</TableBody></Table></div>}
  </CardContent></Card>
 </div></BaseLayout>;
}
