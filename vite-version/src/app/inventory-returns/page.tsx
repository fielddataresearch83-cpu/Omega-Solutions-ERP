import * as React from "react"
import { ArrowDownToLine, ClipboardList, RefreshCw, CheckCircle2, XCircle } from "lucide-react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { api } from "@/lib/api-client"
import { formatDate, formatNumber } from "@/lib/format"

type Warehouse={id:string;code:string;name:string;is_active:boolean}
type Product={id:string;name:string;sku:string;cost_price:number|string;is_active?:boolean;is_service?:boolean}
type Party={id:string;name:string;is_active?:boolean}
type ReturnLine={id:string;product_id:string;product_name:string;sku:string;quantity:string|number;unit_cost:string|number;disposition:string;inspection_notes:string|null}
type InventoryReturn={id:string;return_number:string;return_type:"customer"|"supplier";customer_id:string|null;supplier_id:string|null;customer_name:string|null;supplier_name:string|null;warehouse_id:string;warehouse_name:string;source_reference:string|null;reason:string;status:"draft"|"posted"|"cancelled";created_at:string;items?:ReturnLine[]}
function errorText(e:unknown){return e&&typeof e==="object"&&"message"in e?String((e as {message:unknown}).message):"Request failed."}

export default function InventoryReturnsPage(){
 const [returns,setReturns]=React.useState<InventoryReturn[]>([])
 const [warehouses,setWarehouses]=React.useState<Warehouse[]>([])
 const [products,setProducts]=React.useState<Product[]>([])
 const [customers,setCustomers]=React.useState<Party[]>([])
 const [suppliers,setSuppliers]=React.useState<Party[]>([])
 const [selected,setSelected]=React.useState<InventoryReturn|null>(null)
 const [returnType,setReturnType]=React.useState<"customer"|"supplier">("customer")
 const [warehouseId,setWarehouseId]=React.useState("")
 const [partyId,setPartyId]=React.useState("")
 const [productId,setProductId]=React.useState("")
 const [quantity,setQuantity]=React.useState("1")
 const [unitCost,setUnitCost]=React.useState("")
 const [disposition,setDisposition]=React.useState("restock")
 const [reason,setReason]=React.useState("")
 const [sourceReference,setSourceReference]=React.useState("")
 const [inspectionNotes,setInspectionNotes]=React.useState("")
 const [loading,setLoading]=React.useState(true),[saving,setSaving]=React.useState(false)
 const [error,setError]=React.useState(""),[notice,setNotice]=React.useState("")
 const load=React.useCallback(async()=>{
  setLoading(true);setError("")
  try{
   const [r,w,p,c,s]=await Promise.all([
    api.get<InventoryReturn[]>("/inventory/returns"),
    api.get<Warehouse[]>("/inventory/warehouses"),
    api.get<Product[]>("/products"),
    api.get<Party[]>("/customers"),
    api.get<Party[]>("/suppliers"),
   ])
   setReturns(r);setWarehouses(w.filter(x=>x.is_active));setProducts(p.filter(x=>x.is_active!==false&&!x.is_service));setCustomers(c.filter(x=>x.is_active!==false));setSuppliers(s.filter(x=>x.is_active!==false))
   setWarehouseId(current=>current||w.find(x=>x.is_active)?.id||"")
  }catch(e){setError(errorText(e))}finally{setLoading(false)}
 },[])
 React.useEffect(()=>{void load()},[load])
 React.useEffect(()=>{setPartyId("");setDisposition(returnType==="customer"?"restock":"return_to_supplier")},[returnType])
 React.useEffect(()=>{const p=products.find(x=>x.id===productId);if(p&&unitCost==="")setUnitCost(String(p.cost_price??0))},[productId,products,unitCost])
 async function create(e:React.FormEvent){
  e.preventDefault();setSaving(true);setError("");setNotice("")
  try{
   const payload={returnType,customerId:returnType==="customer"?partyId:undefined,supplierId:returnType==="supplier"?partyId:undefined,warehouseId,sourceReference:sourceReference.trim()||undefined,reason:reason.trim(),items:[{productId,quantity:Number(quantity),unitCost:Number(unitCost),disposition,inspectionNotes:inspectionNotes.trim()||undefined}]}
   const created=await api.post<InventoryReturn>("/inventory/returns",payload)
   setSelected(created);setReason("");setSourceReference("");setInspectionNotes("");setQuantity("1");setUnitCost("")
   await load();setNotice("Draft return recorded. Review the inspection and post it when ready.")
  }catch(e){setError(errorText(e))}finally{setSaving(false)}
 }
 async function open(id:string){setError("");try{setSelected(await api.get<InventoryReturn>("/inventory/returns/"+id))}catch(e){setError(errorText(e))}}
 async function action(kind:"post"|"cancel"){
  if(!selected)return;setSaving(true);setError("");setNotice("")
  try{const next=await api.post<InventoryReturn>("/inventory/returns/"+selected.id+"/"+kind,{});setSelected(next);await load();setNotice(kind==="post"?"Return posted. Inventory, movement and accounting entries have been updated where applicable.":"Draft return cancelled.")}
  catch(e){setError(errorText(e))}finally{setSaving(false)}
 }
 const parties=returnType==="customer"?customers:suppliers
 const availableDispositions=returnType==="customer"?["restock","quarantine","reject"]:["return_to_supplier","quarantine"]
 return <BaseLayout><div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-6 px-4 sm:px-6 lg:px-8">
  <PageHeader title="Physical Returns" description="Record customer and supplier goods returns, inspect condition, quarantine items or post stock movements." action={<Button variant="outline" onClick={()=>void load()} disabled={loading||saving}><RefreshCw className="mr-2 size-4"/>Refresh</Button>}/>
  {error&&<div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
  {notice&&<p role="status" className="text-sm text-emerald-700">{notice}</p>}
  <Card><CardHeader><CardTitle><ArrowDownToLine className="mr-2 inline size-5"/>Record a physical return</CardTitle></CardHeader><CardContent>
   <form onSubmit={create} className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
    <label className="grid gap-1 text-sm">Return type<select className="h-9 rounded-md border bg-background px-3" value={returnType} onChange={e=>setReturnType(e.target.value as "customer"|"supplier")}><option value="customer">Customer return</option><option value="supplier">Supplier return</option></select></label>
    <label className="grid gap-1 text-sm">{returnType==="customer"?"Customer":"Supplier"}<select required className="h-9 rounded-md border bg-background px-3" value={partyId} onChange={e=>setPartyId(e.target.value)}><option value="">Select {returnType}</option>{parties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <label className="grid gap-1 text-sm">Warehouse<select required className="h-9 rounded-md border bg-background px-3" value={warehouseId} onChange={e=>setWarehouseId(e.target.value)}><option value="">Select warehouse</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}</select></label>
    <label className="grid gap-1 text-sm">Product<select required className="h-9 rounded-md border bg-background px-3" value={productId} onChange={e=>{setProductId(e.target.value);setUnitCost("")}}><option value="">Select product</option>{products.map(p=><option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}</select></label>
    <label className="grid gap-1 text-sm">Quantity<Input required type="number" min="0.0001" step="0.0001" value={quantity} onChange={e=>setQuantity(e.target.value)}/></label>
    <label className="grid gap-1 text-sm">Unit cost (KES)<Input required type="number" min="0" step="0.0001" value={unitCost} onChange={e=>setUnitCost(e.target.value)} /></label>
    <label className="grid gap-1 text-sm">Inspection disposition<select className="h-9 rounded-md border bg-background px-3" value={disposition} onChange={e=>setDisposition(e.target.value)}>{availableDispositions.map(d=><option key={d} value={d}>{d.replaceAll("_"," ")}</option>)}</select></label>
    <label className="grid gap-1 text-sm">Original invoice / supplier reference (optional)<Input value={sourceReference} onChange={e=>setSourceReference(e.target.value)} maxLength={120}/></label>
    <label className="grid gap-1 text-sm md:col-span-2 xl:col-span-3">Reason<Input required value={reason} onChange={e=>setReason(e.target.value)} maxLength={1000} placeholder="Reason for return"/></label>
    <label className="grid gap-1 text-sm md:col-span-2 xl:col-span-3">Inspection notes<Input value={inspectionNotes} onChange={e=>setInspectionNotes(e.target.value)} maxLength={2000} placeholder="Condition, damage, batch or quality observations"/></label>
    <div className="md:col-span-2 xl:col-span-3"><Button disabled={saving||!warehouseId||!partyId||!productId||!reason.trim()||!unitCost.trim()}>{saving?"Saving…":"Save draft return"}</Button></div>
   </form>
   <p className="mt-3 text-xs text-muted-foreground">Customer returns can be restocked, quarantined or rejected. Supplier returns can be quarantined or dispatched back to the supplier. Only posted returns change inventory.</p>
  </CardContent></Card>
  <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
   <Card><CardHeader><CardTitle>Return register</CardTitle></CardHeader><CardContent>{loading?<p className="text-sm text-muted-foreground">Loading returns…</p>:returns.length===0?<p className="text-sm text-muted-foreground">No physical returns recorded.</p>:<div className="space-y-2">{returns.map(r=><button type="button" key={r.id} onClick={()=>void open(r.id)} className={"w-full rounded-md border p-3 text-left text-sm "+(selected?.id===r.id?"border-primary bg-muted/50":"")}><div className="font-medium">{r.return_number}</div><div className="text-xs text-muted-foreground">{r.return_type==="customer"?r.customer_name:r.supplier_name} · {r.warehouse_name}</div><div className="mt-1 flex justify-between text-xs"><span className="capitalize">{r.status}</span><span>{formatDate(r.created_at)}</span></div></button>)}</div>}</CardContent></Card>
   <Card><CardHeader><CardTitle>{selected?selected.return_number:"Return details"}</CardTitle></CardHeader><CardContent>{!selected?<p className="text-sm text-muted-foreground">Select a return to inspect its lines and posting status.</p>:<><div className="mb-4 flex flex-wrap items-center justify-between gap-2"><div className="text-sm text-muted-foreground">{selected.reason} · {selected.warehouse_name}</div><div className="flex gap-2">{selected.status==="draft"&&<><Button size="sm" variant="outline" disabled={saving} onClick={()=>void action("cancel")}><XCircle className="mr-1 size-4"/>Cancel</Button><Button size="sm" disabled={saving} onClick={()=>void action("post")}><CheckCircle2 className="mr-1 size-4"/>Post return</Button></>}</div></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-2">Product</th><th className="p-2 text-right">Qty</th><th className="p-2 text-right">Unit cost</th><th className="p-2">Disposition</th><th className="p-2">Inspection</th></tr></thead><tbody>{(selected.items??[]).map(line=><tr key={line.id} className="border-b"><td className="p-2"><div className="font-medium">{line.product_name}</div><div className="text-xs text-muted-foreground">{line.sku}</div></td><td className="p-2 text-right tabular-nums">{formatNumber(Number(line.quantity))}</td><td className="p-2 text-right tabular-nums">{formatNumber(Number(line.unit_cost))}</td><td className="p-2 capitalize">{line.disposition.replaceAll("_"," ")}</td><td className="p-2 text-muted-foreground">{line.inspection_notes||"—"}</td></tr>)}</tbody></table></div></>}</CardContent></Card>
  </div>
 </div></BaseLayout>
}
