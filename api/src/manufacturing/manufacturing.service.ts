import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';
import type { CreateBomDto, CreateProductionOrderDto, CreateProductionCostDto } from './dto/manufacturing.dto.js';

@Injectable()
export class ManufacturingService {
 constructor(private readonly db:DatabaseService,private readonly memberships:MembershipsService,private readonly audit:AuditService){}
 private companyFor(user:AuthenticatedUser){return user.companyId?this.memberships.getMembershipForCompany(user.userId,user.companyId):this.memberships.getMembership(user.userId);}
 private async postJournal(client: import('pg').PoolClient,input:{companyId:string;description:string;sourceType:string;sourceId:string;userId:string;amount:number;debitSystem:string;creditSystem?:string;creditAccountId?:string}) {
  const amount=Math.round(input.amount*100)/100;
  if(amount<=0)return null;
  await client.query(`INSERT INTO chart_of_accounts(company_id,code,name,account_type,normal_side,system_code)
   VALUES($1,'1200','Inventory','asset','debit','inventory') ON CONFLICT(company_id,code) DO NOTHING`,[input.companyId]);
  await client.query(`INSERT INTO chart_of_accounts(company_id,code,name,account_type,normal_side,system_code)
   VALUES($1,'1250','Work in Progress','asset','debit','work_in_progress') ON CONFLICT(company_id,code) DO NOTHING`,[input.companyId]);
  const year=new Date().getFullYear();
  const seq=await client.query<{next_number:number}>(`INSERT INTO journal_entry_sequences(company_id,entry_year,next_number) VALUES($1,$2,1)
   ON CONFLICT(company_id,entry_year) DO UPDATE SET next_number=journal_entry_sequences.next_number+1 RETURNING next_number`,[input.companyId,year]);
  const number=`JE-${year}-${String(seq.rows[0].next_number).padStart(6,'0')}`;
  const entry=await client.query<{id:string}>(`INSERT INTO journal_entries(company_id,entry_number,entry_date,description,source_type,source_id,status,posted_at,posted_by)
   VALUES($1,$2,CURRENT_DATE,$3,$4,$5,'posted',NOW(),$6) RETURNING id`,
   [input.companyId,number,input.description,input.sourceType,input.sourceId,input.userId]);
  for(const line of [
   {system:input.debitSystem,debit:amount,credit:0},
   {system:input.creditSystem,accountId:input.creditAccountId,debit:0,credit:amount},
  ]){
   const account=line.accountId
    ? await client.query<{id:string}>(`SELECT id FROM chart_of_accounts WHERE company_id=$1 AND id=$2 AND is_active=true`,[input.companyId,line.accountId])
    : await client.query<{id:string}>(`SELECT id FROM chart_of_accounts WHERE company_id=$1 AND system_code=$2 AND is_active=true`,[input.companyId,line.system]);
   if(!account.rows[0])throw new BadRequestException(`Required accounting account "${line.system}" is missing or inactive.`);
   await client.query(`INSERT INTO journal_entry_lines(company_id,journal_entry_id,account_id,description,debit,credit) VALUES($1,$2,$3,$4,$5,$6)`,
    [input.companyId,entry.rows[0].id,account.rows[0].id,input.description,line.debit,line.credit]);
  }
  return entry.rows[0].id;
 }
 async listBoms(user:AuthenticatedUser){
  const {companyId}=await this.companyFor(user);
  return (await this.db.query(`SELECT b.id,b.company_id,b.code,b.name,b.product_id,p.name AS product_name,b.output_quantity,b.version,b.status,b.notes,b.created_at,b.updated_at,COUNT(bl.id)::int AS line_count
   FROM manufacturing_boms b JOIN products p ON p.id=b.product_id AND p.company_id=b.company_id
   LEFT JOIN manufacturing_bom_lines bl ON bl.bom_id=b.id AND bl.company_id=b.company_id
   WHERE b.company_id=$1 GROUP BY b.id,p.name ORDER BY b.updated_at DESC`,[companyId])).rows;
 }
 async getBom(user:AuthenticatedUser,id:string){
  const {companyId}=await this.companyFor(user);
  const result=await this.db.query(`SELECT b.id,b.company_id,b.code,b.name,b.product_id,p.name AS product_name,b.output_quantity,b.version,b.status,b.notes,b.created_at,b.updated_at
   FROM manufacturing_boms b JOIN products p ON p.id=b.product_id AND p.company_id=b.company_id WHERE b.company_id=$1 AND b.id=$2`,[companyId,id]);
  if(!result.rows[0])throw new NotFoundException('Bill of materials not found.');
  const lines=await this.db.query(`SELECT l.id,l.material_product_id,p.name AS material_name,p.sku,l.quantity,l.waste_percent,l.notes
   FROM manufacturing_bom_lines l JOIN products p ON p.id=l.material_product_id AND p.company_id=l.company_id
   WHERE l.company_id=$1 AND l.bom_id=$2 ORDER BY p.name`,[companyId,id]);
  return {...result.rows[0],lines:lines.rows};
 }
 async createBom(user:AuthenticatedUser,dto:CreateBomDto){
  const {companyId,branchId}=await this.companyFor(user);
  const code=dto.code.trim().toUpperCase(),name=dto.name.trim();
  if(!code||!name)throw new BadRequestException('BOM code and name are required.');
  if(new Set(dto.lines.map(x=>x.materialProductId)).size!==dto.lines.length)throw new BadRequestException('A material may only appear once in a BOM.');
  if(dto.lines.some(x=>x.materialProductId===dto.productId))throw new BadRequestException('The finished product cannot be a component of its own BOM.');
  let createdId:string;
  try{
   createdId=await this.db.transaction(async client=>{
    const ids=[dto.productId,...dto.lines.map(x=>x.materialProductId)];
    const products=await client.query<{id:string;is_service:boolean;name:string}>(`SELECT id,is_service,name FROM products WHERE company_id=$1 AND id=ANY($2::uuid[]) FOR SHARE`,[companyId,ids]);
    if(products.rows.length!==new Set(ids).size)throw new BadRequestException('The finished product or a material does not belong to the active company.');
    if(products.rows.some(p=>p.is_service))throw new BadRequestException('Service items cannot be used as manufactured products or stock materials.');
    const result=await client.query<{id:string}>(`INSERT INTO manufacturing_boms(company_id,code,name,product_id,output_quantity,notes,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,[companyId,code,name,dto.productId,dto.outputQuantity,dto.notes?.trim()||null,user.userId]);
    for(const line of dto.lines)await client.query(`INSERT INTO manufacturing_bom_lines(company_id,bom_id,material_product_id,quantity,waste_percent,notes)
     VALUES($1,$2,$3,$4,$5,$6)`,[companyId,result.rows[0].id,line.materialProductId,line.quantity,line.wastePercent??0,line.notes?.trim()||null]);
    await this.audit.logInTransaction(client,{userId:user.userId,companyId,branchId,action:'manufacturing.bom.create',entityType:'manufacturing_bom',entityId:result.rows[0].id,oldValues:null,newValues:{code,name,productId:dto.productId,lines:dto.lines.length},ipAddress:null});
    return result.rows[0].id;
   });
  }catch(e){if((e as {code?:string}).code==='23505')throw new ConflictException('A BOM with this code already exists in this company.');throw e;}
  return this.getBom(user,createdId);
 }
 async listOrders(user:AuthenticatedUser){
  const {companyId,branchId}=await this.companyFor(user);
  return (await this.db.query(`SELECT o.id,o.company_id,o.order_number,o.bom_id,b.code AS bom_code,b.name AS bom_name,b.product_id,p.name AS product_name,o.warehouse_id,w.name AS warehouse_name,o.planned_quantity,o.produced_quantity,o.status,o.planned_start_date,o.planned_end_date,o.actual_start_at,o.completed_at,o.notes,o.created_at,o.updated_at,COALESCE((SELECT SUM(m.required_quantity*m.unit_cost) FROM manufacturing_order_materials m WHERE m.company_id=o.company_id AND m.production_order_id=o.id),0)::numeric AS estimated_material_cost,
   COALESCE((SELECT SUM(c.amount) FROM manufacturing_order_costs c WHERE c.company_id=o.company_id AND c.production_order_id=o.id AND c.cost_type='labour'),0)::numeric AS labour_cost,
   COALESCE((SELECT SUM(c.amount) FROM manufacturing_order_costs c WHERE c.company_id=o.company_id AND c.production_order_id=o.id AND c.cost_type='overhead'),0)::numeric AS overhead_cost
   FROM manufacturing_production_orders o JOIN manufacturing_boms b ON b.id=o.bom_id AND b.company_id=o.company_id
   JOIN products p ON p.id=b.product_id AND p.company_id=o.company_id JOIN warehouses w ON w.id=o.warehouse_id AND w.company_id=o.company_id
   WHERE o.company_id=$1 AND ($2::uuid IS NULL OR w.branch_id=$2) ORDER BY o.created_at DESC LIMIT 200`,[companyId,branchId])).rows;
 }
 async createOrder(user:AuthenticatedUser,dto:CreateProductionOrderDto){
  const {companyId,branchId}=await this.companyFor(user);
  if(dto.plannedStartDate&&dto.plannedEndDate&&dto.plannedEndDate<dto.plannedStartDate)throw new BadRequestException('Planned end date cannot be before start date.');
  const orderId=await this.db.transaction(async client=>{
   const bom=await client.query<{id:string;output_quantity:string|number;product_id:string}>(`SELECT id,output_quantity,product_id FROM manufacturing_boms WHERE company_id=$1 AND id=$2 AND status='active' FOR SHARE`,[companyId,dto.bomId]);
   if(!bom.rows[0])throw new NotFoundException('Active bill of materials not found.');
   const warehouse=await client.query(`SELECT id FROM warehouses WHERE company_id=$1 AND id=$2 AND is_active=true AND ($3::uuid IS NULL OR branch_id=$3) FOR SHARE`,[companyId,dto.warehouseId,branchId]);
   if(!warehouse.rows[0])throw new NotFoundException('Active warehouse not found in this company.');
   const nowYear=new Date().getFullYear();
   const seq=await client.query<{next_number:number}>(`INSERT INTO manufacturing_order_sequences(company_id,entry_year,next_number) VALUES($1,$2,1)
    ON CONFLICT(company_id,entry_year) DO UPDATE SET next_number=manufacturing_order_sequences.next_number+1 RETURNING next_number`,[companyId,nowYear]);
   const orderNumber=`MO-${nowYear}-${String(seq.rows[0].next_number).padStart(6,'0')}`;
   const created=await client.query<{id:string}>(`INSERT INTO manufacturing_production_orders(company_id,order_number,bom_id,warehouse_id,planned_quantity,planned_start_date,planned_end_date,notes,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,[companyId,orderNumber,dto.bomId,dto.warehouseId,dto.plannedQuantity,dto.plannedStartDate??null,dto.plannedEndDate??null,dto.notes?.trim()||null,user.userId]);
   const lines=await client.query<{material_product_id:string;quantity:string|number;waste_percent:string|number}>(`SELECT material_product_id,quantity,waste_percent FROM manufacturing_bom_lines WHERE company_id=$1 AND bom_id=$2 ORDER BY id`,[companyId,dto.bomId]);
   if(!lines.rows.length)throw new BadRequestException('The selected BOM has no material lines.');
   for(const line of lines.rows){
    const required=Number(line.quantity)*dto.plannedQuantity/Number(bom.rows[0].output_quantity)*(1+Number(line.waste_percent)/100);
    await client.query(`INSERT INTO manufacturing_order_materials(company_id,production_order_id,material_product_id,required_quantity,unit_cost)
     SELECT $1,$2,p.id,$4,COALESCE(NULLIF(s.average_unit_cost,0),p.cost_price) FROM products p LEFT JOIN inventory_stock_levels s ON s.company_id=p.company_id AND s.product_id=p.id AND s.warehouse_id=$5 WHERE p.company_id=$1 AND p.id=$3`,[companyId,created.rows[0].id,line.material_product_id,required,dto.warehouseId]);
   }
   await this.audit.logInTransaction(client,{userId:user.userId,companyId,branchId,action:'manufacturing.order.create',entityType:'manufacturing_production_order',entityId:created.rows[0].id,oldValues:null,newValues:{bomId:dto.bomId,warehouseId:dto.warehouseId,plannedQuantity:dto.plannedQuantity},ipAddress:null});
   return created.rows[0].id;
  });
  return (await this.db.query('SELECT * FROM manufacturing_production_orders WHERE company_id=$1 AND id=$2',[companyId,orderId])).rows[0];
 }

 async startOrder(user:AuthenticatedUser,id:string){
  const {companyId,branchId}=await this.companyFor(user);
  const result=await this.db.transaction(async client=>{
   const order=await client.query<{id:string;status:string;warehouse_id:string;planned_quantity:string|number;bom_id:string}>(`SELECT id,status,warehouse_id,planned_quantity,bom_id FROM manufacturing_production_orders WHERE company_id=$1 AND id=$2 AND EXISTS (SELECT 1 FROM warehouses w WHERE w.company_id=manufacturing_production_orders.company_id AND w.id=manufacturing_production_orders.warehouse_id AND ($3::uuid IS NULL OR w.branch_id=$3)) FOR UPDATE`,[companyId,id,branchId]);
   if(!order.rows[0])throw new NotFoundException('Production order not found.');
   if(order.rows[0].status!=='planned')throw new ConflictException('Only planned production orders can be started.');
   const activeWarehouse=await client.query('SELECT id FROM warehouses WHERE id=$1 AND company_id=$2 AND is_active=true FOR SHARE',[order.rows[0].warehouse_id,companyId]);
   if(!activeWarehouse.rows[0])throw new NotFoundException('Active production warehouse not found.');
   const materials=await client.query<{material_product_id:string;required_quantity:string|number;reserved_quantity:string|number}>(`SELECT material_product_id,required_quantity,reserved_quantity FROM manufacturing_order_materials WHERE company_id=$1 AND production_order_id=$2 ORDER BY material_product_id FOR UPDATE`,[companyId,id]);
   if(!materials.rows.length)throw new BadRequestException('Production order has no material requirements.');
   for(const material of materials.rows){
    const activeProduct=await client.query('SELECT id FROM products WHERE id=$1 AND company_id=$2 AND is_active=true AND is_service=false FOR SHARE',[material.material_product_id,companyId]);
    if(!activeProduct.rows[0])throw new BadRequestException('A required manufacturing material is inactive or unavailable.');
    const required=Number(material.required_quantity);
    let rebatchRemaining=required,rebatchCost=0,rebatchReserved=0;
    const rebatchLots=await client.query<{id:string;quantity_remaining:string|number;unit_cost:string|number}>(`SELECT l.id,l.quantity_remaining,l.unit_cost FROM manufacturing_rebatch_lots l WHERE l.company_id=$1 AND l.product_id=$2 AND l.warehouse_id=$3 AND l.status IN ('available','partially_consumed') AND l.quantity_remaining>0 AND NOT EXISTS (SELECT 1 FROM manufacturing_quality_events q WHERE q.id=l.quality_event_id AND q.status<>'approved') ORDER BY l.approved_at,l.created_at,l.id FOR UPDATE`,[companyId,material.material_product_id,order.rows[0].warehouse_id]);
    for(const lot of rebatchLots.rows){
     if(rebatchRemaining<=0)break;
     const held=await client.query<{quantity:string|number}>(`SELECT COALESCE(SUM(quantity),0)::numeric AS quantity FROM manufacturing_rebatch_reservations WHERE company_id=$1 AND rebatch_lot_id=$2 AND status='reserved'`,[companyId,lot.id]);
     const available=Math.max(0,Number(lot.quantity_remaining)-Number(held.rows[0]?.quantity??0));
     const take=Math.min(rebatchRemaining,available);
     if(take<=0)continue;
     await client.query(`INSERT INTO manufacturing_rebatch_reservations(company_id,rebatch_lot_id,production_order_id,material_product_id,warehouse_id,quantity,unit_cost) VALUES($1,$2,$3,$4,$5,$6,$7)`,[companyId,lot.id,id,material.material_product_id,order.rows[0].warehouse_id,take,lot.unit_cost]);
     rebatchRemaining-=take;rebatchReserved+=take;rebatchCost+=take*Number(lot.unit_cost);
    }
    await client.query(`INSERT INTO inventory_stock_levels(company_id,warehouse_id,product_id,quantity,reserved_quantity,reorder_level) VALUES($1,$2,$3,0,0,0) ON CONFLICT(warehouse_id,product_id) DO NOTHING`,[companyId,order.rows[0].warehouse_id,material.material_product_id]);
    let normalAverageCost=0;
    if(rebatchRemaining>0){
     const reserved=await client.query<{id:string;average_unit_cost:string|number}>(`UPDATE inventory_stock_levels SET reserved_quantity=reserved_quantity+$1,updated_at=NOW() WHERE company_id=$2 AND warehouse_id=$3 AND product_id=$4 AND quantity-reserved_quantity >= $1 RETURNING id,average_unit_cost`,[rebatchRemaining,companyId,order.rows[0].warehouse_id,material.material_product_id]);
     if(!reserved.rows[0])throw new BadRequestException('Insufficient available stock (warehouse plus approved rebatch) for material '+material.material_product_id+'; production was not started.');
     normalAverageCost=Number(reserved.rows[0].average_unit_cost??0);
    }
    const blendedCost=required>0?(rebatchCost+rebatchRemaining*normalAverageCost)/required:0;
    await client.query(`UPDATE manufacturing_order_materials SET reserved_quantity=required_quantity,unit_cost=CASE WHEN $4::numeric>0 THEN $4 ELSE unit_cost END WHERE company_id=$1 AND production_order_id=$2 AND material_product_id=$3`,[companyId,id,material.material_product_id,blendedCost]);
   }
   await client.query(`UPDATE manufacturing_production_orders SET status='in_progress',actual_start_at=NOW(),material_reserved_at=NOW(),updated_at=NOW() WHERE company_id=$1 AND id=$2`,[companyId,id]);
   const started=(await client.query(`SELECT * FROM manufacturing_production_orders WHERE company_id=$1 AND id=$2`,[companyId,id])).rows[0];
   await this.audit.logInTransaction(client,{userId:user.userId,companyId,branchId,action:'manufacturing.order.start',entityType:'manufacturing_production_order',entityId:id,oldValues:{status:'planned'},newValues:{status:'in_progress'},ipAddress:null});
   return started;
  });
  return result;
 }
 async listOrderCosts(user:AuthenticatedUser,id:string){
  const {companyId,branchId}=await this.companyFor(user);
  const order=await this.db.query(`SELECT id FROM manufacturing_production_orders WHERE company_id=$1 AND id=$2 AND EXISTS (SELECT 1 FROM warehouses w WHERE w.company_id=manufacturing_production_orders.company_id AND w.id=manufacturing_production_orders.warehouse_id AND ($3::uuid IS NULL OR w.branch_id=$3))`,[companyId,id,branchId]);
  if(!order.rows[0])throw new NotFoundException('Production order not found.');
  return (await this.db.query(`SELECT c.id,c.production_order_id,c.cost_type,c.description,c.amount,c.incurred_on,c.source_account_id,a.code AS source_account_code,a.name AS source_account_name,c.journal_entry_id,c.created_at FROM manufacturing_order_costs c JOIN chart_of_accounts a ON a.id=c.source_account_id AND a.company_id=c.company_id WHERE c.company_id=$1 AND c.production_order_id=$2 ORDER BY c.incurred_on DESC,c.created_at DESC`,[companyId,id])).rows;
 }
 async addOrderCost(user:AuthenticatedUser,id:string,dto:CreateProductionCostDto){
  const {companyId,branchId}=await this.companyFor(user); const description=dto.description.trim();
  if(!description)throw new BadRequestException('A cost description is required.');
  const result=await this.db.transaction(async client=>{
   const order=await client.query<{id:string;status:string}>(`SELECT id,status FROM manufacturing_production_orders WHERE company_id=$1 AND id=$2 AND EXISTS (SELECT 1 FROM warehouses w WHERE w.company_id=manufacturing_production_orders.company_id AND w.id=manufacturing_production_orders.warehouse_id AND ($3::uuid IS NULL OR w.branch_id=$3)) FOR UPDATE`,[companyId,id,branchId]);
   if(!order.rows[0])throw new NotFoundException('Production order not found.');
   if(order.rows[0].status!=='in_progress')throw new ConflictException('Labour and overhead costs can only be recorded against an in-progress production order.');
   const account=await client.query<{id:string;account_type:string}>(`SELECT id,account_type FROM chart_of_accounts WHERE company_id=$1 AND id=$2 AND is_active=true FOR SHARE`,[companyId,dto.sourceAccountId]);
   if(!account.rows[0])throw new BadRequestException('The source account is missing, inactive, or belongs to another company.');
   if(!['expense','liability'].includes(account.rows[0].account_type))throw new BadRequestException('Choose an active expense or liability account for the cost source.');
   const cost=await client.query<{id:string}>(`INSERT INTO manufacturing_order_costs(company_id,production_order_id,cost_type,description,amount,source_account_id,incurred_on,created_by) VALUES($1,$2,$3,$4,$5,$6,COALESCE($7::date,CURRENT_DATE),$8) RETURNING id`,[companyId,id,dto.costType,description,dto.amount,dto.sourceAccountId,dto.incurredOn??null,user.userId]);
   const journalId=await this.postJournal(client,{companyId,description:'Production '+dto.costType+' cost for order '+id+': '+description,sourceType:dto.costType==='labour'?'manufacturing_labour_cost':'manufacturing_overhead_cost',sourceId:cost.rows[0].id,userId:user.userId,amount:dto.amount,debitSystem:'work_in_progress',creditAccountId:account.rows[0].id});
   if(!journalId)throw new BadRequestException('Cost journal was not created.');
   await client.query(`UPDATE manufacturing_order_costs SET journal_entry_id=$3 WHERE company_id=$1 AND id=$2`,[companyId,cost.rows[0].id,journalId]);
   const savedCost=(await client.query(`SELECT c.id,c.production_order_id,c.cost_type,c.description,c.amount,c.incurred_on,c.source_account_id,a.code AS source_account_code,a.name AS source_account_name,c.journal_entry_id,c.created_at FROM manufacturing_order_costs c JOIN chart_of_accounts a ON a.id=c.source_account_id AND a.company_id=c.company_id WHERE c.company_id=$1 AND c.id=$2`,[companyId,cost.rows[0].id])).rows[0];
   await this.audit.logInTransaction(client,{userId:user.userId,companyId,branchId,action:'manufacturing.order.cost.create',entityType:'manufacturing_order_cost',entityId:savedCost.id,oldValues:null,newValues:{productionOrderId:id,costType:dto.costType,amount:dto.amount,sourceAccountId:dto.sourceAccountId},ipAddress:null});
   return savedCost;
  });
  return result;
 }
 async completeOrder(user:AuthenticatedUser,id:string){
  const {companyId,branchId}=await this.companyFor(user);
  const result=await this.db.transaction(async client=>{
   const order=await client.query<{id:string;status:string;warehouse_id:string;planned_quantity:string|number;produced_quantity:string|number;bom_id:string;product_id:string;product_cost:string|number}>(`SELECT o.id,o.status,o.warehouse_id,o.planned_quantity,o.produced_quantity,o.bom_id,b.product_id,p.cost_price AS product_cost FROM manufacturing_production_orders o JOIN manufacturing_boms b ON b.id=o.bom_id AND b.company_id=o.company_id JOIN products p ON p.id=b.product_id AND p.company_id=o.company_id WHERE o.company_id=$1 AND o.id=$2 AND EXISTS (SELECT 1 FROM warehouses w WHERE w.company_id=o.company_id AND w.id=o.warehouse_id AND ($3::uuid IS NULL OR w.branch_id=$3)) FOR UPDATE OF o`,[companyId,id,branchId]);
   if(!order.rows[0])throw new NotFoundException('Production order not found.');
   if(order.rows[0].status!=='in_progress')throw new ConflictException('Only in-progress production orders can be completed.');
   const materials=await client.query<{material_product_id:string;required_quantity:string|number;reserved_quantity:string|number;consumed_quantity:string|number;unit_cost:string|number}>(`SELECT material_product_id,required_quantity,reserved_quantity,consumed_quantity,unit_cost FROM manufacturing_order_materials WHERE company_id=$1 AND production_order_id=$2 ORDER BY material_product_id FOR UPDATE`,[companyId,id]);
   if(!materials.rows.length)throw new BadRequestException('Production order has no material requirements.');
   let totalMaterialCost=0;
   for(const material of materials.rows){
    const required=Number(material.required_quantity);
    if(Number(material.reserved_quantity)<required||Number(material.consumed_quantity)>0)throw new ConflictException('Material reservation state is inconsistent; completion was stopped.');
    const rebatchReservations=await client.query<{id:string;rebatch_lot_id:string;quantity:string|number;unit_cost:string|number}>(`SELECT id,rebatch_lot_id,quantity,unit_cost FROM manufacturing_rebatch_reservations WHERE company_id=$1 AND production_order_id=$2 AND material_product_id=$3 AND status='reserved' ORDER BY created_at,id FOR UPDATE`,[companyId,id,material.material_product_id]);
    const rebatchQuantity=rebatchReservations.rows.reduce((sum,row)=>sum+Number(row.quantity),0);
    if(rebatchQuantity>required+0.0001)throw new ConflictException('Reserved rebatch quantity exceeds the production requirement.');
    const normalRequired=Math.max(0,required-rebatchQuantity);
    const stock=await client.query<{quantity:string|number;reserved_quantity:string|number;average_unit_cost:string|number}>(`SELECT quantity,reserved_quantity,average_unit_cost FROM inventory_stock_levels WHERE company_id=$1 AND warehouse_id=$2 AND product_id=$3 FOR UPDATE`,[companyId,order.rows[0].warehouse_id,material.material_product_id]);
    if(normalRequired>0&&(!stock.rows[0]||Number(stock.rows[0].quantity)<normalRequired||Number(stock.rows[0].reserved_quantity)<normalRequired))throw new ConflictException('Reserved warehouse stock no longer matches the non-rebatch production requirement.');
    if(normalRequired>0){
     await client.query(`UPDATE inventory_stock_levels SET quantity=quantity-$1,reserved_quantity=reserved_quantity-$1,updated_at=NOW() WHERE company_id=$2 AND warehouse_id=$3 AND product_id=$4`,[normalRequired,companyId,order.rows[0].warehouse_id,material.material_product_id]);
     await client.query(`INSERT INTO inventory_stock_movements(company_id,product_id,warehouse_id,movement_type,quantity,unit_cost,reference,notes,created_by) VALUES($1,$2,$3,'issue',$4,$5,$6,$7,$8)`,[companyId,material.material_product_id,order.rows[0].warehouse_id,-normalRequired,stock.rows[0].average_unit_cost,'MO-'+id,'Warehouse material consumed by production order',user.userId]);
    }
    for(const allocation of rebatchReservations.rows){
     const consumed=await client.query(`UPDATE manufacturing_rebatch_lots SET quantity_remaining=quantity_remaining-$1,status=CASE WHEN quantity_remaining-$1<=0 THEN 'consumed' ELSE 'partially_consumed' END WHERE company_id=$2 AND id=$3 AND quantity_remaining >= $1 RETURNING id`,[allocation.quantity,companyId,allocation.rebatch_lot_id]);
     if(!consumed.rows[0])throw new ConflictException('A reserved rebatch lot no longer has sufficient quantity; production completion was stopped.');
     await client.query(`INSERT INTO manufacturing_rebatch_consumptions(company_id,rebatch_lot_id,production_order_id,quantity,unit_cost,created_by) VALUES($1,$2,$3,$4,$5,$6)`,[companyId,allocation.rebatch_lot_id,id,allocation.quantity,allocation.unit_cost,user.userId]);
     await client.query(`UPDATE manufacturing_rebatch_reservations SET status='consumed',updated_at=NOW() WHERE company_id=$1 AND id=$2`,[companyId,allocation.id]);
    }
    await client.query(`UPDATE manufacturing_order_materials SET consumed_quantity=required_quantity,reserved_quantity=0,consumed_at=NOW() WHERE company_id=$1 AND production_order_id=$2 AND material_product_id=$3`,[companyId,id,material.material_product_id]);
    await client.query(`UPDATE products SET stock_quantity=COALESCE((SELECT SUM(quantity) FROM inventory_stock_levels WHERE company_id=$1 AND product_id=$2),0) WHERE company_id=$1 AND id=$2`,[companyId,material.material_product_id]);
    totalMaterialCost+=normalRequired*Number(stock.rows[0]?.average_unit_cost??0)+rebatchReservations.rows.reduce((sum,row)=>sum+Number(row.quantity)*Number(row.unit_cost),0);
   }
   const additionalCosts=await client.query<{total:string|number}>(`SELECT COALESCE(SUM(amount),0)::numeric AS total FROM manufacturing_order_costs WHERE company_id=$1 AND production_order_id=$2`,[companyId,id]);
   const totalProductionCost=totalMaterialCost+Number(additionalCosts.rows[0]?.total??0);
   const finishedQuantity=Number(order.rows[0].planned_quantity);
   await client.query(`INSERT INTO inventory_stock_levels(company_id,warehouse_id,product_id,quantity,reserved_quantity,reorder_level) VALUES($1,$2,$3,0,0,0) ON CONFLICT(warehouse_id,product_id) DO NOTHING`,[companyId,order.rows[0].warehouse_id,order.rows[0].product_id]);
   const unitCost=finishedQuantity>0?totalProductionCost/finishedQuantity:Number(order.rows[0].product_cost);
   const finishedStock=await client.query<{average_unit_cost:string|number}>(`UPDATE inventory_stock_levels
    SET average_unit_cost=CASE WHEN quantity+$1>0 THEN ROUND(((quantity*average_unit_cost)+($1*$2))/(quantity+$1),2) ELSE ROUND($2::numeric,2) END,
        quantity=quantity+$1,updated_at=NOW()
    WHERE company_id=$3 AND warehouse_id=$4 AND product_id=$5 RETURNING average_unit_cost`,[finishedQuantity,unitCost,companyId,order.rows[0].warehouse_id,order.rows[0].product_id]);
   const weightedAverageFinishedCost=Number(finishedStock.rows[0]?.average_unit_cost??unitCost);
   const finishedMovement=await client.query<{id:string}>(`INSERT INTO inventory_stock_movements(company_id,product_id,warehouse_id,movement_type,quantity,unit_cost,reference,notes,created_by) VALUES($1,$2,$3,'receipt',$4,$5,$6,$7,$8) RETURNING id`,[companyId,order.rows[0].product_id,order.rows[0].warehouse_id,finishedQuantity,unitCost,'MO-'+id,'Finished goods received from production order; pending quality release',user.userId]);
   const batchSchema=await client.query<{present:boolean}>(`SELECT to_regclass('public.inventory_batches') IS NOT NULL AND to_regclass('public.inventory_stock_movement_allocations') IS NOT NULL AS present`);
   if(batchSchema.rows[0]?.present){
    const batch=await client.query<{id:string}>(`INSERT INTO inventory_batches(company_id,product_id,warehouse_id,batch_code,received_quantity,quantity_on_hand,unit_cost,source_type,source_reference,quality_status,status,created_by) VALUES($1,$2,$3,$4,$5,$5,$6,'production',$7,'pending','blocked',$8) RETURNING id`,[companyId,order.rows[0].product_id,order.rows[0].warehouse_id,`MO-${id}`.slice(0,100),finishedQuantity,unitCost,id,user.userId]);
    await client.query(`INSERT INTO inventory_stock_movement_allocations(company_id,movement_id,batch_id,product_id,warehouse_id,quantity,unit_cost) VALUES($1,$2,$3,$4,$5,$6,$7)`,[companyId,finishedMovement.rows[0].id,batch.rows[0].id,order.rows[0].product_id,order.rows[0].warehouse_id,finishedQuantity,unitCost]);
   }
   await client.query(`UPDATE products SET stock_quantity=COALESCE((SELECT SUM(quantity) FROM inventory_stock_levels WHERE company_id=$1 AND product_id=$2),0),cost_price=$3 WHERE company_id=$1 AND id=$2`,[companyId,order.rows[0].product_id,weightedAverageFinishedCost]);
   if(totalMaterialCost>0||totalProductionCost>0){
    if(totalMaterialCost>0) await this.postJournal(client,{companyId,description:`Materials consumed for production order ${id}`,sourceType:'manufacturing_material_consumption',sourceId:id,userId:user.userId,amount:totalMaterialCost,debitSystem:'work_in_progress',creditSystem:'inventory'});
    if(totalProductionCost>0) await this.postJournal(client,{companyId,description:`Finished goods received from production order ${id}`,sourceType:'manufacturing_finished_goods',sourceId:id,userId:user.userId,amount:totalProductionCost,debitSystem:'inventory',creditSystem:'work_in_progress'});
   }
   await client.query(`UPDATE manufacturing_production_orders SET status='completed',produced_quantity=$3,completed_at=NOW(),materials_consumed_at=NOW(),updated_at=NOW() WHERE company_id=$1 AND id=$2`,[companyId,id,finishedQuantity]);
   const completed=(await client.query(`SELECT * FROM manufacturing_production_orders WHERE company_id=$1 AND id=$2`,[companyId,id])).rows[0];
   await this.audit.logInTransaction(client,{userId:user.userId,companyId,branchId,action:'manufacturing.order.complete',entityType:'manufacturing_production_order',entityId:id,oldValues:{status:'in_progress'},newValues:{status:'completed',producedQuantity:completed.produced_quantity},ipAddress:null});
   return completed;
  });
  return result;
 }

 async cancelOrder(user:AuthenticatedUser,id:string){
  const {companyId,branchId}=await this.companyFor(user);
  let previousStatus='planned';
  const result=await this.db.transaction(async client=>{
   const order=await client.query<{id:string;status:string;warehouse_id:string}>(`SELECT id,status,warehouse_id FROM manufacturing_production_orders WHERE company_id=$1 AND id=$2 AND EXISTS (SELECT 1 FROM warehouses w WHERE w.company_id=manufacturing_production_orders.company_id AND w.id=manufacturing_production_orders.warehouse_id AND ($3::uuid IS NULL OR w.branch_id=$3)) FOR UPDATE`,[companyId,id,branchId]);
   if(!order.rows[0])throw new NotFoundException('Production order not found.');
   if(order.rows[0].status!=='planned'&&order.rows[0].status!=='in_progress')throw new ConflictException('Only planned or in-progress orders can be cancelled.');
   if(order.rows[0].status==='in_progress'){
    const costs=await client.query<{count:string|number}>(`SELECT COUNT(*)::int AS count FROM manufacturing_order_costs WHERE company_id=$1 AND production_order_id=$2`,[companyId,id]);
    if(Number(costs.rows[0]?.count??0)>0)throw new ConflictException('This order has capitalised labour or overhead costs. Complete production or reverse those costs before cancellation.');
   }
   previousStatus=order.rows[0].status;
   const materials=await client.query<{material_product_id:string;reserved_quantity:string|number}>(`SELECT material_product_id,reserved_quantity FROM manufacturing_order_materials WHERE company_id=$1 AND production_order_id=$2 ORDER BY material_product_id FOR UPDATE`,[companyId,id]);
   if(order.rows[0].status==='in_progress'){
    for(const material of materials.rows){
     const reserved=Number(material.reserved_quantity);
     if(reserved<=0)continue;
     const stock=await client.query<{id:string}>(`UPDATE inventory_stock_levels SET reserved_quantity=reserved_quantity-$1,updated_at=NOW() WHERE company_id=$2 AND warehouse_id=$3 AND product_id=$4 AND reserved_quantity >= $1 RETURNING id`,[reserved,companyId,order.rows[0].warehouse_id,material.material_product_id]);
     if(!stock.rows[0])throw new ConflictException('Material reservation could not be released safely; cancellation was rolled back.');
     await client.query(`UPDATE manufacturing_order_materials SET reserved_quantity=0 WHERE company_id=$1 AND production_order_id=$2 AND material_product_id=$3`,[companyId,id,material.material_product_id]);
    }
   }
   await client.query(`UPDATE manufacturing_production_orders SET status='cancelled',updated_at=NOW() WHERE company_id=$1 AND id=$2`,[companyId,id]);
   const cancelled=(await client.query(`SELECT * FROM manufacturing_production_orders WHERE company_id=$1 AND id=$2`,[companyId,id])).rows[0];
   await this.audit.logInTransaction(client,{userId:user.userId,companyId,branchId,action:'manufacturing.order.cancel',entityType:'manufacturing_production_order',entityId:id,oldValues:{status:previousStatus},newValues:{status:'cancelled'},ipAddress:null});
   return cancelled;
  });
  return result;
 }

 async listQualityEvents(user:AuthenticatedUser){
  const {companyId,branchId}=await this.companyFor(user);
  return (await this.db.query(`SELECT q.*,p.name AS product_name,w.name AS warehouse_name,o.order_number FROM manufacturing_quality_events q JOIN products p ON p.id=q.product_id AND p.company_id=q.company_id JOIN warehouses w ON w.id=q.warehouse_id AND w.company_id=q.company_id LEFT JOIN manufacturing_production_orders o ON o.id=q.production_order_id AND o.company_id=q.company_id WHERE q.company_id=$1 AND ($2::uuid IS NULL OR w.branch_id=$2) ORDER BY q.created_at DESC LIMIT 200`,[companyId,branchId])).rows;
 }
 async createQualityEvent(user:AuthenticatedUser,dto:import('./dto/manufacturing.dto.js').CreateManufacturingQualityEventDto){
  const {companyId,branchId}=await this.companyFor(user);
  const recoverable=Number(dto.recoverableQuantity??0), disposal=Number(dto.disposalQuantity??0), affected=Number(dto.affectedQuantity);
  if(recoverable+disposal>affected) throw new BadRequestException('Recoverable and disposal quantities cannot exceed the affected quantity.');
  return this.db.transaction(async client=>{
   const product=await client.query(`SELECT id FROM products WHERE company_id=$1 AND id=$2`,[companyId,dto.productId]);
   const warehouse=await client.query(`SELECT id FROM warehouses WHERE company_id=$1 AND id=$2 AND ($3::uuid IS NULL OR branch_id=$3)`,[companyId,dto.warehouseId,branchId]);
   if(!product.rowCount||!warehouse.rowCount) throw new NotFoundException('Product or warehouse was not found in the active company/branch.');
   if(dto.productionOrderId){const order=await client.query(`SELECT id FROM manufacturing_production_orders WHERE company_id=$1 AND id=$2 AND warehouse_id=$3`,[companyId,dto.productionOrderId,dto.warehouseId]);if(!order.rowCount)throw new NotFoundException('Production order was not found for this company and warehouse.');}
   const eventYear=new Date().getFullYear();
   // Serialize numbering per company/year so concurrent quality-event creation cannot collide.
   await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,[`${companyId}:manufacturing-quality:${eventYear}`]);
   const eventPrefix=`Q-${eventYear}-`;
   const number=await client.query<{n:number}>(`SELECT COALESCE(MAX(SUBSTRING(event_number FROM '[0-9]+$')::bigint),0)+1 AS n FROM manufacturing_quality_events WHERE company_id=$1 AND event_number LIKE $2`,[companyId,`${eventPrefix}%`]);
   const eventNumber=`${eventPrefix}${String(number.rows[0].n).padStart(6,'0')}`;
   const result=await client.query(`INSERT INTO manufacturing_quality_events(company_id,production_order_id,product_id,warehouse_id,event_number,event_type,original_batch_reference,affected_quantity,recoverable_quantity,disposal_quantity,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[companyId,dto.productionOrderId??null,dto.productId,dto.warehouseId,eventNumber,dto.eventType,dto.originalBatchReference??null,affected,recoverable,disposal,dto.reason,user.userId]);
   return result.rows[0];
  });
 }
 async approveQualityEvent(user:AuthenticatedUser,id:string,inspectionResult?:string){
  const {companyId,branchId}=await this.companyFor(user);
  return this.db.transaction(async client=>{
   const event=await client.query<any>(`SELECT q.*,w.branch_id FROM manufacturing_quality_events q JOIN warehouses w ON w.id=q.warehouse_id AND w.company_id=q.company_id WHERE q.company_id=$1 AND q.id=$2 AND ($3::uuid IS NULL OR w.branch_id=$3) FOR UPDATE OF q`,[companyId,id,branchId]);
   if(!event.rowCount)throw new NotFoundException('Quality event not found.');
   const q=event.rows[0]; if(q.status!=='pending')throw new ConflictException('Only pending quality events can be approved.');
   let sourceBatch:{id:string;quantity_on_hand:string|number;reserved_quantity:string|number;unit_cost:string|number}|null=null;
   if(q.original_batch_reference){
    const batch=await client.query<{id:string;quantity_on_hand:string|number;reserved_quantity:string|number;unit_cost:string|number}>(`SELECT id,quantity_on_hand,reserved_quantity,unit_cost FROM inventory_batches WHERE company_id=$1 AND product_id=$2 AND warehouse_id=$3 AND batch_code=$4 FOR UPDATE`,[companyId,q.product_id,q.warehouse_id,q.original_batch_reference]);
    sourceBatch=batch.rows[0]??null;
    if(!sourceBatch)throw new NotFoundException('Referenced inventory batch was not found; quality approval was not applied.');
    if(Number(sourceBatch.reserved_quantity)>0 || Math.abs(Number(sourceBatch.quantity_on_hand)-Number(q.affected_quantity))>0.0000001)throw new ConflictException('To quarantine a batch safely, affected quantity must equal its full on-hand quantity and it must have no batch reservations.');
    const stock=await client.query(`UPDATE inventory_stock_levels SET quantity=quantity-$1,updated_at=NOW() WHERE company_id=$2 AND product_id=$3 AND warehouse_id=$4 AND quantity-reserved_quantity >= $1 RETURNING id`,[q.affected_quantity,companyId,q.product_id,q.warehouse_id]);
    if(!stock.rowCount)throw new ConflictException('Aggregate stock is reserved or insufficient; release reservations before quarantining this batch.');
    const movement=await client.query<{id:string}>(`INSERT INTO inventory_stock_movements(company_id,product_id,warehouse_id,movement_type,quantity,unit_cost,reference,notes,created_by) VALUES($1,$2,$3,'adjustment',$4,$5,$6,$7,$8) RETURNING id`,[companyId,q.product_id,q.warehouse_id,-Number(q.affected_quantity),Number(sourceBatch.unit_cost),'QUALITY-'+q.event_number,'Quarantined inventory batch: '+q.reason,user.userId]);
    await client.query(`INSERT INTO inventory_stock_movement_allocations(company_id,movement_id,batch_id,product_id,warehouse_id,quantity,unit_cost) VALUES($1,$2,$3,$4,$5,$6,$7)`,[companyId,movement.rows[0].id,sourceBatch.id,q.product_id,q.warehouse_id,q.affected_quantity,sourceBatch.unit_cost]);
    await client.query(`UPDATE inventory_batches SET quantity_on_hand=0,quality_status=CASE WHEN $2='rejected' THEN 'rejected' ELSE 'hold' END,status='blocked',updated_at=NOW() WHERE company_id=$1 AND id=$3`,[companyId,q.event_type,sourceBatch.id]);
   }
   let rebatchLot=null;
   if(Number(q.recoverable_quantity)>0){
    const lotNumber=`RB-${q.event_number}`;
    const batchCost=sourceBatch ? {rows:[{unit_cost:sourceBatch.unit_cost}]} : await client.query<{unit_cost:string|number}>(`SELECT average_unit_cost AS unit_cost FROM inventory_stock_levels WHERE company_id=$1 AND product_id=$2 AND warehouse_id=$3`,[companyId,q.product_id,q.warehouse_id]);
    const inserted=await client.query(`INSERT INTO manufacturing_rebatch_lots(company_id,quality_event_id,product_id,warehouse_id,lot_number,original_batch_reference,quantity_received,quantity_remaining,unit_cost,approved_by) VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8,$9) RETURNING *`,[companyId,id,q.product_id,q.warehouse_id,lotNumber,q.original_batch_reference,q.recoverable_quantity,Number(batchCost.rows[0]?.unit_cost??0),user.userId]);
    rebatchLot=inserted.rows[0];
   }
   const updated=await client.query(`UPDATE manufacturing_quality_events SET status='approved',inspection_result=$3,approved_by=$4,approved_at=NOW(),updated_at=NOW() WHERE company_id=$1 AND id=$2 RETURNING *`,[companyId,id,inspectionResult??null,user.userId]);
   return {event:updated.rows[0],rebatchLot};
  });
 }
}
