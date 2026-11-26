import { withSnapshot } from './snapshot-fixture.mjs';
import { test,expect,openHost,message,mapReady,fullscreen,AGENT , chooseEngineer} from './host-fixture.mjs';
import { largeView } from './model-fixtures.mjs';

function asGantt(result=message('gantt-ready')) { return result; }

test('scenario map route selects its engineer and opens the schedule by job ID', async ({page}) => {
  const result = withSnapshot(message());
  const ui = result._meta.gateway_ui;
  ui.display_tool_name = 'gw_map';
  ui.scenario_version_id = 'a'.repeat(32);
  ui.task.scenario_version_id = ui.scenario_version_id;
  delete ui.image_version_id;
  delete ui.task.image_version_id;
  const plan = ui.engine_view.solver_job.plan;
  result.structuredContent = {
    job_id: ui.job_id,
    routes: plan.agents.filter(agent => !agent.virtual).map(agent => ({
      engineer_id: agent.id,
      stops: agent.tickets.map(id => ({work_order_id: id})),
    })),
  };
  const host = await openHost(page);
  const frame = await host.add({result});
  await mapReady(frame);
  const route = frame.locator('.snapshot-svg [data-kind="route"]').first();
  await route.dispatchEvent('click');
  await expect(frame.locator('#engineer')).toHaveJSProperty('value', AGENT);
  await frame.locator('#open-gantt').click();
  await expect.poll(async () => (await host.messages('card')).length).toBe(1);
  const [request] = await host.messages('card');
  expect(request.content[0].text).toBe(`查看任务 ${ui.job_id} 的排程`);
  await host.assertHealthy();
});

test('map inline hides refresh, stays focused on routes, and sends a readable schedule request',async({page})=>{
  const host=await openHost(page),frame=await host.add();const renderer=await mapReady(frame);
  await expect(frame.locator('#task-title,#task-meta,#summary,#inline-detail')).toHaveCount(0);
  await chooseEngineer(frame,AGENT);await expect(renderer.locator('.snapshot-point[data-kind="ticket"][display="inline"]')).toHaveCount(2);
  expect((await host.pending('card')).length).toBe(0);
  await expect(frame.locator('#refresh')).toBeHidden();await frame.locator('#refresh').evaluate(el=>el.click());await expect.poll(async()=>(await host.pending('card')).length).toBe(1);
  const call=(await host.pending('card'))[0];expect(call.params).toMatchObject({name:`gw_map_${message()._meta.gateway_ui.image_version_id}`,arguments:{job_id:message()._meta.gateway_ui.job_id,engineer_id:AGENT}});
  await host.respond('card',0,message());await mapReady(frame);
  await frame.locator('#open-gantt').click();await expect.poll(async()=>(await host.messages('card')).length).toBe(1);
  expect((await host.messages('card'))[0]).toEqual({role:'user',content:[{type:'text',text:`查看任务 ${message()._meta.gateway_ui.job_id} 的排程`}]});
  await host.assertHealthy();
});

for (const kind of ['map', 'gantt']) {
  test(`${kind} switch is available again after message delivery or rejection`, async ({ page }) => {
    const isMap = kind === 'map';
    const result = isMap ? message() : asGantt();
    const jobId = result._meta.gateway_ui.job_id;
    const text = isMap ? `查看任务 ${jobId} 的排程` : `Show the route for job ${jobId}`;
    const label = isMap ? '查看 Gantt 排程' : 'View route';
    const host = await openHost(page);
    const frame = await host.add({ kind, result, width: 375, holdMessages: true, context: { locale: isMap ? 'zh-CN' : 'en-US' } });
    const button = frame.locator(isMap ? '#open-gantt' : '#open-map');
    await expect(button).toBeEnabled();
    await button.click();
    await expect(button).toBeDisabled();
    await expect(button).toBeFocused();
    await expect(button).toHaveText(isMap ? '正在请求排程…' : 'Requesting route…');
    await button.dispatchEvent('click');
    await expect.poll(async () => (await host.messages('card')).length).toBe(1);
    expect((await host.messages('card'))[0]).toEqual({ role: 'user', content: [{ type: 'text', text }] });

    await host.respondMessage('card', 0, {});
    await expect(button).toBeEnabled();
    await expect(button).toHaveText(label);
    await expect(frame.locator('#intent-status')).toBeHidden();

    await button.click();
    await expect.poll(async () => (await host.messages('card')).length).toBe(2);
    await host.respondMessage('card', 1, { isError: true });
    await expect(button).toBeEnabled();
    await expect(frame.locator('#intent-text')).toHaveValue(text);

    await button.click();
    await expect.poll(async () => (await host.messages('card')).length).toBe(3);
    await host.notify('card', 'ui/notifications/tool-input', { arguments: { job_id: jobId } });
    await host.result('card', result);
    await expect(button).toBeEnabled();
    await host.respondMessage('card', 2, { isError: true });
    await expect(frame.locator('#intent-status')).toBeHidden();
    expect(await host.pending('card')).toHaveLength(0);
    await host.assertHealthy();
  });
}

test('map fullscreen provides isolated sidebar, fit, replay and pauses on hide or exit',async({page})=>{
  const host=await openHost(page),frame=await host.add();await mapReady(frame);await chooseEngineer(frame,AGENT);await fullscreen(frame);
  await expect(frame.locator('#sidebar')).toBeVisible();await expect(frame.locator('#play')).toBeEnabled();await expect(frame.locator('#follow')).toBeEnabled();
  await frame.locator('#follow').click();await expect(frame.locator('#follow')).toHaveAttribute('aria-pressed','true');
  await frame.locator('#play').click();await expect(frame.locator('#play')).toHaveAttribute('aria-pressed','true');
  await frame.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))});
  await expect(frame.locator('#play')).toHaveAttribute('aria-pressed','false');
  await host.context('card',{displayMode:'inline'});await expect(frame.locator('#app')).toHaveAttribute('data-mode','inline');await expect(frame.locator('#playback')).toBeHidden();
  await host.assertHealthy();
});

test('Gantt uses readable service blocks without zoom controls, makes no map request and filters locally',async({page})=>{
  const host=await openHost(page),frame=await host.add({result:asGantt()});
  await expect(frame.locator('#map-canvas,#fit-map,#open-gantt')).toHaveCount(0);await expect(frame.locator('#refresh')).toBeHidden();await expect(frame.locator('.gantt-bar')).toHaveCount(5);
  expect(host.requests.some(url=>url.startsWith('https://'))).toBe(false);
  await chooseEngineer(frame,AGENT);expect((await host.pending('card')).length).toBe(0);
  await frame.locator('#refresh').evaluate(el=>el.click());await expect.poll(async()=>(await host.pending('card')).length).toBe(1);
  const refresh=(await host.pending('card'))[0];expect(refresh.params.name).toBe(`gw_gantt_${asGantt()._meta.gateway_ui.image_version_id}`);
  expect(refresh.params.arguments).toEqual({job_id:asGantt()._meta.gateway_ui.job_id}); // The SDK may add standard _meta.progressToken.
  await host.respond('card',0,asGantt());await expect(frame.locator('.gantt-bar')).toHaveCount(5);
  expect(host.requests.some(url=>url.startsWith('https://'))).toBe(false);
  await expect(frame.locator('#gantt-out,#gantt-in')).toHaveCount(0);
  const size=await frame.locator('.gantt-grid').evaluate(el=>({width:el.getBoundingClientRect().width,available:document.getElementById('gantt-scroll').clientWidth,label:document.querySelector('.gantt-label').getBoundingClientRect().width}));
  expect(size.width).toBeCloseTo(size.available,1);
  expect(size.label).toBeLessThan(size.available / 4);
  await fullscreen(frame);await expect(frame.locator('#sidebar')).toBeVisible();expect(await frame.locator('#sidebar').evaluate(el=>getComputedStyle(el).borderLeftWidth)).not.toBe('0px');
  await frame.locator('.gantt-bar').last().click();await expect(frame.locator('#side-detail')).toContainText('ticket-a');await host.assertHealthy();
});

test('map and Gantt cards keep selection, viewport, scroll and fullscreen state isolated',async({page})=>{
  const host=await openHost(page),map=await host.add({id:'map'}),gantt=await host.add({id:'gantt',result:asGantt(),width:375});await mapReady(map);
  await chooseEngineer(map,AGENT);
  await gantt.locator('#gantt-scroll').evaluate(el=>{el.scrollLeft=80;el.dispatchEvent(new Event('scroll'));});await fullscreen(gantt);
  await expect(map.locator('#app')).toHaveAttribute('data-mode','inline');await expect(gantt.locator('#app')).toHaveAttribute('data-mode','fullscreen');
  await expect(map.locator('#engineer')).toHaveJSProperty('value',AGENT);await expect(gantt.locator('#engineer')).toHaveJSProperty('value','');
  expect(await gantt.locator('#gantt-scroll').evaluate(el=>el.scrollLeft)).toBe(80);await host.assertHealthy();
});

test('large map and Gantt profiles retain 200 engineers, 1000 tickets and the 4097-point line',async({page})=>{
  test.setTimeout(60000);const large=largeView();const mapResult=message();mapResult._meta.gateway_ui.engine_view=large.view;
  const ganttResult=asGantt();const view=structuredClone(large.view);for(const poi of view.solver_job.plan.pois)poi.location=null;for(const agent of view.solver_job.plan.agents)for(const route of agent.routes)if(route)Object.assign(route,{origin:null,destination:null,polyline:null,transit:null});ganttResult._meta.gateway_ui.engine_view=view;
  const host=await openHost(page),map=await host.add({id:'map',result:withSnapshot(mapResult)});const renderer=await mapReady(map);expect(await renderer.locator('[data-kind="route"] path').first().getAttribute('d')).toMatch(/L/);expect(mapResult._meta.gateway_ui.engine_view.solver_job.plan.agents[0].routes[0].polyline).toHaveLength(4097);
  await expect(map.locator('#map-legend')).toHaveCount(0);
  await map.locator('#engineer').click();await expect(map.locator('#engineer-options [role=option]')).toHaveCount(201);
  const popup=await map.locator('#engineer-options').evaluate(el=>({height:el.getBoundingClientRect().height,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight}));
  expect(popup.height).toBeLessThanOrEqual(360);expect(popup.scrollHeight).toBeGreaterThan(popup.clientHeight);
  await map.locator('#engineer').press('Escape');
  const gantt=await host.add({id:'gantt',result:ganttResult,height:900});await expect(gantt.locator('.gantt-row')).toHaveCount(200);await expect(gantt.locator('.gantt-bar[data-phase="service"]')).toHaveCount(1000);await host.assertHealthy();
});
