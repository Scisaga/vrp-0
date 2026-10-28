/** Opt-in Java-to-browser fixture contract check; no real provider certification. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from '../../main/resources/META-INF/resources/static/node_modules/@playwright/test/index.mjs';
import {openHost,mapReady,fullscreen,expect} from './host-fixture.mjs';
assert.ok(process.env.MCP_SVG_INTEROP_FILE,'MCP_SVG_INTEROP_FILE must identify a producer-generated fixture');
const message=JSON.parse(fs.readFileSync(process.env.MCP_SVG_INTEROP_FILE,'utf8'));
const envelope=message._meta.gateway_ui,snapshot=envelope.map_context.snapshot;
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();const host=await openHost(page),a=await host.add({id:'java-a',result:message}),b=await host.add({id:'java-b',result:message});
 await mapReady(a);await mapReady(b);await expect(a.locator('.snapshot-attribution')).toHaveText(snapshot.attribution);
 const engineer=snapshot.elements.agents[0].engineer_id;
 await a.locator('#engineer').selectOption(engineer);await expect(b.locator('#engineer')).toHaveValue('');
 // A filtered route can already be at its real-pixel limit (especially at 1.5x).
 // Establish a zoomable viewport instead of treating the correct disabled state as a failure.
 const plus=a.getByRole('button',{name:'放大地图',exact:true}),minus=a.getByRole('button',{name:'缩小地图',exact:true});
 if(await plus.isDisabled()){await expect(minus).toBeEnabled();await minus.click();}
 await expect(plus).toBeEnabled();const view=await a.locator('.snapshot-svg').getAttribute('viewBox');
 await plus.click();assert.notEqual(await a.locator('.snapshot-svg').getAttribute('viewBox'),view);
 await a.locator('#fit-map').click();await a.locator('.snapshot-point[data-kind="ticket"][display="inline"]').first().click();await fullscreen(a);
 await expect(a.locator('#side-detail')).not.toBeEmpty();await expect(a.locator('#play')).toBeEnabled();await a.locator('#cursor').fill('500');
 await expect(a.locator('.snapshot-playback[display="inline"]')).toHaveCount(1);
 assert.notEqual(await a.locator('.snapshot-point').first().getAttribute('id'),await b.locator('.snapshot-point').first().getAttribute('id'));
 assert.equal(a.childFrames().length,0);assert.equal(host.requests.filter(url=>!/^http:\/\/mcp-(?:host|app)\.test\//.test(url)).length,0);
 await page.evaluate(()=>window.host.request('java-a','ui/resource-teardown',{}));await expect(a.locator('.snapshot-svg')).toHaveCount(0);await expect(b.locator('.snapshot-svg')).toBeVisible();await host.assertHealthy();
 console.log(JSON.stringify({passed:true,scope:message._meta.fixture_notice??'producer-generated fixture, provider acceptance not implied',agents:snapshot.elements.agents.length,tickets:snapshot.elements.tickets.length,routes:snapshot.elements.routes.length,browserMapRequests:0,childFrames:0}));
}finally{await browser.close();}
