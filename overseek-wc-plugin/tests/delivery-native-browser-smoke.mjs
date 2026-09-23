/** Native browser smoke using Node's WebSocket CDP client, no browser dependencies. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const directory=fs.realpathSync(process.argv[2]);
const fixture=JSON.parse(fs.readFileSync(path.join(directory,'fixture.json'),'utf8'));
const origin=new URL(fixture.origin).origin;
assert.match(origin,/^http:\/\/127\.0\.0\.1:\d+$/);
const binary=process.env.OVERSEEK_HEADLESS_SHELL;
assert.ok(binary&&fs.existsSync(binary),'Set OVERSEEK_HEADLESS_SHELL to installed chrome-headless-shell');
const profile=fs.mkdtempSync(path.join(directory,'chrome-'));
const fontDirectory=process.env.OVERSEEK_BROWSER_FONT_DIR;
assert.ok(fontDirectory&&fs.existsSync(fontDirectory),'Set OVERSEEK_BROWSER_FONT_DIR to existing local fonts');
const fontCache=path.join(profile,'font-cache');fs.mkdirSync(fontCache);
const xml=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const fonts=path.join(profile,'fonts.conf');
fs.writeFileSync(fonts,`<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>${xml(fontDirectory)}</dir><cachedir>${xml(fontCache)}</cachedir><alias><family>sans-serif</family><prefer><family>Liberation Sans</family></prefer></alias></fontconfig>`);
const log=fs.openSync(path.join(directory,'chrome.log'),'a');
const chrome=spawn(binary,['--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-component-update','--disable-sync','--disable-default-apps','--no-first-run','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost','about:blank'],{stdio:['ignore',log,log],env:{...process.env,FONTCONFIG_FILE:fonts,FONTCONFIG_PATH:profile,XDG_CACHE_HOME:path.join(profile,'cache')}});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const wait=async(fn,label,timeout=15000)=>{const start=Date.now();while(Date.now()-start<timeout){const value=await fn();if(value)return value;await sleep(100);}throw Error('Timeout: '+label);};
let socket;let sequence=0;const pending=new Map();const network=[];const bodies=new Map();const runtimeErrors=[];const remote=[];const domEvents=[];const checks=[];
let send;
const check=(ok,message)=>{assert.ok(ok,message);checks.push(message);console.log('PASS '+message);};
const resultFile=path.join(directory,'browser-results.json');
const serverLog=path.join(directory,'server-events.jsonl');
const serverStart=fs.existsSync(serverLog)?fs.readFileSync(serverLog,'utf8').trim().split('\n').filter(Boolean).length:0;
let failure=null;let version;let summary;
try {
 const active=path.join(profile,'DevToolsActivePort');await wait(()=>fs.existsSync(active),'headless CDP startup');
 const port=Number(fs.readFileSync(active,'utf8').split('\n')[0]);
 const target=await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'}).then(r=>r.json());
 socket=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 socket.addEventListener('message',async event=>{
  const data=JSON.parse(event.data);
  if(data.id){const task=pending.get(data.id);if(task){pending.delete(data.id);data.error?task.reject(Error(JSON.stringify(data.error))):task.resolve(data.result);}return;}
  const p=data.params;
  if(data.method==='Fetch.requestPaused'){
   const url=p.request.url;
   if(url.startsWith(origin+'/')||url.startsWith('data:')||url==='about:blank')await send('Fetch.continueRequest',{requestId:p.requestId});
   else{remote.push(url);await send('Fetch.failRequest',{requestId:p.requestId,errorReason:'BlockedByClient'});}
  }
  if(data.method==='Network.requestWillBeSent')network.push({id:p.requestId,url:p.request.url,method:p.request.method,type:p.type,postData:p.request.postData,timestamp:p.timestamp});
  if(data.method==='Network.responseReceived'){const row=network.findLast(row=>row.id===p.requestId);if(row){row.status=p.response.status;row.headers=p.response.headers;}}
  if(data.method==='Network.loadingFinished'){
   const row=network.findLast(row=>row.id===p.requestId);
   if(row&&(row.type==='Document'||row.url.includes('wc-ajax=overseek_delivery_estimates'))){try{const body=await send('Network.getResponseBody',{requestId:p.requestId});bodies.set(p.requestId,body.base64Encoded?Buffer.from(body.body,'base64').toString():body.body);}catch(error){row.bodyError=error.message;}}
  }
  if(data.method==='Runtime.exceptionThrown')runtimeErrors.push(p.exceptionDetails.text+' '+(p.exceptionDetails.exception?.description||''));
  if(data.method==='Page.lifecycleEvent'&&p.name==='DOMContentLoaded')domEvents.push(p.timestamp);
 });
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');await send('Page.setLifecycleEventsEnabled',{enabled:true});await send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
 version=await send('Browser.getVersion');
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const ajax=()=>network.filter(row=>row.url.includes('wc-ajax=overseek_delivery_estimates')&&bodies.has(row.id));
 const view=()=>evaluate(`({width:innerWidth,scrollWidth:document.documentElement?.scrollWidth||0,nodes:[...document.querySelectorAll('.os-delivery-placeholder')].map(n=>({text:n.textContent,product:n.dataset.productId,request:n.dataset.requestId,width:n.getBoundingClientRect().width,right:n.getBoundingClientRect().right})),variation:document.querySelector('[name=variation_id]')?.value,quantity:document.querySelector('[name=quantity]')?.value})`);
 const safeHtml=html=>!html.includes('12 Native Customer Secret Road')&&!html.includes('Private Fixture City');
 for(const width of [320,390,1280]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
  for(const kind of ['simple','variable']){
   const startAjax=ajax().length;const navStart=network.length;
   await send('Page.navigate',{url:kind==='simple'?fixture.simpleUrl:fixture.variableUrl});
   await wait(async()=>{const v=await view();return v.nodes.length===2&&ajax().length>startAjax;},`${width} ${kind} DOMContentLoaded AJAX`);
   const initial=ajax().at(-1);const documentRow=network.slice(navStart).find(row=>row.type==='Document');
   await wait(()=>documentRow&&bodies.has(documentRow.id),'document response body');
   const html=bodies.get(documentRow.id);fs.writeFileSync(path.join(directory,`${kind}-${width}.html`),html);
   check(safeHtml(html),`${kind} ${width}: no customer address in original HTML`);
   check(!html.includes('Estimated delivery:'),`${kind} ${width}: original HTML contains placeholders, not personalized dates`);
   check(domEvents.some(time=>time<=initial.timestamp),`${kind} ${width}: real AJAX follows DOMContentLoaded`);
   if(kind==='variable'){
    check((await view()).nodes.every(n=>n.text===''),`${width}: unselected variable stays blank`);
    const count=ajax().length;
    await evaluate(`(()=>{const s=document.querySelector('.variations select');s.value='Small';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await wait(async()=>{const v=await view();return v.variation===String(fixture.ownership.data.children[0])&&v.nodes.every(n=>n.text.includes('Estimated delivery:'))&&ajax().length>count;},'native Small variation event and response');
    check(true,`${width}: native variation selection populates block and shortcode`);
   }else await wait(async()=>(await view()).nodes.every(n=>n.text.includes('Estimated delivery:')),'simple placement dates');
   let count=ajax().length;
   await evaluate(`(()=>{const q=document.querySelector('[name=quantity]');q.value='3';q.dispatchEvent(new Event('input',{bubbles:true}));q.dispatchEvent(new Event('change',{bubbles:true}));})()`);
   await wait(()=>ajax().length>count&&JSON.parse(ajax().at(-1).postData).items.every(item=>item.quantity===3),'real quantity input AJAX');
   await wait(async()=>(await view()).nodes.every(n=>n.text.includes('Estimated delivery:')),'quantity result rendered');
   check(true,`${kind} ${width}: quantity control sends actual quantity=3`);
   if(kind==='variable'){
    count=ajax().length;await evaluate(`(()=>{const s=document.querySelector('.variations select');s.value='Large';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await wait(async()=>{const v=await view();return v.variation===String(fixture.ownership.data.children[1])&&v.nodes.every(n=>n.text.includes('Estimated delivery:'))&&ajax().length>count;},'native Large variation response');
    check(JSON.parse(ajax().at(-1).postData).items.every(item=>item.variation_id===fixture.ownership.data.children[1]),`${width}: second native variation identity reaches AJAX`);
   }
   const v=await view();check(v.scrollWidth<=width&&v.nodes.every(n=>n.right<=width+1),`${kind} ${width}: no horizontal overflow`);
   check(v.nodes[0].text===v.nodes[1].text,`${kind} ${width}: block and shortcode agree`);
   const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(directory,`${kind}-${width}.png`),Buffer.from(screenshot.data,'base64'));
   if(kind==='variable'){
    count=ajax().length;await evaluate(`(()=>{const s=document.querySelector('.variations select');s.value='';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await wait(async()=>(await view()).nodes.every(n=>n.text==='')&&ajax().length>count,'native variation reset');check(true,`${width}: variation reset clears both estimates`);
   }
  }
 }
 // Establish a real native customer session, then ensure it is not embedded in page HTML.
 const seeded=await evaluate(`fetch(${JSON.stringify(origin+'/__native-session')},{method:'POST',headers:{'X-Native-Fixture':${JSON.stringify(fixture.ownership.data.token)}}}).then(r=>r.status)`);
 check(seeded===204,'Real private-address Woo customer session created locally');
 const before=network.length;const count=ajax().length;await send('Page.navigate',{url:fixture.simpleUrl});
 await wait(()=>network.slice(before).some(row=>row.type==='Document'&&bodies.has(row.id))&&ajax().length>count,'personalized-session page and AJAX');
 const doc=network.slice(before).find(row=>row.type==='Document');check(safeHtml(bodies.get(doc.id)),'Existing customer address remains absent from public product HTML');
 await wait(async()=>(await view()).nodes.every(n=>n.text===''),'known address without certified quote stays blank');
 check(true,'Known address without a native certified quote stays blank; no rate recalculation');
 for(const row of ajax()){
  const cache=Object.entries(row.headers||{}).find(([key])=>key.toLowerCase()==='cache-control')?.[1]||'';
  check(row.status===200&&cache.includes('no-store'),`Local AJAX ${row.id}: 200 and no-store`);
  check(safeHtml(bodies.get(row.id)),'AJAX response contains no customer address');
 }
 check(remote.length===0,'No remote browser requests or remote quotes attempted');check(runtimeErrors.length===0,'No browser runtime exceptions');
 const events=fs.readFileSync(serverLog,'utf8').trim().split('\n').filter(Boolean).slice(serverStart).map(JSON.parse);
 const deliveryEvents=events.filter(row=>row.uri.includes('wc-ajax=overseek_delivery_estimates'));
 check(deliveryEvents.length>=ajax().length,'Native server recorded delivery AJAX requests');
 check(deliveryEvents.every(row=>row.httpAttempts===0&&row.shippingCalculations===0&&row.mailAttempts===0),'Actual AJAX attempted zero server HTTP, shipping calculations and mail');
 summary={checks:checks.length,localAjax:ajax().length,totalBrowserRequests:network.length,remoteRequests:remote.length,ajaxQueryCounts:deliveryEvents.map(row=>row.queries)};
 console.log(JSON.stringify({version,...summary}));
}catch(error){
 failure=error.stack||String(error);console.error(failure);process.exitCode=1;
 if(send&&socket?.readyState===WebSocket.OPEN){
  try{
   const geometry=await send('Runtime.evaluate',{expression:`({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('body *')].map(e=>({tag:e.tagName,classes:e.className,text:e.textContent.slice(0,120),left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right})).filter(e=>e.right>innerWidth+1||e.left< -1)})`,returnByValue:true});
   fs.writeFileSync(path.join(directory,'failure-geometry.json'),JSON.stringify(geometry.result.value,null,2));
   const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(directory,'failure.png'),Buffer.from(screenshot.data,'base64'));
  }catch{}
 }
}
finally{
 fs.writeFileSync(resultFile,JSON.stringify({version,summary,checks,network,remote,runtimeErrors,failure},null,2));
 if(socket?.readyState===WebSocket.OPEN)socket.close();
 if(chrome.exitCode===null){chrome.kill('SIGTERM');await new Promise(resolve=>{chrome.once('exit',resolve);setTimeout(resolve,2000);});}
 fs.closeSync(log);
}
