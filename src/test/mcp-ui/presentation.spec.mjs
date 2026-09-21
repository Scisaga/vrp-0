import fs from 'node:fs';
import { test,expect,openHost,message,fullscreen } from './host-fixture.mjs';
import { GANTT_STAGE_STYLES } from '../../main/resources/META-INF/resources/static/assets/js/utils/result-presentation.mjs';

test('Gantt reuses console phase presentation and supports keyboard selection in both themes',async({page})=>{
 const host=await openHost(page),frame=await host.add({result:message('gantt-ready')});const service=frame.locator('.gantt-bar').last();await service.focus();await service.press('Enter');await expect(frame.locator('#inline-detail')).toContainText('ticket-a');expect(await service.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(GANTT_STAGE_STYLES.service.background);await fullscreen(frame);await host.context('card',{theme:'dark',locale:'en-US'});await expect(frame.locator('#fullscreen')).toHaveText('Exit full screen');await expect(frame.locator('.result-sequence-badge').first()).toBeVisible();await host.assertHealthy();
});

test('Gantt production artifact contains neither map modules nor approved map origins',async()=>{
 const html=fs.readFileSync(new URL('../../main/resources/META-INF/resources/static/mcp-gantt-app.html',import.meta.url),'utf8');expect(html).not.toContain('webapi.amap.com');expect(html).not.toContain('js.api.here.com');expect(html).not.toContain('mcp-network-policy');
});
