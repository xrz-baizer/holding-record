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
 const header=html.match(/<div class="phone-table-head"[^>]*><table>([\s\S]*?)<\/table>/)[1];
 assert.match(header,/<colgroup span="7"><\/colgroup>/);
 assert.match(table,/<colgroup span="7"><\/colgroup>/);
 assert.match(header,/<thead>/);
 assert.match(table,/<thead class="lot-table-accessible-head">/);
 assert.equal((table.match(/<th scope="col"/g)||[]).length,7);
 const groups=[...table.matchAll(/<tbody[^>]*>([\s\S]*?)<\/tbody>/g)];
 assert.equal(groups.length,1);
 for(const [,rows] of groups){
  const footer=rows.match(/<tr class="trade-summary"[^>]*>([\s\S]*?)<\/tr>/)[1];
  assert.equal((footer.match(/<td[ >]/g)||[]).length,7);
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
 assert.doesNotMatch(phone,/class="card-action-bar"|class="phone-lots-heading"/);
 for(const action of ['edit-stock','history','move-up','move-down']){
  assert.ok(desktop.includes('data-action="'+action+'" data-id="'+stock.id+'"'));
  assert.ok(!phone.includes('data-action="'+action+'" data-id="'+stock.id+'"'));
 }
 assert.match(phone,/<div class="mobile-lot-tools"><div class="mobile-capacity">.*?<\/div><button[^>]*class="primary mobile-lot-button"[^>]*data-action="buy"/);
 assert.ok(phone.includes('data-action="buy" data-id="'+stock.id+'"'));
 assert.ok(desktop.includes('data-action="buy" data-id="'+stock.id+'"'));
 assert.doesNotMatch(desktop,/class="mobile-lot-tools"/);
 assert.match(run('stockCodeField()'),/required inputmode="numeric" pattern="\[0-9\]\{6\}"/);
 for(const phoneLayout of [true,false]){
  const empty=run(`lotsPanel({...state.stocks[0],lots:[]},${phoneLayout})`);
  assert.match(empty,/<thead>/);
  assert.doesNotMatch(empty,/<tbody|trade-summary|No trading lots/);
 }
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

test('the phone header tracks horizontal position without changing color on vertical scroll',()=>{
 const {context,run}=setup(()=>{});
 const active=new Set(),headerActive=new Set();
 const frameStyle=new Map();
 const toggles=set=>({toggle(name,on){if(on)set.add(name);else set.delete(name);}});
 const header={scrollLeft:0,classList:toggles(headerActive)};
 const viewport={scrollHeight:300,clientHeight:100,scrollTop:0,scrollLeft:0,
  parentElement:{style:{setProperty(name,value){frameStyle.set(name,value);}}},
  matches:selector=>selector==='.phone-table-scroll',previousElementSibling:header,classList:toggles(active)};
 context.viewport=viewport;
 run('syncTableScroll(viewport)');
 assert.deepEqual(active,new Set(['has-more-rows']));
 viewport.scrollTop=50;
 viewport.scrollLeft=100;
 run('syncTableScroll(viewport)');
 assert.equal(header.scrollLeft,100);
 assert.equal(frameStyle.get('--lot-scroll-left'),'100px');
 assert.deepEqual(headerActive,new Set(['frozen-over-data']));
 assert.deepEqual(active,new Set(['has-more-rows','frozen-over-data']));
 viewport.scrollTop=200;
 viewport.scrollLeft=0;
 run('syncTableScroll(viewport)');
 assert.equal(header.scrollLeft,0);
 assert.equal(frameStyle.get('--lot-scroll-left'),'0px');
 assert.equal(headerActive.size,0);
 assert.deepEqual(active,new Set(['has-more-rows']));
 viewport.matches=()=>false;
 Object.assign(viewport,{offsetWidth:400,clientWidth:385,scrollLeft:60});
 header.style={};
 run('syncTableScroll(viewport)');
 assert.equal(header.style.marginInlineEnd,'15px');
 assert.equal(header.scrollLeft,60);
 assert.ok(!active.has('head-over-data'));
});

test('reverse sales and buybacks appear on both stock layouts and in history',()=>{
 const {stock,ledger,run}=setup(()=>{});
 for(const price of [7,8])C.addLot(stock,{price,qty:100},ledger.settings,{allowTopUp:true});
 const trade=C.openReverse(stock,{price:11,qty:100,date:C.today()},ledger.settings);
 for(const phone of [true,false]){
  const card=run(`stockCard(state.stocks[0],${phone})`);
  assert.match(card,/class="reverse-row"/);
  assert.doesNotMatch(card,/reverse-label|data-action="edit-lot"/);
  assert.ok(card.includes('data-action="settle" data-id="'+stock.id+'"'));
  assert.ok(card.includes('data-action="cover-reverse" data-id="'+stock.id+'" data-lot="'+trade.id+'"'));
  assert.equal((card.match(/<thead>/g)||[]).length,1);
  assert.equal((card.match(/<table[ >]/g)||[]).length,2);
  assert.doesNotMatch(card,/class="trade-group-title"/);
  const summaries=[...card.matchAll(/<tr class="trade-summary"[^>]*>([\s\S]*?)<\/tr>/g)];
  assert.equal(summaries.length,2);
  assert.match(summaries[0][1],/data-action="sell-all"/);
  assert.doesNotMatch(summaries[1][1],/data-action="sell-all"/);
  assert.match(summaries[1][1],/data-action="cover-all"/);
  const firstGroup=card.match(/<tbody aria-label="Buy first">([\s\S]*?)<\/tbody>/)[1];
  assert.equal((firstGroup.match(/data-action="settle"/g)||[]).length,3);
  assert.ok(firstGroup.lastIndexOf('data-action="settle"')<firstGroup.indexOf('class="trade-summary"'));
  if(!phone){
   const head=card.match(/<div class="trade-panel-head"[^>]*>([\s\S]*?)<\/div>/)[1];
   const body=card.match(/<div class="trade-panel-scroll"[^>]*>([\s\S]*?)<\/div>/)[1];
   assert.match(head,/<colgroup span="9"><\/colgroup><thead>/);
   assert.doesNotMatch(head,/<tbody/);
   assert.match(body,/<colgroup span="9"><\/colgroup><thead class="lot-table-accessible-head">/);
   assert.match(head,/<th scope="col">Type<\/th>/);
   assert.match(card,/<td>Buy first<\/td>/);
   assert.match(card,/<td>Sell first<\/td>/);
   for(const [,summary] of summaries){
    assert.equal((summary.match(/<td[ >]/g)||[]).length,9);
    assert.match(summary,/<td><\/td><td><\/td>\s*<td class="row-actions">/);
   }
  }

 }
 const chinese=run("I18n.setLanguage('zh');stockCard(state.stocks[0],true)");
 assert.match(chinese,/aria-label="全部卖出">全部<br>卖出<\/button>/);
 assert.match(chinese,/aria-label="全部买回">全部<br>买回<\/button>/);
 run("I18n.setLanguage('en')");
 assert.match(run('historyRow(state.stocks[0],C.reverseEntries(state.stocks[0])[0])'),/Reverse sale.*data-action="undo-reverse"/);
 const reverseOnly=run('lotsPanel({...state.stocks[0],lots:[]},true)');
 assert.match(reverseOnly,/<tbody aria-label="Sell first">/);
 assert.doesNotMatch(reverseOnly,/<tbody aria-label="Buy first">|No trading lots/);
 C.coverReverse(stock,trade.id,{price:9,qty:100,date:C.today()},ledger.settings);
 assert.doesNotMatch(run('stockCard(state.stocks[0],true)'),/data-action="cover-(?:reverse|all)"|<tbody aria-label="Sell first">/);
});
