import { neonTestLogin } from "./neon-test-auth.mjs";

if (process.env.OMEGA_LIVE_SMOKE_CONFIRM_ISOLATED_TEST_DATABASE !== "YES") {
  throw new Error("Refusing to write business data: explicitly confirm an isolated disposable test database with OMEGA_LIVE_SMOKE_CONFIRM_ISOLATED_TEST_DATABASE=YES.");
}
const configuredBase = process.env.OMEGA_API_URL?.trim();
if (!configuredBase) throw new Error("OMEGA_API_URL is required; refusing to default to a shared or production API.");
const base = configuredBase.replace(/\/$/, "");
const target = new URL(base);
if (target.protocol !== "https:" || target.pathname.replace(/\/$/, "") !== "/api" || ["omega-solutions-erp-9k9s.vercel.app", "omega-solutions-erp-9k9s-coll5.vercel.app"].includes(target.hostname) || !target.hostname.endsWith("-coll5.vercel.app")) throw new Error("OMEGA_API_URL must be an approved HTTPS development API URL ending in /api.");
const stamp=Date.now();
const checks=[];
async function req(method,path,body,token,expected=[200,201]){
 const response=await fetch(base+path,{method,headers:{"content-type":"application/json",...(token?{authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const raw=await response.text();let data;try{data=raw?JSON.parse(raw):null}catch{data=raw}
 if(!expected.includes(response.status))throw new Error(`${method} ${path}: expected ${expected}, got ${response.status}: ${JSON.stringify(data).slice(0,400)}`);
 return data;
}
function ok(condition,message){if(!condition)throw new Error(message);checks.push(message)}
const near=(a,b,tolerance=0.02)=>Math.abs(Number(a)-Number(b))<=tolerance;
const rowsOf=value=>Array.isArray(value)?value:(value?.items||value?.data||[]);
try{
 let health=null,lastHealthError=null;
 for(let i=0;i<12;i++){
  try{health=await req("GET","/health");if(health?.status==="ok"&&health?.database==="connected")break;health=null}
  catch(error){lastHealthError=error}
  await new Promise(resolve=>setTimeout(resolve,5000));
 }
 ok(health?.status==="ok"&&health?.database==="connected",`live API health and Neon database connected${lastHealthError?": "+lastHealthError.message:""}`);
 const login=await neonTestLogin(base,{slot:"B"});
 const token=login.token;
 ok(!!token&&!!login.refreshToken,"authenticate an existing verified account without registration");
 const me=await req("GET","/auth/me",undefined,token);
 ok(me.userId===login.user.userId&&me.companyId===login.user.companyId,"authenticated tenant context preserved");
 const baseline=await req("GET","/inventory/reconciliation",undefined,token);
 ok(baseline.companyId===me.companyId,"baseline inventory reconciliation scoped to the authenticated company");

 const material=await req("POST","/products",{sku:`MFG-MAT-${stamp}`,name:`MFG Test Material ${stamp}`,sellingPrice:200,costPrice:0,stockQuantity:0,reorderLevel:0,isService:false,isActive:true},token,[201]);
 const finished=await req("POST","/products",{sku:`MFG-FG-${stamp}`,name:`MFG Test Finished ${stamp}`,sellingPrice:600,costPrice:0,stockQuantity:0,reorderLevel:0,isService:false,isActive:true},token,[201]);
 ok(!!material.id&&!!finished.id&&material.id!==finished.id,"create isolated material and finished-good products");
 const warehouse=await req("POST","/inventory/warehouses",{code:`MFG${String(stamp).slice(-8)}`,name:`MFG Test Warehouse ${stamp}`,location:"Automated manufacturing valuation regression",capacity:0,isActive:true},token,[201]);
 ok(!!warehouse.id,"create isolated manufacturing test warehouse");

 const supplier=await req("POST","/suppliers",{name:`MFG Test Supplier ${stamp}`,email:`mfg-supplier-${stamp}@example.com`},token,[201]);
 ok(!!supplier.id,"create supplier for accounted material receipts");
 async function receiveMaterial(quantity,unitCost,reference){
  const po=await req("POST","/purchase-orders",{supplierId:supplier.id,expectedDate:new Date(Date.now()+86400000).toISOString().slice(0,10),notes:"Manufacturing valuation smoke test",items:[{productId:material.id,quantity,unitCost,taxRate:0}]},token,[201]);
  const line=po.items?.[0];
  ok(!!po.id&&!!line?.id,"create purchase order for material cost layer");
  const ordered=await req("PATCH",`/purchase-orders/${po.id}/status`,{status:"ordered"},token);
  ok(ordered.status==="ordered","order material purchase for receipt");
  const receipt=await req("POST",`/purchase-orders/${po.id}/receive`,{warehouseId:warehouse.id,items:[{itemId:line.id,quantity}],reference},token,[201]);
  ok(receipt.status==="received"&&!!receipt.receiptId,"receive material through purchasing with inventory/GRNI accounting");
  const journals=rowsOf(await req("GET","/accounting/journals",undefined,token));
  const journal=journals.find(x=>x.source_type==="purchase_order_receipt"&&x.source_id===receipt.receiptId);
  ok(!!journal&&near(journal.total_debits,quantity*unitCost)&&near(journal.total_credits,quantity*unitCost),"purchasing receipt creates a balanced inventory/GRNI journal");
 }
 await receiveMaterial(4,100,`MFG-RECEIPT-A-${stamp}`);
 await receiveMaterial(2,200,`MFG-RECEIPT-B-${stamp}`);
 let stock=rowsOf(await req("GET",`/inventory/stock?warehouseId=${warehouse.id}`,undefined,token));
 const materialBefore=stock.find(x=>(x.product_id||x.productId)===material.id);
 ok(!!materialBefore&&near(materialBefore.quantity,6,0.001)&&near(materialBefore.average_unit_cost,133.3333),"six material units carry weighted-average KES 133.33 after receipts at KES 100 and KES 200");

 const bom=await req("POST","/manufacturing/boms",{code:`MFG-${String(stamp).slice(-10)}`,name:`MFG Weighted Average BOM ${stamp}`,productId:finished.id,outputQuantity:1,lines:[{materialProductId:material.id,quantity:2,wastePercent:0}],notes:"Live manufacturing valuation regression"},token,[201]);
 ok(!!bom.id&&bom.lines?.length===1,"create BOM requiring two material units per finished unit");
 const order=await req("POST","/manufacturing/orders",{bomId:bom.id,warehouseId:warehouse.id,plannedQuantity:1,plannedStartDate:new Date().toISOString().slice(0,10),notes:"Live manufacturing weighted-average integration test"},token,[201]);
 ok(!!order.id&&order.status==="planned","create planned production order");
 const started=await req("POST",`/manufacturing/orders/${order.id}/start`,{},token);
 ok(started.status==="in_progress","start production and reserve required materials");
 stock=rowsOf(await req("GET",`/inventory/stock?warehouseId=${warehouse.id}`,undefined,token));
 const reserved=stock.find(x=>(x.product_id||x.productId)===material.id);
 ok(!!reserved&&near(reserved.quantity,6,0.001)&&near(reserved.reserved_quantity,2,0.001)&&near(reserved.available_quantity,4,0.001),"reserve two units without changing on-hand stock or allowing reserved stock to be sold");
 const completed=await req("POST",`/manufacturing/orders/${order.id}/complete`,{},token);
 ok(completed.status==="completed"&&near(completed.produced_quantity,1),"complete production and record one finished unit");

 stock=rowsOf(await req("GET",`/inventory/stock?warehouseId=${warehouse.id}`,undefined,token));
 const materialAfter=stock.find(x=>(x.product_id||x.productId)===material.id);
 const finishedAfter=stock.find(x=>(x.product_id||x.productId)===finished.id);
 ok(!!materialAfter&&near(materialAfter.quantity,4,0.001)&&near(materialAfter.reserved_quantity,0,0.001),"material consumption leaves four units and releases its reservation");
 ok(!!finishedAfter&&near(finishedAfter.quantity,1,0.001)&&near(finishedAfter.average_unit_cost,266.67),"finished goods are valued at KES 266.67 using the consumed weighted-average material cost");
 const finishedProduct=await req("GET",`/products/${finished.id}`,undefined,token);
 ok(near(finishedProduct.stockQuantity??finishedProduct.stock_quantity,1,0.001)&&near(finishedProduct.costPrice??finishedProduct.cost_price,266.67),"legacy product quantity and cost price sync with warehouse valuation");

 const journals=rowsOf(await req("GET","/accounting/journals",undefined,token));
 const materialJournal=journals.find(x=>x.source_type==="manufacturing_material_consumption"&&x.source_id===order.id);
 const finishedJournal=journals.find(x=>x.source_type==="manufacturing_finished_goods"&&x.source_id===order.id);
 ok(!!materialJournal&&near(materialJournal.total_debits,266.67)&&near(materialJournal.total_credits,266.67),"material consumption posts a balanced KES 266.67 WIP/inventory journal");
 ok(!!finishedJournal&&near(finishedJournal.total_debits,266.67)&&near(finishedJournal.total_credits,266.67),"finished-goods receipt posts a balanced KES 266.67 inventory/WIP journal");
 const materialDetail=await req("GET",`/accounting/journals/${materialJournal.id}`,undefined,token);
 const finishedDetail=await req("GET",`/accounting/journals/${finishedJournal.id}`,undefined,token);
 ok(materialDetail.lines.some(x=>x.account_code==="1250"&&near(x.debit,266.67))&&materialDetail.lines.some(x=>x.account_code==="1200"&&near(x.credit,266.67)),"material journal debits WIP and credits inventory");
 ok(finishedDetail.lines.some(x=>x.account_code==="1200"&&near(x.debit,266.67))&&finishedDetail.lines.some(x=>x.account_code==="1250"&&near(x.credit,266.67)),"finished-goods journal debits inventory and credits WIP");

 const movementResult=await req("GET","/inventory/movements?limit=250",undefined,token);
 const movements=rowsOf(movementResult);
 ok(movements.some(x=>x.reference===`MO-${order.id}`&&x.product_id===material.id&&x.movement_type==="issue"&&near(Math.abs(Number(x.quantity)),2,0.001)),"one material issue movement is recorded for production");
 ok(movements.some(x=>x.reference===`MO-${order.id}`&&x.product_id===finished.id&&x.movement_type==="receipt"&&near(x.quantity,1,0.001)),"one finished-goods receipt movement is recorded");
 await req("POST",`/manufacturing/orders/${order.id}/complete`,{},token,[409]);
 ok(true,"duplicate production completion rejected");

 const after=await req("GET","/inventory/reconciliation",undefined,token);
 ok(after.companyId===me.companyId,"post-production reconciliation remains tenant-scoped");
 ok(after.stockLedger?.reconciled===true&&after.legacyProductQuantities?.reconciled===true,"stock movement ledger and legacy product quantities reconcile after production");
 ok(near(after.valuation?.variance,baseline.valuation?.variance,0.10),`manufacturing transfer keeps valuation variance within KES 0.10 rounding tolerance (before=${baseline.valuation?.variance}, after=${after.valuation?.variance}, stock value before=${baseline.valuation?.stockCostValue}, after=${after.valuation?.stockCostValue}, inventory account before=${baseline.valuation?.inventoryAccountBalance}, after=${after.valuation?.inventoryAccountBalance})`);
 const trial=await req("GET","/accounting/reports/trial-balance",undefined,token);
 ok(!!trial,"trial balance remains accessible after manufacturing journals");
 console.log(JSON.stringify({ok:true,checksPassed:checks.length,checks,productionOrderId:order.id,materialAverageUnitCost:Number(materialBefore.average_unit_cost),materialRemaining:Number(materialAfter.quantity),finishedGoodsQuantity:Number(finishedAfter.quantity),finishedGoodsAverageUnitCost:Number(finishedAfter.average_unit_cost),materialJournalTotal:Number(materialJournal.total_debits),finishedGoodsJournalTotal:Number(finishedJournal.total_debits),valuationVarianceBefore:Number(baseline.valuation.variance),valuationVarianceAfter:Number(after.valuation.variance)},null,2));
}catch(error){console.error(JSON.stringify({ok:false,error:error.message,checksPassed:checks.length,checks},null,2));process.exitCode=1}
