import { test,expect,openHost,message,mapReady,fullscreen,JOB,TOOL,AGENT } from './host-fixture.mjs';

test('official SDK handshake uses isolated iframe, strict CSP and no payload logging',async({page})=>{
  const host=await openHost(page,{probeCsp:true});const frame=await host.add();await mapReady(frame);
  const wire=await host.wire('card');const initialize=wire.find(item=>item.method==='ui/initialize');
  expect(initialize.params.protocolVersion).toBe('2026-01-26');
  expect(initialize.params.appCapabilities.availableDisplayModes).toEqual(['inline','fullscreen']);
  expect(wire.some(item=>item.method==='ui/notifications/initialized')).toBe(true);
  await expect(page.locator('#card')).toHaveAttribute('sandbox','allow-scripts');
  expect(await frame.evaluate(()=>self.origin)).toBe('null');
  expect(await frame.evaluate(()=>({blocked:window.__unsafeEvalBlocked,executed:window.__unsafeExecuted===true}))).toEqual({blocked:true,executed:false});
  await expect.poll(()=>frame.evaluate(()=>window.__violations.filter(item=>item.blocked==='eval').length)).toBe(1);
  expect((await host.wire('card')).some(item=>['ui/message','ui/update-model-context'].includes(item.method))).toBe(false);
  await host.assertHealthy();
});

test('final artifact never calls Function or eval during SDK initialization, messaging, refresh or teardown',async({page})=>{
  const host=await openHost(page,{monitorDynamicCode:true});const frame=await host.add();await mapReady(frame);
  const assertNoDynamicCode=async()=>{
    expect(await host.dynamicCodeState('card')).toEqual({attempts:{Function:0,eval:0},violations:[],caught:null,executed:false});
  };
  await assertNoDynamicCode();
  const updated=message();updated._meta.gateway_ui.engine_view.solver_job.name='无动态编译的结果通知';
  await host.result('card',updated);await expect(frame.locator('#task-title')).toHaveText('无动态编译的结果通知');
  await host.context('card',{locale:'en-US'});await expect(frame.locator('#refresh')).toHaveText('Refresh');
  await frame.locator('#refresh').click();await expect.poll(async()=>(await host.pending('card')).length).toBe(1);
  const refreshed=message();refreshed._meta.gateway_ui.engine_view.solver_job.name='无动态编译的刷新结果';
  await host.respond('card',0,refreshed);await expect(frame.locator('#task-title')).toHaveText('无动态编译的刷新结果');
  await expect(frame.locator('#refresh')).toBeEnabled();await assertNoDynamicCode();
  const id=await page.evaluate(()=>window.host.request('card','ui/resource-teardown'));
  await expect.poll(()=>page.evaluate(id=>window.host.cards.get('card').acks.find(item=>item.id===id),id)).toEqual({jsonrpc:'2.0',id,result:{}});
  await expect(frame.locator('#app')).toBeEmpty();await assertNoDynamicCode();
  await host.assertHealthy();
});

test('parser-installed dynamic-code monitor detects capability probes even when their errors are caught',async({page})=>{
  const host=await openHost(page,{monitorDynamicCode:true,probeDynamicCode:true});const frame=await host.add();await mapReady(frame);
  // The monitor rejects before native compilation, so only the separate
  // native-CSP self-test above should create an unsafe-eval violation event.
  expect(await host.dynamicCodeState('card')).toEqual({
    attempts:{Function:1,eval:1},violations:[],caught:{Function:true,eval:true},executed:false,
  });
  await host.assertHealthy();
});

test('sibling-frame spoofed JSON-RPC is ignored by SDK parent source validation',async({page})=>{
  const host=await openHost(page);const frame=await host.add();await mapReady(frame);
  const fake=message();fake._meta.gateway_ui.engine_view.solver_job.name='SPOOFED_UNTRUSTED_RESULT';
  await page.evaluate(result=>window.host.spoof('card',result),fake);
  await expect(page.locator('iframe[name="rogue"]')).toHaveCount(1);
  await expect.poll(()=>Boolean(page.frame({name:'rogue'}))).toBe(true);
  await page.frame({name:'rogue'}).evaluate(result=>parent.frames.card.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:result},'*'),fake);
  await expect(frame.locator('#task-title')).toHaveText('合成结果');
  // A genuine parent message still reaches the SDK and proves the bridge is live.
  const good=message();good._meta.gateway_ui.engine_view.solver_job.name='可信父窗口结果';await host.result('card',good);
  await expect(frame.locator('#task-title')).toHaveText('可信父窗口结果');
  expect(await frame.locator('body').textContent()).not.toContain('SPOOFED_UNTRUSTED_RESULT');
  await host.assertHealthy();
});

test('unsupported initialization protocol never activates the view',async({page})=>{
  const host=await openHost(page);const frame=await host.add({initProtocolOverride:'unsupported-protocol',expectInitialized:false});
  await expect(frame.locator('#notice')).toBeVisible();await expect(frame.locator('#refresh')).toBeDisabled();
  expect((await host.wire('card')).some(item=>item.method==='ui/notifications/initialized')).toBe(false);
  expect(host.requests.some(url=>url.startsWith('https:'))).toBe(false);
  expect(await frame.locator('body').textContent()).not.toContain('合成结果');await host.assertHealthy();
});

test('missing meta, wrong version/tool or mismatched task identity fails closed',async({page})=>{
  const host=await openHost(page);
  const cases=[{content:[{type:'text',text:JSON.stringify(message())}]}];
  for(const mutate of [data=>{data.task.job_id='another-task'},data=>{data.image_version_id='3'.repeat(32)},data=>{data.display_tool_name='gateway.solver_jobs.create'},data=>{data.engine_view.solver_job.id='engine-job'}]){
    const bad=message();mutate(bad._meta.gateway_ui);cases.push(bad);
  }
  for(const [index,result]of cases.entries()){
    const frame=await host.add({id:`bad-${index}`,result});
    await expect(frame.locator('#notice')).toBeVisible();
    await expect(frame.locator('#refresh')).toBeDisabled();
    expect(await frame.locator('body').textContent()).not.toContain('合成工程师 A');
    expect(await frame.locator('.mcp-marker').count()).toBe(0);
  }
  expect(host.requests.filter(url=>url.startsWith('https:'))).toEqual([]);
  await host.assertHealthy();
});

test('refresh is single-flight, uses supplied display tool and drops older responses',async({page})=>{
  const host=await openHost(page);const frame=await host.add();await mapReady(frame);
  await frame.locator('#refresh').click();await expect(frame.locator('#refresh')).toBeDisabled();
  await expect.poll(async()=>(await host.pending('card')).length).toBe(1);
  const params=(await host.pending('card'))[0].params;
  expect(params).toEqual({name:TOOL,arguments:{job_id:JOB,view:'map'},_meta:{progressToken:expect.any(Number)}});
  const newer=message();newer._meta.gateway_ui.engine_view.solver_job.name='较新的宿主通知';await host.result('card',newer);
  await expect(frame.locator('#task-title')).toHaveText('较新的宿主通知');
  await host.respond('card',0,message());await expect(frame.locator('#refresh')).toBeEnabled();
  await expect(frame.locator('#task-title')).toHaveText('较新的宿主通知');
  await frame.locator('#refresh').click();
  const next=message();const nextId='00000000000000000000000000000003';const data=next._meta.gateway_ui;
  data.job_id=nextId;data.task.job_id=nextId;data.engine_view.solver_job.id=nextId;data.engine_view.solver_job.name='新的任务';
  await host.notify('card','ui/notifications/tool-input',{arguments:{job_id:nextId}});await host.result('card',next);
  await expect(frame.locator('#task-title')).toHaveText('新的任务');
  await host.respond('card',1,null,{code:-32000,message:'private detail',data:{code:'FORBIDDEN'}});
  await expect(frame.locator('#task-title')).toHaveText('新的任务');
  await expect(frame.locator('#notice')).toBeHidden();await host.assertHealthy();
});

test('long engineer identity remains local and is omitted rather than truncated on refresh',async({page})=>{
  const result=message(),long='engineer-'.repeat(30),plan=result._meta.gateway_ui.engine_view.solver_job.plan;
  plan.agents[0].id=long;for(const ticket of plan.tickets)if(ticket.agent===AGENT)ticket.agent=long;
  const host=await openHost(page);const frame=await host.add({result});await mapReady(frame);
  await frame.locator('#engineer').selectOption(long);await frame.locator('#refresh').click();
  await expect.poll(async()=>(await host.pending('card')).length).toBe(1);
  expect((await host.pending('card'))[0].params.arguments).toEqual({job_id:JOB,view:'map'});
  await host.respond('card',0,result);await expect(frame.locator('#refresh')).toBeEnabled();
  await expect(frame.locator('#engineer')).toHaveValue(long);await host.assertHealthy();
});

test('fullscreen refusal preserves compact view and teardown sends ACK before stopping',async({page})=>{
  const host=await openHost(page);const frame=await host.add({refuseFullscreen:true});await mapReady(frame);
  await frame.locator('#fullscreen').click();await expect(frame.locator('#notice')).toContainText('宿主未切换到全屏');
  await expect(frame.locator('#app')).toHaveAttribute('data-mode','inline');
  const id=await page.evaluate(()=>window.host.request('card','ui/resource-teardown'));
  await expect.poll(()=>page.evaluate(id=>window.host.cards.get('card').acks.find(item=>item.id===id),id)).toEqual({jsonrpc:'2.0',id,result:{}});
  expect(await frame.evaluate(()=>window.__mapStats.destroyed)).toBe(1);
  await expect(frame.locator('#app')).toBeEmpty();const after=message();after._meta.gateway_ui.engine_view.solver_job.name='AFTER_TEARDOWN';await host.result('card',after);
  await expect(frame.locator('#app')).toBeEmpty();await host.assertHealthy();
});

test('same-task cards keep independent selection, refresh, locale and lifecycle',async({page})=>{
  const host=await openHost(page);const a=await host.add({id:'a'}),b=await host.add({id:'b'});await mapReady(a);await mapReady(b);
  await a.locator('#engineer').selectOption(AGENT);await a.locator('#refresh').click();
  await expect(b.locator('#engineer')).toHaveValue('');await expect(b.locator('#refresh')).toBeEnabled();
  await host.context('a',{locale:'en-US'});await expect(a.locator('#refresh')).toHaveText('Refresh');await expect(b.locator('#refresh')).toHaveText('刷新');
  await host.respond('a',0,message());await expect(a.locator('#engineer')).toHaveValue(AGENT);
  await page.evaluate(()=>window.host.request('a','ui/resource-teardown'));
  const changed=message();changed._meta.gateway_ui.engine_view.solver_job.name='第二张卡仍可更新';await host.result('b',changed);
  await expect(b.locator('#task-title')).toHaveText('第二张卡仍可更新');await mapReady(b);await host.assertHealthy();
});

test('FORBIDDEN clears every old map, list, search and detail text',async({page})=>{
  const host=await openHost(page);const frame=await host.add();await mapReady(frame);await fullscreen(frame);
  await frame.locator('.mcp-marker[data-kind="ticket"]').first().click();
  await expect(frame.locator('#side-detail')).toContainText('合成测试地址');
  await frame.locator('#search').fill('合成');
  await host.result('card',message('forbidden'));
  await expect(frame.locator('#notice')).toContainText('无权读取');await expect(frame.locator('#refresh')).toBeDisabled();
  const body=await frame.locator('body').textContent();
  for(const privateValue of [JOB,'合成结果','合成工程师 A','合成测试地址','ticket-a','ticket-b'])expect(body).not.toContain(privateValue);
  await expect(frame.locator('#search')).toHaveValue('');expect(await frame.locator('.mcp-marker').count()).toBe(0);
  await host.assertHealthy();
});

test('host cancellation suppresses late results; a new input can start a fresh view',async({page})=>{
  const host=await openHost(page);const frame=await host.add();await mapReady(frame);
  await frame.locator('#refresh').click();await expect.poll(async()=>(await host.pending('card')).length).toBe(1);
  await host.notify('card','ui/notifications/tool-cancelled',{reason:'synthetic cancellation'});
  await expect(frame.locator('#notice')).toContainText('展示工具调用已取消');
  const late=message();late._meta.gateway_ui.engine_view.solver_job.name='CANCELED_RESULT';await host.respond('card',0,late);await host.result('card',late);
  await expect(frame.locator('#refresh')).toBeEnabled();await expect(frame.locator('#task-title')).toHaveText('合成结果');
  const restarted=message();Object.assign(restarted._meta.gateway_ui,{view:'gantt',engineer_id:AGENT});Object.assign(restarted.structuredContent,{view:'gantt',engineer_id:AGENT});restarted.content[0].text=JSON.stringify(restarted.structuredContent);
  await host.notify('card','ui/notifications/tool-input',{arguments:{job_id:JOB,view:'gantt',engineer_id:AGENT}});await host.result('card',restarted);
  await expect(frame.locator('#gantt-panel')).toBeVisible();await expect(frame.locator('#engineer')).toHaveValue(AGENT);await expect(frame.locator('#notice')).toBeHidden();await host.assertHealthy();
});

test('authentication failure on refresh clears data but does not expose challenge details',async({page})=>{
  const host=await openHost(page);const frame=await host.add();await mapReady(frame);await fullscreen(frame);
  await frame.locator('#engineer').selectOption(AGENT);await frame.locator('#refresh').click();await expect.poll(async()=>(await host.pending('card')).length).toBe(1);
  await host.respond('card',0,null,message('expired-authentication').error);
  await expect(frame.locator('#notice')).toContainText('认证失效');await expect(frame.locator('#refresh')).toBeDisabled();
  const text=await frame.locator('body').textContent();for(const value of [JOB,AGENT,'合成结果','Bearer','www_authenticate'])expect(text).not.toContain(value);
  await host.assertHealthy();
});
