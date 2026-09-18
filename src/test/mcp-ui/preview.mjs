/** Optional offline visual QA. Not a real host/Gateway acceptance environment. */
import { chromium } from '../../main/resources/META-INF/resources/static/node_modules/@playwright/test/index.mjs';
import { openHost,mapReady } from './host-fixture.mjs';

const port=Number(process.env.MCP_PREVIEW_PORT || 9224);
const browser=await chromium.launch({headless:true,args:[`--remote-debugging-port=${port}`]});
for(const preset of [
  {id:'desktop',width:1100,height:820,context:{displayMode:'fullscreen'}},
  {id:'narrow',width:375,height:820,context:{displayMode:'fullscreen',locale:'en-US',theme:'dark'}},
]){
  const page=await browser.newPage({viewport:{width:preset.width+20,height:850}});
  const host=await openHost(page);const frame=await host.add(preset);await mapReady(frame);
  await page.evaluate(id=>document.title=`MCP offline preview · ${id}`,preset.id);
}
console.log(`Offline MCP preview ready: agent-browser --cdp ${port} tab`);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await browser.close();process.exit(0)});
await new Promise(()=>{});
