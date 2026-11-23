'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const C=require('../js/core.js');

const readScript=name=>fs.readFileSync(path.join(__dirname,'../js',name),'utf8');
const app=readScript('app.js').replace(' render();init();','');
const i18n=readScript('i18n.js');

function setup(fetch){
 const ledger=C.empty();
 const stock=C.createPosition({name:'中油资本',code:'000617',price:10,basePrice:8,baseQty:100,mobileAmount:1000},ledger.settings);
 C.addLot(stock,{price:9,qty:100},ledger.settings);
 ledger.stocks.push(stock);
 const modal={addEventListener(){},close(){}};
 const button={dataset:{id:stock.id},isConnected:true,setAttribute(){},removeAttribute(){}};
 const context=vm.createContext({LedgerCore:C,fetch,TextDecoder,AbortController,setTimeout,clearTimeout,structuredClone,ledger,button,
  document:{querySelector:selector=>selector.includes('data-dirty')?null:modal,addEventListener(){}}});
 vm.runInContext(i18n,context);
 vm.runInContext(app,context);
 const run=script=>vm.runInContext(script,context);
 run('state=ledger;ready=true;write=async next=>{state=next;};toast=message=>{globalThis.message=message;};');
 return {ledger,stock,button,context,run,refresh:()=>run("action('refresh-quote',button)")};
}

function quoteResponse({code='000617',price='12.345',timestamp='20251219150000'}={}){
 const fields=Array(31).fill('');
 fields[2]=code;
 fields[3]=price;
 fields[30]=timestamp;
 return new Response(`v_sz000617="${fields.join('~')}";\n`);
}

test('manual refresh sends only the stock symbol and updates valuation without changing trade records',async()=>{
 let requests=0;
 const {stock,button,context,run,refresh}=setup(async(url,options)=>{
  requests++;
  assert.equal(url,'https://qt.gtimg.cn/q=sz000617');
  assert.equal(options.credentials,'omit');
  assert.equal(options.body,undefined);
  return quoteResponse();
 });
 assert.equal(requests,0);
 const refreshPending=refresh();
 assert.equal(button.disabled,true);
 await refresh();
 await refreshPending;
 const saved=run('state.stocks[0]');
 assert.equal(requests,1);
 assert.equal(saved.price,12.345);
 assert.equal(C.stats(saved).value,2469);
 assert.deepEqual(saved.lots,stock.lots);
 assert.deepEqual(saved.cash,stock.cash);
 assert.deepEqual(saved.history,stock.history);
 assert.match(context.message,/2025-12-19 15:00/);
 assert.equal(button.disabled,false);
});

test('wrong symbols, invalid quotes and rate limits leave the saved price untouched',async()=>{
 for(const response of [quoteResponse({code:'000567'}),quoteResponse({price:'0'}),quoteResponse({timestamp:'20251219250000'}),new Response(null,{status:429})]){
  const {ledger,button,run,refresh}=setup(async()=>response);
  await assert.rejects(refresh(),/No valid quote|Too many quote requests/);
  assert.equal(run('state'),ledger);
  assert.equal(button.disabled,false);
 }
});

test('stock codes keep leading zeros and remain optional for older backups',()=>{
 const {ledger,stock}=setup(()=>{});
 assert.equal(C.validate(ledger).stocks[0].code,'000617');
 delete stock.code;
 assert.equal(C.validate(ledger).stocks[0].code,'');
});

test('phone cards use aligned table sections and bind portrait refresh to the correct stock',()=>{
 const {stock,run}=setup(()=>{});
 const html=run('stockCard(state.stocks[0],true)');
 const table=html.match(/<div class="phone-table-scroll"[^>]*><table>([\s\S]*?)<\/table>/)[1];
 assert.equal((table.match(/<col /g)||[]).length,7);
 assert.equal((table.match(/<th scope="col"/g)||[]).length,7);
 for(const section of ['tbody','tfoot']){
  const row=table.match(new RegExp('<'+section+'><tr[^>]*>([\\s\\S]*?)</tr>'))[1];
  assert.equal((row.match(/<td[ >]/g)||[]).length,7);
 }
 assert.ok(!html.includes('data-open-stock'));
 assert.match(html,/class="stock-name-line">[\s\S]*?<\/form><button class="quote-refresh quote-icon"/);
 assert.ok(html.includes('class="quote-refresh quote-icon" type="button" data-action="refresh-quote" data-id="'+stock.id+'"'));
 const desktop=run('stockCard(state.stocks[0],false)');
 assert.ok(!desktop.includes('phone-table-scroll')&&!desktop.includes('quote-icon'));
});

test('phone cards keep their editable quote and omit the date column in both populated and empty tables',()=>{
 const {stock,run}=setup(()=>{});
 const phone=run('stockCard(state.stocks[0],true)');
 const desktop=run('stockCard(state.stocks[0],false)');
 assert.equal((phone.match(/class="stock-current-price"/g)||[]).length,1);
 assert.ok(phone.includes('data-stock="'+stock.id+'"'));
 assert.doesNotMatch(phone,/class="purchase-date"|Swipe to see all columns|>Total</);
 assert.match(desktop,/class="purchase-date"/);
 assert.ok(phone.indexOf('class="base-panel"') < phone.indexOf('class="card-action-bar"'));
 assert.ok(phone.indexOf('class="card-action-bar"') < phone.indexOf('class="phone-lots"'));
 const bar=phone.match(/<section class="card-action-bar">(.*?)<\/section>/)[1];
 assert.doesNotMatch(bar,/data-action="move-(?:up|down)"/);
 assert.match(desktop,/data-action="move-up"/);
 assert.match(desktop,/data-action="move-down"/);
 for(const action of ['edit-stock','history','buy']){
  assert.ok(bar.includes('data-action="'+action+'" data-id="'+stock.id+'"'));
 }
 assert.match(run('phoneLots(state.stocks[0],[])'),/<td colspan="7">/);
});

test('switching the pinned stock during a quote request updates only the original stock',async()=>{
 const {stock,ledger,button,run,refresh}=setup(async()=>quoteResponse());
 const other=C.createPosition({name:'Other',code:'000001',price:8,basePrice:8,baseQty:100},ledger.settings);
 ledger.stocks.push(other);
 const pending=refresh();
 button.isConnected=false;
 await pending;
 assert.equal(run('state').stocks.find(s=>s.id===stock.id).price,12.345);
 assert.equal(run('state').stocks.find(s=>s.id===other.id).price,8);
});

test('the visible stock and its table position survive a render or reorder',()=>{
 const {stock,ledger,context,run}=setup(()=>{});
 const second=C.createPosition({name:'Second',price:9,basePrice:8,baseQty:100},ledger.settings);
 ledger.stocks.push(second);
 const card=id=>({dataset:{stockId:id},table:{scrollTop:0,scrollLeft:0},querySelector(){return this.table;}});
 const deck={
  clientHeight:640,scrollTop:640,children:[card(stock.id),card(second.id)],
  set innerHTML(html){
   this.children=Array.from(html.matchAll(/data-stock-id="([^"]+)"/g),m=>card(m[1]));
   this.scrollTop=0;
  }
 };
 deck.children[1].table={scrollTop:60,scrollLeft:45};
 context.deck=deck;
 run('renderStocks(deck,true)');
 assert.equal(deck.scrollTop,640);
 assert.deepEqual(deck.children[1].table,{scrollTop:60,scrollLeft:45});
 ledger.stocks.reverse();
 run('renderStocks(deck,true)');
 assert.equal(deck.scrollTop,0);
 assert.equal(deck.children[0].dataset.stockId,second.id);
 assert.deepEqual(deck.children[0].table,{scrollTop:60,scrollLeft:45});
 ledger.stocks.shift();
 run('renderStocks(deck,true)');
 assert.equal(deck.children[0].dataset.stockId,stock.id);
 assert.deepEqual(deck.children[0].table,{scrollTop:0,scrollLeft:0});
});

test('sticky table surfaces gain backing only while they cover other cells',()=>{
 const {context,run}=setup(()=>{});
 const active=new Set();
 const viewport={scrollHeight:300,clientHeight:100,scrollTop:0,scrollLeft:0,
  classList:{toggle(name,on){if(on)active.add(name);else active.delete(name);}}};
 context.viewport=viewport;
 const check=(top,left,expected)=>{
  Object.assign(viewport,{scrollTop:top,scrollLeft:left});
  run('syncTableScroll(viewport)');
  assert.deepEqual(active,new Set(expected));
 };
 check(0,0,['has-more-rows','foot-over-data']);
 check(50,100,['has-more-rows','foot-over-data','head-over-data','frozen-over-data']);
 check(200,0,['has-more-rows','head-over-data']);
 viewport.scrollHeight=100;
 check(0,0,[]);
});
