import fs from 'node:fs';
import { test, expect } from '../../main/resources/META-INF/resources/static/node_modules/@playwright/test/index.mjs';
import { mapSdkFixture } from './map-sdk-fixture.mjs';
export { test, expect };

const artifact = new URL('../../main/resources/META-INF/resources/static/mcp-app.html', import.meta.url);
const payloads = JSON.parse(fs.readFileSync(new URL('../../../docs/integrations/gateway/fixtures/mcp-result-view/payloads.json', import.meta.url), 'utf8'));
export const message = (name='ready') => structuredClone(payloads.find(item=>item.name===name).message);
export const JOB = message()._meta.gateway_ui.job_id;
export const VERSION = message()._meta.gateway_ui.image_version_id;
export const TOOL = message()._meta.gateway_ui.display_tool_name;
export const AGENT = message()._meta.gateway_ui.engine_view.solver_job.plan.agents[0].id;
export const STRICT_CSP = "default-src 'none'; script-src 'unsafe-inline' https://webapi.amap.com https://js.api.here.com; style-src 'unsafe-inline'; img-src data: https://maps.hereapi.com; connect-src https://js.api.here.com https://vector.hereapi.com https://maps.hereapi.com; worker-src 'none'; frame-ancestors http://mcp-host.test; base-uri 'none'; form-action 'none'";

const hostDocument = `<!doctype html><html><head><meta charset="utf-8"><title>Synthetic MCP Apps Host</title></head><body><script>
const cards=new Map();let nextId=1000;
const send=(card,message)=>card.frame.contentWindow.postMessage(message,'*');
window.host={cards,
  add(options){const card={...options,wire:[],pending:[],acks:[],initialized:false};const frame=document.createElement('iframe');frame.name=options.id;frame.id=options.id;frame.setAttribute('sandbox','allow-scripts');frame.style.cssText='border:0;display:block;width:'+ (options.width||1100)+'px;height:'+(options.height||800)+'px';card.frame=frame;cards.set(card.id,card);frame.src='http://mcp-app.test/app.html?id='+encodeURIComponent(card.id);document.body.append(frame)},
  notify(id,method,params){send(cards.get(id),{jsonrpc:'2.0',method,params})},
  result(id,result){this.notify(id,'ui/notifications/tool-result',result)},
  context(id,context){const card=cards.get(id);Object.assign(card.context,context);this.notify(id,'ui/notifications/host-context-changed',context)},
  respond(id,index,result,error){const card=cards.get(id),request=card.pending[index];send(card,{jsonrpc:'2.0',id:request.id,...(error?{error}:{result})})},
  request(id,method,params={}){const requestId=++nextId;send(cards.get(id),{jsonrpc:'2.0',id:requestId,method,params});return requestId},
  spoof(id,result){const frame=document.createElement('iframe');frame.name='rogue';frame.style.display='none';frame.srcdoc='<script>addEventListener("message",event=>{parent.frames[event.data.target].postMessage({jsonrpc:"2.0",method:"ui/notifications/tool-result",params:event.data.result},"*")})<\\/script>';frame.onload=()=>frame.contentWindow.postMessage({target:id,result},'*');document.body.append(frame)},
};
addEventListener('message',event=>{const card=[...cards.values()].find(item=>item.frame.contentWindow===event.source);if(!card||event.data?.jsonrpc!=='2.0')return;const data=event.data;card.wire.push(data);
if(data.method==='ui/initialize'){send(card,{jsonrpc:'2.0',id:data.id,result:{protocolVersion:card.initProtocolOverride||data.params.protocolVersion,hostInfo:{name:'synthetic-host',version:'1'},hostCapabilities:{serverTools:{}},hostContext:card.context}})}
else if(data.method==='ui/notifications/initialized'){card.initialized=true;if(card.initial!==false){send(card,{jsonrpc:'2.0',method:'ui/notifications/tool-input',params:{arguments:card.input}});if(card.result)send(card,{jsonrpc:'2.0',method:'ui/notifications/tool-result',params:card.result})}}
else if(data.method==='tools/call'){card.pending.push(data)}
else if(data.method==='ui/request-display-mode'){const mode=card.refuseFullscreen?'inline':data.params.mode;card.context.displayMode=mode;send(card,{jsonrpc:'2.0',id:data.id,result:{mode}})}
else if(data.id!==undefined&&(!data.method)){card.acks.push(data)}
});
</script></body></html>`;

export async function openHost(page, { mapFailure=false, mapCsp=false, probeCsp=false }={}) {
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
      let body=fs.readFileSync(artifact,'utf8');
      // A parser-executed test-only probe proves unsafe-eval is blocked. A script
      // appended by Playwright's debugger evaluate inherits its CSP bypass.
      if(probeCsp)body=body.replace('<head>','<head><script>try{new Function("window.__unsafeExecuted=true")()}catch{window.__unsafeEvalBlocked=true}</script>');
      return route.fulfill({contentType:'text/html',body,headers:{'content-security-policy':mapCsp?STRICT_CSP.replace(' https://webapi.amap.com',''):STRICT_CSP}});
    }
    if(['https://webapi.amap.com','https://js.api.here.com'].includes(url.origin)){
      if(mapFailure)return route.abort();
      return route.fulfill({contentType:'text/javascript',body:mapSdkFixture});
    }
    unexpected.push(url.href);return route.abort();
  });
  await page.goto('http://mcp-host.test/');
  return {
    logs,errors,requests,unexpected,
    async add({id='card',result=message(),width=1100,height=800,context={},input,initial=true,refuseFullscreen=false,initProtocolOverride,expectInitialized=true}={}) {
      const defaults={theme:'light',locale:'zh-CN',displayMode:'inline',availableDisplayModes:['inline','fullscreen'],toolInfo:{tool:{name:TOOL,inputSchema:{type:'object'}}}};
      await page.evaluate(options=>window.host.add(options),{id,result,width,height,context:{...defaults,...context},input:input??{job_id:result?._meta?.gateway_ui?.job_id||JOB},initial,refuseFullscreen,initProtocolOverride});
      if(expectInitialized)await expect.poll(()=>page.evaluate(id=>window.host.cards.get(id)?.initialized,id)).toBe(true);
      else await expect.poll(()=>page.evaluate(id=>window.host.cards.get(id)?.wire.some(item=>item.method==='ui/initialize'),id)).toBe(true);
      const frame=page.frame({name:id});await expect(frame.locator('#app')).toBeVisible();return frame;
    },
    notify:(id,method,params)=>page.evaluate(({id,method,params})=>window.host.notify(id,method,params),{id,method,params}),
    result:(id,result)=>page.evaluate(({id,result})=>window.host.result(id,result),{id,result}),
    context:(id,context)=>page.evaluate(({id,context})=>window.host.context(id,context),{id,context}),
    respond:(id,index,result,error)=>page.evaluate(({id,index,result,error})=>window.host.respond(id,index,result,error),{id,index,result,error}),
    wire:(id)=>page.evaluate(id=>window.host.cards.get(id).wire,id),
    pending:(id)=>page.evaluate(id=>window.host.cards.get(id).pending,id),
    async assertHealthy(){
      expect(errors).toEqual([]);expect(unexpected).toEqual([]);
      // Browser-generated CSP diagnostics necessarily quote the blocked public
      // map URL. This is not an application console call and cannot be muted by
      // the App. No application/SDK log may contain keys or business payloads.
      const nativeCsp=entry=>mapCsp&&entry.type==='error'&&/^Loading the script 'https:\/\/webapi\.amap\.com\/maps\?[^']+' violates the following Content Security Policy directive:/.test(entry.text);
      expect(logs.filter(item=>!nativeCsp(item)&&/TEST_ONLY_NOT_A_USABLE_KEY|gateway_ui|browser_key|合成测试地址/.test(item.text))).toEqual([]);
    },
  };
}

export async function mapReady(frame){await expect(frame.locator('#map-state')).toBeHidden();await expect(frame.locator('#map-canvas')).toHaveAttribute('data-mock-map','ready')}
export async function fullscreen(frame){await frame.locator('#fullscreen').click();await expect(frame.locator('#app')).toHaveAttribute('data-mode','fullscreen')}
