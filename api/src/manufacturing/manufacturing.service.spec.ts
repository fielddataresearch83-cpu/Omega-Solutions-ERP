import { BadRequestException } from '@nestjs/common';
import { ManufacturingService } from './manufacturing.service.js';
import { DatabaseService } from '../database.service.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.js';
type Mock=ReturnType<typeof vi.fn>;

describe('ManufacturingService',()=>{
 it('filters production order listings to the assigned branch',async()=>{
  const branchUser={...user,branchId:'branch-1'};
  memberships.getMembershipForCompany.mockResolvedValueOnce({companyId:'company-active',branchId:'branch-1',role:'staff'});
  db.query.mockResolvedValue({rows:[],rowCount:0});
  await service.listOrders(branchUser);
  expect(db.query).toHaveBeenCalledWith(expect.stringContaining('w.branch_id=$2'),['company-active','branch-1']);
 });

 it('does not expose production costs for an order outside the assigned branch',async()=>{
  const branchUser={...user,branchId:'branch-1'};
  memberships.getMembershipForCompany.mockResolvedValueOnce({companyId:'company-active',branchId:'branch-1',role:'staff'});
  db.query.mockResolvedValue({rows:[],rowCount:0});
  await expect(service.listOrderCosts(branchUser,'order-other-branch')).rejects.toThrow('Production order not found.');
  expect(db.query).toHaveBeenCalledWith(expect.stringContaining('w.branch_id=$3'),['company-active','order-other-branch','branch-1']);
 });

 it('rejects starting an order outside the assigned branch before any stock reservation',async()=>{
  const branchUser={...user,branchId:'branch-1'};
  memberships.getMembershipForCompany.mockResolvedValueOnce({companyId:'company-active',branchId:'branch-1',role:'staff'});
  const client={query:vi.fn().mockResolvedValue({rows:[],rowCount:0})};
  db.transaction.mockImplementation(async(callback:(client:unknown)=>Promise<unknown>)=>callback(client));
  await expect(service.startOrder(branchUser,'order-other-branch')).rejects.toThrow('Production order not found.');
  expect(client.query).toHaveBeenCalledTimes(1);
  expect(client.query).toHaveBeenCalledWith(expect.stringContaining('w.branch_id=$3'),['company-active','order-other-branch','branch-1']);
  expect(audit.log).not.toHaveBeenCalled();
 });

 const user:AuthenticatedUser={userId:'user-1',email:'owner@example.test',fullName:'Owner',companyId:'company-active',branchId:null,role:'owner',permissions:['manufacturing:read','manufacturing:write']};
 let db:{query:Mock;transaction:Mock};let memberships:{getMembership:Mock;getMembershipForCompany:Mock};let audit:{log:Mock};let service:ManufacturingService;
 beforeEach(()=>{
  db={query:vi.fn(),transaction:vi.fn()};
  const membership={companyId:'company-active',branchId:null,role:'owner'};
  memberships={getMembership:vi.fn().mockResolvedValue({companyId:'company-default'}),getMembershipForCompany:vi.fn().mockResolvedValue(membership)};
  audit={log:vi.fn().mockResolvedValue(undefined)};
  service=new ManufacturingService(db as unknown as DatabaseService,memberships as unknown as MembershipsService,audit as unknown as AuditService);
 });
 it('scopes BOM listing to the active company',async()=>{
  db.query.mockResolvedValue({rows:[],rowCount:0});
  await service.listBoms(user);
  expect(memberships.getMembershipForCompany).toHaveBeenCalledWith('user-1','company-active');
  expect(memberships.getMembership).not.toHaveBeenCalled();
  expect(db.query).toHaveBeenCalledWith(expect.stringContaining('WHERE b.company_id=$1'),['company-active']);
 });
 it('rejects duplicate material lines before writing',async()=>{
  await expect(service.createBom(user,{code:'BOM-1',name:'Assembly',productId:'product-finished',outputQuantity:1,lines:[
   {materialProductId:'material-1',quantity:2},{materialProductId:'material-1',quantity:3},
  ]})).rejects.toThrow(BadRequestException);
  expect(db.transaction).not.toHaveBeenCalled();
 });
 it('rejects service products before creating a BOM',async()=>{
  const client={query:vi.fn().mockResolvedValue({rows:[{id:'product-finished',is_service:false},{id:'material-1',is_service:true}],rowCount:2})};
  db.transaction.mockImplementation(async(callback:(client:unknown)=>Promise<unknown>)=>callback(client));
  await expect(service.createBom(user,{code:'BOM-1',name:'Assembly',productId:'product-finished',outputQuantity:1,lines:[{materialProductId:'material-1',quantity:2}]})).rejects.toThrow(BadRequestException);
  expect(client.query).toHaveBeenCalledTimes(1);
  expect(audit.log).not.toHaveBeenCalled();
 });

 it('blocks cancellation when posted labour or overhead costs remain in WIP',async()=>{
  const client={query:vi.fn().mockImplementation(async(sql:string)=>{
   if(sql.includes('SELECT id,status,warehouse_id FROM manufacturing_production_orders'))return {rows:[{id:'order-1',status:'in_progress',warehouse_id:'warehouse-1'}],rowCount:1};
   if(sql.includes('SELECT COUNT(*)::int AS count FROM manufacturing_order_costs'))return {rows:[{count:1}],rowCount:1};
   return {rows:[],rowCount:1};
  })};
  db.transaction.mockImplementation(async(callback:(client:unknown)=>Promise<unknown>)=>callback(client));
  await expect(service.cancelOrder(user,'order-1')).rejects.toThrow('has capitalised labour or overhead costs');
  expect(client.query).toHaveBeenCalledTimes(2);
  expect(audit.log).not.toHaveBeenCalled();
 });
 it('releases reserved components atomically when an in-progress order is cancelled',async()=>{
  const client={query:vi.fn().mockImplementation(async(sql:string)=>{
   if(sql.includes('SELECT id,status,warehouse_id FROM manufacturing_production_orders'))return {rows:[{id:'order-1',status:'in_progress',warehouse_id:'warehouse-1'}],rowCount:1};
   if(sql.includes('SELECT material_product_id,reserved_quantity FROM manufacturing_order_materials'))return {rows:[{material_product_id:'material-1',reserved_quantity:3}],rowCount:1};
   if(sql.includes('UPDATE inventory_stock_levels SET reserved_quantity=reserved_quantity-$1'))return {rows:[{id:'stock-1'}],rowCount:1};
   if(sql.includes('SELECT * FROM manufacturing_production_orders'))return {rows:[{id:'order-1',status:'cancelled'}],rowCount:1};
   return {rows:[],rowCount:1};
  })};
  db.transaction.mockImplementation(async(callback:(client:unknown)=>Promise<unknown>)=>callback(client));
  const result=await service.cancelOrder(user,'order-1');
  expect(result.status).toBe('cancelled');
  expect(client.query).toHaveBeenCalledWith(expect.stringContaining('reserved_quantity=reserved_quantity-$1'),[3,'company-active','warehouse-1','material-1']);
  expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({action:'manufacturing.order.cancel',oldValues:{status:'in_progress'},newValues:{status:'cancelled'}}));
 });

 it('blocks production start when component stock is insufficient', async () => {
  const client = { query: vi.fn().mockImplementation(async (sql: string) => {
   if (sql.includes('SELECT id,status,warehouse_id,planned_quantity,bom_id FROM manufacturing_production_orders')) return { rows: [{ id: 'order-1', status: 'planned', warehouse_id: 'warehouse-1', planned_quantity: 2, bom_id: 'bom-1' }], rowCount: 1 };
   if (sql.includes('SELECT material_product_id,required_quantity,reserved_quantity FROM manufacturing_order_materials')) return { rows: [{ material_product_id: 'material-1', required_quantity: 5, reserved_quantity: 0 }], rowCount: 1 };
   if (sql.includes('UPDATE inventory_stock_levels SET reserved_quantity=reserved_quantity+$1')) return { rows: [], rowCount: 0 };
   return { rows: [], rowCount: 1 };
  }) };
  db.transaction.mockImplementation(async (callback: (client: unknown) => Promise<unknown>) => callback(client));
  await expect(service.startOrder(user, 'order-1')).rejects.toThrow('Insufficient available stock');
  expect(audit.log).not.toHaveBeenCalled();
 });
 it('posts balanced, idempotency-keyed journals when production is completed',async()=>{
  let journalNumber=0;
  const client={query:vi.fn().mockImplementation(async(sql:string,params:unknown[] = [])=>{
   if(sql.includes('SELECT o.id,o.status,o.warehouse_id,o.planned_quantity,o.produced_quantity,o.bom_id'))return {rows:[{id:'order-1',status:'in_progress',warehouse_id:'warehouse-1',planned_quantity:1,produced_quantity:0,bom_id:'bom-1',product_id:'finished-1',product_cost:0}],rowCount:1};
   if(sql.includes('SELECT material_product_id,required_quantity,reserved_quantity,consumed_quantity,unit_cost'))return {rows:[{material_product_id:'material-1',required_quantity:2,reserved_quantity:2,consumed_quantity:0,unit_cost:50}],rowCount:1};
   if(sql.includes('SELECT quantity,reserved_quantity,average_unit_cost FROM inventory_stock_levels'))return {rows:[{quantity:10,reserved_quantity:2,average_unit_cost:50}],rowCount:1};
   if(sql.includes('INSERT INTO journal_entry_sequences'))return {rows:[{next_number:journalNumber+1}],rowCount:1};
   if(sql.includes('INSERT INTO journal_entries'))return {rows:[{id:`journal-${++journalNumber}`}],rowCount:1};
   if(sql.includes('SELECT id FROM chart_of_accounts'))return {rows:[{id:params[1]==='inventory'?'account-inventory':'account-wip'}],rowCount:1};
   if(sql.includes('SELECT * FROM manufacturing_production_orders'))return {rows:[{id:'order-1',status:'completed',produced_quantity:1}],rowCount:1};
   return {rows:[],rowCount:1};
  })};
  db.transaction.mockImplementation(async(callback:(client:unknown)=>Promise<unknown>)=>callback(client));
  const result=await service.completeOrder(user,'order-1');
  expect(result.status).toBe('completed');
  expect(client.query).toHaveBeenCalledWith(expect.stringContaining('SET average_unit_cost=CASE WHEN quantity+$1>0'),expect.any(Array));
  expect(client.query).toHaveBeenCalledWith(expect.stringContaining('SET stock_quantity=COALESCE((SELECT SUM(quantity) FROM inventory_stock_levels WHERE company_id=$1 AND product_id=$2),0),cost_price=$3'),expect.any(Array));
  const journalEntries=client.query.mock.calls.filter((call:[string,unknown[]])=>call[0].includes('INSERT INTO journal_entries'));
  expect(journalEntries).toHaveLength(2);
  expect(journalEntries[0][1][3]).toBe('manufacturing_material_consumption');
  expect(journalEntries[1][1][3]).toBe('manufacturing_finished_goods');
  const lines=client.query.mock.calls.filter((call:[string,unknown[]])=>call[0].includes('INSERT INTO journal_entry_lines'));
  expect(lines).toHaveLength(4);
  expect(lines.map((call:[string,unknown[]])=>[call[1][4],call[1][5]])).toEqual([[100,0],[0,100],[100,0],[0,100]]);
  expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({action:'manufacturing.order.complete'}));
 });

 it('does not post production journals a second time for an already completed order',async()=>{
  let status='in_progress';
  let journalNumber=0;
  const client={query:vi.fn().mockImplementation(async(sql:string,params:unknown[] = [])=>{
   if(sql.includes('SELECT o.id,o.status,o.warehouse_id,o.planned_quantity,o.produced_quantity,o.bom_id'))return {rows:[{id:'order-1',status,warehouse_id:'warehouse-1',planned_quantity:1,produced_quantity:0,bom_id:'bom-1',product_id:'finished-1',product_cost:0}],rowCount:1};
   if(sql.includes('SELECT material_product_id,required_quantity,reserved_quantity,consumed_quantity,unit_cost'))return {rows:[{material_product_id:'material-1',required_quantity:2,reserved_quantity:2,consumed_quantity:0,unit_cost:50}],rowCount:1};
   if(sql.includes('SELECT quantity,reserved_quantity,average_unit_cost FROM inventory_stock_levels'))return {rows:[{quantity:10,reserved_quantity:2,average_unit_cost:50}],rowCount:1};
   if(sql.includes('INSERT INTO journal_entry_sequences'))return {rows:[{next_number:journalNumber+1}],rowCount:1};
   if(sql.includes('INSERT INTO journal_entries'))return {rows:[{id:`journal-${++journalNumber}`}],rowCount:1};
   if(sql.includes('SELECT id FROM chart_of_accounts'))return {rows:[{id:params[1]==='inventory'?'account-inventory':'account-wip'}],rowCount:1};
   if(sql.includes('UPDATE manufacturing_production_orders SET status=\'completed\'')){status='completed';return {rows:[],rowCount:1};}
   if(sql.includes('SELECT * FROM manufacturing_production_orders'))return {rows:[{id:'order-1',status,produced_quantity:1}],rowCount:1};
   return {rows:[],rowCount:1};
  })};
  db.transaction.mockImplementation(async(callback:(client:unknown)=>Promise<unknown>)=>callback(client));
  await service.completeOrder(user,'order-1');
  const entriesAfterFirstCompletion=client.query.mock.calls.filter((call:[string,unknown[]])=>call[0].includes('INSERT INTO journal_entries'));
  expect(entriesAfterFirstCompletion).toHaveLength(2);
  await expect(service.completeOrder(user,'order-1')).rejects.toThrow('Only in-progress production orders can be completed.');
  const entriesAfterRetry=client.query.mock.calls.filter((call:[string,unknown[]])=>call[0].includes('INSERT INTO journal_entries'));
  expect(entriesAfterRetry).toHaveLength(2);
 });

 it('records labour cost against WIP and posts a balanced journal in one transaction',async()=>{
  const client={query:vi.fn().mockImplementation(async(sql:string,params:unknown[] = [])=>{
   if(sql.includes('SELECT id,status FROM manufacturing_production_orders'))return {rows:[{id:'order-1',status:'in_progress'}],rowCount:1};
   if(sql.includes('SELECT id,account_type FROM chart_of_accounts'))return {rows:[{id:'expense-1',account_type:'expense'}],rowCount:1};
   if(sql.includes('INSERT INTO manufacturing_order_costs'))return {rows:[{id:'cost-1'}],rowCount:1};
   if(sql.includes('INSERT INTO journal_entry_sequences'))return {rows:[{next_number:1}],rowCount:1};
   if(sql.includes('INSERT INTO journal_entries'))return {rows:[{id:'journal-cost-1'}],rowCount:1};
   if(sql.includes('SELECT id FROM chart_of_accounts'))return {rows:[{id:params[1]==='work_in_progress'?'wip-account':'expense-1'}],rowCount:1};
   if(sql.includes('SELECT c.id,c.production_order_id,c.cost_type'))return {rows:[{id:'cost-1',cost_type:'labour',amount:'250',journal_entry_id:'journal-cost-1'}],rowCount:1};
   return {rows:[],rowCount:1};
  })};
  db.transaction.mockImplementation(async(callback:(client:unknown)=>Promise<unknown>)=>callback(client));
  const result=await service.addOrderCost(user,'order-1',{costType:'labour',description:'Assembly labour',amount:250,sourceAccountId:'expense-1'});
  expect(result.cost_type).toBe('labour');
  expect(client.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO journal_entry_lines'),expect.arrayContaining(['company-active','journal-cost-1']));
  expect(client.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE manufacturing_order_costs SET journal_entry_id'),['company-active','cost-1','journal-cost-1']);
  expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({action:'manufacturing.order.cost.create'}));
 });
 it('rejects labour and overhead costs on orders that are not in progress',async()=>{
  const client={query:vi.fn().mockResolvedValue({rows:[{id:'order-1',status:'planned'}],rowCount:1})};
  db.transaction.mockImplementation(async(callback:(client:unknown)=>Promise<unknown>)=>callback(client));
  await expect(service.addOrderCost(user,'order-1',{costType:'overhead',description:'Factory power',amount:100,sourceAccountId:'expense-1'})).rejects.toThrow('only be recorded against an in-progress');
  expect(client.query).toHaveBeenCalledTimes(1);
 });

 it('transfers material plus labour and overhead cost from WIP into finished inventory',async()=>{
  const client={query:vi.fn().mockImplementation(async(sql:string,params:unknown[] = [])=>{
   if(sql.includes('SELECT o.id,o.status,o.warehouse_id,o.planned_quantity,o.produced_quantity,o.bom_id'))return {rows:[{id:'order-1',status:'in_progress',warehouse_id:'warehouse-1',planned_quantity:1,produced_quantity:0,bom_id:'bom-1',product_id:'finished-1',product_cost:0}],rowCount:1};
   if(sql.includes('SELECT material_product_id,required_quantity,reserved_quantity,consumed_quantity,unit_cost'))return {rows:[{material_product_id:'material-1',required_quantity:2,reserved_quantity:2,consumed_quantity:0,unit_cost:50}],rowCount:1};
   if(sql.includes('SELECT quantity,reserved_quantity,average_unit_cost FROM inventory_stock_levels'))return {rows:[{quantity:10,reserved_quantity:2,average_unit_cost:50}],rowCount:1};
   if(sql.includes('SELECT COALESCE(SUM(amount),0)::numeric AS total FROM manufacturing_order_costs'))return {rows:[{total:250}],rowCount:1};
   if(sql.includes('INSERT INTO journal_entry_sequences'))return {rows:[{next_number:1}],rowCount:1};
   if(sql.includes('INSERT INTO journal_entries'))return {rows:[{id:'journal-1'}],rowCount:1};
   if(sql.includes('SELECT id FROM chart_of_accounts'))return {rows:[{id:params[1]==='inventory'?'inventory-account':'wip-account'}],rowCount:1};
   if(sql.includes('SELECT * FROM manufacturing_production_orders'))return {rows:[{id:'order-1',status:'completed',produced_quantity:1}],rowCount:1};
   return {rows:[],rowCount:1};
  })};
  db.transaction.mockImplementation(async(callback:(client:unknown)=>Promise<unknown>)=>callback(client));
  await service.completeOrder(user,'order-1');
  const journalLines=client.query.mock.calls.filter((call:[string,unknown[]])=>call[0].includes('INSERT INTO journal_entry_lines'));
  expect(journalLines).toHaveLength(4);
  expect(journalLines.map((call:[string,unknown[]])=>[call[1][4],call[1][5]])).toEqual([[100,0],[0,100],[350,0],[0,350]]);
  const finishedGoodsJournal=client.query.mock.calls.find((call:[string,unknown[]])=>call[0].includes('INSERT INTO journal_entries')&&call[1][3]==='manufacturing_finished_goods');
  expect(finishedGoodsJournal).toBeDefined();
 });

 it('rejects duplicate completion before changing stock or posting journals',async()=>{
  const client={query:vi.fn().mockImplementation(async(sql:string)=>{
   if(sql.includes('SELECT o.id,o.status,o.warehouse_id,o.planned_quantity,o.produced_quantity,o.bom_id'))return {rows:[{id:'order-1',status:'completed',warehouse_id:'warehouse-1',planned_quantity:1,produced_quantity:1,bom_id:'bom-1',product_id:'finished-1',product_cost:150}],rowCount:1};
   return {rows:[],rowCount:1};
  })};
  db.transaction.mockImplementation(async(callback:(client:unknown)=>Promise<unknown>)=>callback(client));
  await expect(service.completeOrder(user,'order-1')).rejects.toThrow('Only in-progress production orders can be completed.');
  expect(client.query).toHaveBeenCalledTimes(1);
  expect(client.query.mock.calls.some((call:[string,unknown[]])=>call[0].includes('INSERT INTO journal_entries'))).toBe(false);
  expect(audit.log).not.toHaveBeenCalled();
 });
 it('does not mark an order cancelled when a component reservation cannot be released',async()=>{
  const client={query:vi.fn().mockImplementation(async(sql:string)=>{
   if(sql.includes('SELECT id,status,warehouse_id FROM manufacturing_production_orders'))return {rows:[{id:'order-1',status:'in_progress',warehouse_id:'warehouse-1'}],rowCount:1};
   if(sql.includes('SELECT COUNT(*)::int AS count FROM manufacturing_order_costs'))return {rows:[{count:0}],rowCount:1};
   if(sql.includes('SELECT material_product_id,reserved_quantity FROM manufacturing_order_materials'))return {rows:[{material_product_id:'material-1',reserved_quantity:3}],rowCount:1};
   if(sql.includes('UPDATE inventory_stock_levels SET reserved_quantity=reserved_quantity-$1'))return {rows:[],rowCount:0};
   return {rows:[],rowCount:1};
  })};
  db.transaction.mockImplementation(async(callback:(client:unknown)=>Promise<unknown>)=>callback(client));
  await expect(service.cancelOrder(user,'order-1')).rejects.toThrow('Material reservation could not be released safely');
  expect(client.query.mock.calls.some((call:[string,unknown[]])=>call[0].includes("SET status='cancelled'"))).toBe(false);
  expect(audit.log).not.toHaveBeenCalled();
 });

 it('aborts production completion when a required WIP control account is unavailable',async()=>{
  const client={query:vi.fn().mockImplementation(async(sql:string,params:unknown[] = [])=>{
   if(sql.includes('SELECT o.id,o.status,o.warehouse_id,o.planned_quantity,o.produced_quantity,o.bom_id'))return {rows:[{id:'order-1',status:'in_progress',warehouse_id:'warehouse-1',planned_quantity:1,produced_quantity:0,bom_id:'bom-1',product_id:'finished-1',product_cost:0}],rowCount:1};
   if(sql.includes('SELECT material_product_id,required_quantity,reserved_quantity,consumed_quantity,unit_cost'))return {rows:[{material_product_id:'material-1',required_quantity:2,reserved_quantity:2,consumed_quantity:0,unit_cost:50}],rowCount:1};
   if(sql.includes('SELECT quantity,reserved_quantity,average_unit_cost FROM inventory_stock_levels'))return {rows:[{quantity:10,reserved_quantity:2,average_unit_cost:50}],rowCount:1};
   if(sql.includes('INSERT INTO journal_entry_sequences'))return {rows:[{next_number:1}],rowCount:1};
   if(sql.includes('INSERT INTO journal_entries'))return {rows:[{id:'journal-1'}],rowCount:1};
   if(sql.includes('SELECT id FROM chart_of_accounts'))return {rows:params[1]==='work_in_progress'?[{id:'account-wip'}]:[],rowCount:params[1]==='work_in_progress'?1:0};
   return {rows:[],rowCount:1};
  })};
  db.transaction.mockImplementation(async(callback:(client:unknown)=>Promise<unknown>)=>callback(client));
  await expect(service.completeOrder(user,'order-1')).rejects.toThrow('Required accounting account "inventory" is missing or inactive.');
  expect(db.transaction).toHaveBeenCalledTimes(1);
  expect(audit.log).not.toHaveBeenCalled();
 });

});
