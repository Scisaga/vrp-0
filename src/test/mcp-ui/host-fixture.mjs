import fs from 'node:fs';
import { createRequire } from 'node:module';
import { test, expect } from '../../main/resources/META-INF/resources/static/node_modules/@playwright/test/index.mjs';
export { test, expect };

const artifacts = {
  map:new URL('../../main/resources/META-INF/resources/static/mcp-map-app.html', import.meta.url),
  gantt:new URL('../../main/resources/META-INF/resources/static/mcp-gantt-app.html', import.meta.url)
};
const payloads = JSON.parse(fs.readFileSync(new URL('../../../docs/integrations/gateway/fixtures/mcp-result-view/payloads.json', import.meta.url), 'utf8'));
export const message = (name='ready') => {
  const value=structuredClone(payloads.find(item=>item.name===name).message);
  return value;
};
export const JOB = message()._meta.gateway_ui.job_id;
export const VERSION = message()._meta.gateway_ui.image_version_id;
export const TOOL = message()._meta.gateway_ui.display_tool_name;
export const AGENT = message()._meta.gateway_ui.engine_view.solver_job.plan.agents[0].id;
const require = createRequire(new URL('../../main/resources/META-INF/resources/static/package.json', import.meta.url));
const policies = {map:require('./scripts/build-mcp-app.cjs').readNetworkPolicy('map'),gantt:require('./scripts/build-mcp-app.cjs').readNetworkPolicy('gantt')};
export const strictCsp = kind => { const {connectDomains,resourceDomains}=policies[kind]; return `default-src 'none'; script-src 'unsafe-inline' ${resourceDomains.join(' ')}; style-src 'unsafe-inline' ${resourceDomains.join(' ')}; img-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; frame-ancestors http://mcp-host.test; base-uri 'none'; form-action 'none'`; };
export const STRICT_CSP = strictCsp('map');

const hostDocument = `<!doctype html><html><head><meta charset="utf-8"><title>Synthetic MCP Apps Host</title></head><body><script>
const cards=new Map();let nextId=1000;
const send=(card,message)=>card.frame.contentWindow.postMessage(message,'*');
window.host={cards,
  add(options){const card={...options,wire:[],pending:[],acks:[],initialized:false};const frame=document.createElement('iframe');frame.name=options.id;frame.id=options.id;frame.setAttribute('sandbox','allow-scripts');frame.style.cssText='border:0;display:block;width:'+ (options.width||1100)+'px;height:'+(options.height||800)+'px';card.frame=frame;cards.set(card.id,card);frame.src='http://mcp-app.test/app.html?id='+encodeURIComponent(card.id)+'&kind='+encodeURIComponent(options.kind||'map');document.body.append(frame)},
  notify(id,method,params){send(cards.get(id),{jsonrpc:'2.0',method,params})},
  result(id,result){this.notify(id,'ui/notifications/tool-result',result)},
  context(id,context){const card=cards.get(id);Object.assign(card.context,context);this.notify(id,'ui/notifications/host-context-changed',context)},
  respond(id,index,result,error){const card=cards.get(id),request=card.pending[index];send(card,{jsonrpc:'2.0',id:request.id,...(error?{error}:{result})})},
  request(id,method,params={}){const requestId=++nextId;send(cards.get(id),{jsonrpc:'2.0',id:requestId,method,params});return requestId},
  spoof(id,result){const frame=document.createElement('iframe');frame.name='rogue';frame.style.display='none';frame.srcdoc='<script>addEventListener("message",event=>{parent.frames[event.data.target].postMessage({jsonrpc:"2.0",method:"ui/notifications/tool-result",params:event.data.result},"*")})<\\/script>';frame.onload=()=>frame.contentWindow.postMessage({target:id,result},'*');document.body.append(frame)},
};
addEventListener('message',event=>{const card=[...cards.values()].find(item=>item.frame.contentWindow===event.source);if(!card)return;if(event.data?.mcpTestDynamicCode){card.dynamicCode=event.data.mcpTestDynamicCode;return}if(event.data?.jsonrpc!=='2.0')return;const data=event.data;card.wire.push(data);
if(data.method==='ui/initialize'){send(card,{jsonrpc:'2.0',id:data.id,result:{protocolVersion:card.initProtocolOverride||data.params.protocolVersion,hostInfo:{name:'synthetic-host',version:'1'},hostCapabilities:{serverTools:{}},hostContext:card.context}})}
else if(data.method==='ui/notifications/initialized'){card.initialized=true;if(card.initial!==false){send(card,{jsonrpc:'2.0',method:'ui/notifications/tool-input',params:{arguments:card.input}});if(card.result)send(card,{jsonrpc:'2.0',method:'ui/notifications/tool-result',params:card.result})}}
else if(data.method==='tools/call'){card.pending.push(data)}
else if(data.method==='ui/notifications/size-changed'&&card.autoSize&&card.context.displayMode!=='fullscreen'){const height=data.params.height;if(Number.isFinite(height)&&height>0)card.frame.style.height=Math.ceil(height)+'px'}
else if(data.method==='ui/message'){card.messages??=[];card.messages.push(data.params);send(card,{jsonrpc:'2.0',id:data.id,result:{}})}
else if(data.method==='ui/request-display-mode'){const mode=card.refuseFullscreen?'inline':data.params.mode;card.context.displayMode=mode;if(card.autoSize&&mode==='fullscreen')card.frame.style.height=card.height+'px';send(card,{jsonrpc:'2.0',id:data.id,result:{mode}})}
else if(data.id!==undefined&&(!data.method)){card.acks.push(data)}
});
</script></body></html>`;

// This script must execute through the HTML parser, before any application
// module initializes. CDP/page.evaluate can bypass CSP and is not evidence of
// browser enforcement. Throw rather than delegating so even caught capability
// probes are counted without ever executing their requested source strings.
const dynamicCodeMonitor = `<script>
window.__dynamicCodeAttempts={Function:0,eval:0};
window.__dynamicCodeStacks=[];
window.__playwrightDynamicCodeAttempts=0;
window.__appEvalViolations=[];
window.__publishDynamicCodeState=()=>parent.postMessage({mcpTestDynamicCode:{
  attempts:window.__dynamicCodeAttempts,stacks:window.__dynamicCodeStacks,
  playwrightAttempts:window.__playwrightDynamicCodeAttempts,violations:window.__appEvalViolations,
  caught:window.__caughtDynamicCodeProbe??null,executed:window.__unexpectedDynamicExecution===true
}},'*');
document.addEventListener('securitypolicyviolation',event=>{
  if(event.blockedURI==='eval'){
    window.__appEvalViolations.push({directive:event.effectiveDirective,blocked:event.blockedURI});
    window.__publishDynamicCodeState();
  }
});
for(const name of ['Function','eval']){
  const blocked=()=>{const stack=new Error().stack||'';
    // Playwright's UtilityScript evaluates selectors and frame bookkeeping in
    // the inspected realm. Record it separately; it is test instrumentation,
    // not code reached from the shipped App or SDK.
    if(stack.includes('UtilityScript.'))window.__playwrightDynamicCodeAttempts++;
    else{window.__dynamicCodeAttempts[name]++;window.__dynamicCodeStacks.push({name,stack});}
    window.__publishDynamicCodeState();throw new EvalError('Test monitor blocked dynamic compilation')};
  window[name]=new Proxy(window[name],{apply:blocked,construct:blocked});
}
window.__publishDynamicCodeState();
</script>`;
const caughtDynamicCodeProbe = `<script>
window.__caughtDynamicCodeProbe={Function:false,eval:false};
try{new Function('window.__unexpectedDynamicExecution=true')}catch{window.__caughtDynamicCodeProbe.Function=true}
try{eval('window.__unexpectedDynamicExecution=true')}catch{window.__caughtDynamicCodeProbe.eval=true}
window.__publishDynamicCodeState();
</script>`;

export async function openHost(page, { blockImages=false, probeCsp=false, monitorDynamicCode=false, probeDynamicCode=false }={}) {
  if (probeDynamicCode && !monitorDynamicCode) throw new Error('Dynamic-code negative control requires the parser-installed monitor');
  if (probeCsp && monitorDynamicCode) throw new Error('Native CSP self-test must run separately from SDK zero-attempt monitoring');
  const logs=[];const errors=[];const requests=[];const unexpected=[];
  page.on('console',entry=>logs.push({type:entry.type(),text:entry.text(),location:entry.location()}));
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    window.__violations=[];
    document.addEventListener('securitypolicyviolation',event=>window.__violations.push({directive:event.effectiveDirective,blocked:event.blockedURI}));
  });
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());requests.push(url.href);
    if(url.origin==='http://mcp-host.test')return route.fulfill({contentType:'text/html',body:hostDocument});
    if(url.origin==='http://mcp-app.test'){
      const kind=url.searchParams.get('kind')==='gantt'?'gantt':'map';let body=fs.readFileSync(artifacts[kind],'utf8');
      // A parser-executed test-only probe proves unsafe-eval is blocked. A script
      // appended by Playwright's debugger evaluate inherits its CSP bypass.
      if(probeCsp)body=body.replace('<head>','<head><script>try{new Function("window.__unsafeExecuted=true")()}catch{window.__unsafeEvalBlocked=true}</script>');
      if(monitorDynamicCode)body=body.replace('<head>','<head>'+dynamicCodeMonitor+(probeDynamicCode?caughtDynamicCodeProbe:''));
      return route.fulfill({contentType:'text/html',body,headers:{'content-security-policy':blockImages?strictCsp(kind).replace('img-src data:',"img-src 'none'"):strictCsp(kind)}});
    }
    unexpected.push(url.href);return route.abort();
  });
  await page.goto('http://mcp-host.test/');
  return {
    logs,errors,requests,unexpected,
    async add({id='card',result=message(),width=1100,height=800,context={},input,initial=true,refuseFullscreen=false,initProtocolOverride,expectInitialized=true,inspectFrame=true,autoSize=false}={}) {
      const defaults={theme:'light',locale:'zh-CN',displayMode:'inline',availableDisplayModes:['inline','fullscreen'],toolInfo:{tool:{name:TOOL,inputSchema:{type:'object'}}}};
      const kind=result?._meta?.gateway_ui?.view==='gantt'?'gantt':'map';
      defaults.toolInfo.tool.name=result?._meta?.gateway_ui?.display_tool_name||TOOL;
      await page.evaluate(options=>window.host.add(options),{id,result,kind,width,height,autoSize,context:{...defaults,...context},input:input??{job_id:result?._meta?.gateway_ui?.job_id||JOB},initial,refuseFullscreen,initProtocolOverride});
      if(expectInitialized)await expect.poll(()=>page.evaluate(id=>window.host.cards.get(id)?.initialized,id)).toBe(true);
      else await expect.poll(()=>page.evaluate(id=>window.host.cards.get(id)?.wire.some(item=>item.method==='ui/initialize'),id)).toBe(true);
      const frame=page.frame({name:id});
      // Locator inspection uses DevTools evaluation in the target realm. The
      // dynamic-code monitor test disables it so its counters cover only App
      // and SDK execution, not Playwright's own selector implementation.
      if(inspectFrame)await expect(frame.locator('#app')).toBeVisible();
      return frame;
    },
    notify:(id,method,params)=>page.evaluate(({id,method,params})=>window.host.notify(id,method,params),{id,method,params}),
    result:(id,result)=>page.evaluate(({id,result})=>window.host.result(id,result),{id,result}),
    context:(id,context)=>page.evaluate(({id,context})=>window.host.context(id,context),{id,context}),
    respond:(id,index,result,error)=>page.evaluate(({id,index,result,error})=>window.host.respond(id,index,result,error),{id,index,result,error}),
    wire:(id)=>page.evaluate(id=>window.host.cards.get(id).wire,id),
    pending:(id)=>page.evaluate(id=>window.host.cards.get(id).pending,id),
    messages:(id)=>page.evaluate(id=>window.host.cards.get(id).messages||[],id),
    // Read the parser monitor's postMessage snapshot in the uninstrumented
    // parent realm: frame.evaluate itself invokes eval through Playwright.
    dynamicCodeState:(id)=>page.evaluate(id=>window.host.cards.get(id).dynamicCode,id),
    async assertHealthy(){
      expect(errors).toEqual([]);expect(unexpected).toEqual([]);
      expect(logs.filter(item=>/TEST_ONLY_NOT_A_USABLE_KEY|gateway_ui|browser_key|合成测试地址/.test(item.text))).toEqual([]);
    },
  };
}

export async function mapReady(frame) {
  await expect(frame.locator('#map-canvas')).toHaveAttribute('data-svg-map','ready');
  await expect(frame.locator('.snapshot-svg')).toBeVisible();
  expect(frame.childFrames()).toHaveLength(0);
  return frame;
}
export async function fullscreen(frame){await frame.locator('#fullscreen').click();await expect(frame.locator('#app')).toHaveAttribute('data-mode','fullscreen')}
