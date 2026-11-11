import { test, expect, openHost, message, mapReady, AGENT } from './host-fixture.mjs';

const ready = kind => message(kind === 'gantt' ? 'gantt-ready' : 'ready');
function withToolRoute(result) {
  const value = structuredClone(result);
  value.structuredContent.display_tool_name = value._meta.gateway_ui.display_tool_name;
  value.content = [{ type: 'text', text: JSON.stringify(value.structuredContent) }];
  return value;
}
function withoutMeta(result) {
  const value = structuredClone(result);
  delete value._meta;
  return value;
}
function cardOptions(kind, result, overrides = {}) {
  const envelope = result._meta.gateway_ui;
  return {
    kind,
    context: { toolInfo: { tool: { name: envelope.display_tool_name, inputSchema: { type: 'object' } } } },
    input: { job_id: envelope.job_id, ...(envelope.engineer_id ? { engineer_id: envelope.engineer_id } : {}) },
    ...overrides,
  };
}
async function rendered(kind, frame) {
  if (kind === 'map') await mapReady(frame);
  else await expect(frame.locator('.gantt-bar')).toHaveCount(5);
  await expect(frame.locator('#notice')).toBeHidden();
}
async function noMoreRequests(host, frame, count) {
  // Drain iframe message handlers and the resulting render frames before
  // checking the absence of another call. No timer, polling, or network loop
  // is involved in the bootstrap path.
  await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await host.pending('card')).toHaveLength(count);
}

for (const kind of ['map', 'gantt']) {
  test(`${kind} restores metadata using an explicit Gateway tool route when optional host toolInfo is absent`, async ({ page }) => {
    const result = withToolRoute(ready(kind));
    if (kind === 'map') {
      result.structuredContent.engineer_id = AGENT;
      result._meta.gateway_ui.engineer_id = AGENT;
    }
    const host = await openHost(page);
    const frame = await host.add({ ...cardOptions(kind, result), result: withoutMeta(result), context: { toolInfo: undefined } });
    await expect.poll(async () => (await host.pending('card')).length).toBe(1);
    const call = (await host.pending('card'))[0];
    expect(call.params.name).toBe(result.structuredContent.display_tool_name);
    expect(call.params.arguments).toEqual(cardOptions(kind, result).input);
    await host.context('card', { theme: 'dark' });
    await host.respond('card', 0, result);
    await rendered(kind, frame);
    if (kind === 'map') await expect(frame.locator('#engineer')).toHaveJSProperty('value',AGENT);
    await host.result('card', withoutMeta(result));
    await noMoreRequests(host, frame, 1);
    expect(await host.messages('card')).toEqual([]);
    await host.assertHealthy();
  });

  test(`${kind} rejects invalid summary routes and conflicting host identity without a tool call`, async ({ page }) => {
    const result = withToolRoute(ready(kind)), host = await openHost(page);
    for (const [index, options] of [
      { name: 'gateway.solver_jobs.create', toolInfo: undefined },
      { name: ready(kind === 'map' ? 'gantt' : 'map')._meta.gateway_ui.display_tool_name, toolInfo: undefined },
      { name: `gw_${kind}_${'3'.repeat(32)}`, toolInfo: undefined },
      { name: result.structuredContent.display_tool_name, toolInfo: { tool: { name: 'gateway.solver_jobs.create', inputSchema: { type: 'object' } } } },
    ].entries()) {
      const id = `invalid-route-${index}`, invalid = withoutMeta(result);
      invalid.structuredContent.display_tool_name = options.name;
      const frame = await host.add({ ...cardOptions(kind, result), id, result: invalid, context: { toolInfo: options.toolInfo } });
      await expect(frame.locator('#notice')).toHaveAttribute('data-error', 'true');
      await expect(frame.locator('.snapshot-svg,.gantt-bar')).toHaveCount(0);
      expect(await host.pending(id)).toHaveLength(0);
    }
    await host.assertHealthy();
  });

  test(`${kind} bootstraps once through the official SDK when the initial result loses UI metadata`, async ({ page }) => {
    const result = ready(kind);
    if (kind === 'map') {
      result.structuredContent.engineer_id = AGENT;
      result._meta.gateway_ui.engineer_id = AGENT;
    }
    const host = await openHost(page);
    const frame = await host.add({ ...cardOptions(kind, result), result: withoutMeta(result) });
    await expect.poll(async () => (await host.pending('card')).length).toBe(1);
    const call = (await host.pending('card'))[0];
    expect(call.params.name).toBe(result._meta.gateway_ui.display_tool_name);
    expect(call.params.arguments).toEqual(cardOptions(kind, result).input);
    await expect(frame.locator('#notice')).toHaveAttribute('data-error', 'false');
    await expect(frame.locator('#notice')).toContainText('正在更新');
    await expect(frame.locator('.snapshot-svg,.gantt-bar')).toHaveCount(0);

    await host.respond('card', 0, result);
    await rendered(kind, frame);
    if (kind === 'map') await expect(frame.locator('#engineer')).toHaveJSProperty('value',AGENT);
    await noMoreRequests(host, frame, 1);
    expect(await host.messages('card')).toEqual([]);
    await host.assertHealthy();
  });

  test(`${kind} renders a complete initial result without any bootstrap request`, async ({ page }) => {
    const result = ready(kind), host = await openHost(page);
    const frame = await host.add({ ...cardOptions(kind, result), result });
    await rendered(kind, frame);
    await host.result('card', result);
    await rendered(kind, frame);
    await noMoreRequests(host, frame, 0);
    await host.assertHealthy();
  });

  test(`${kind} stops after one bootstrap when the direct reply also lacks metadata`, async ({ page }) => {
    const result = ready(kind), stripped = withoutMeta(result), host = await openHost(page);
    const frame = await host.add({ ...cardOptions(kind, result), result: stripped });
    await expect.poll(async () => (await host.pending('card')).length).toBe(1);
    await host.respond('card', 0, stripped);
    await expect(frame.locator('#notice')).toHaveAttribute('data-error', 'true');
    await expect(frame.locator('.snapshot-svg,.gantt-bar')).toHaveCount(0);
    await host.result('card', stripped);
    await noMoreRequests(host, frame, 1);
    expect(await host.messages('card')).toEqual([]);
    await host.assertHealthy();
  });

  test(`${kind} ignores a late metadata-free result for the previous input before bootstrapping the current job`, async ({ page }) => {
    const oldResult = ready(kind), result = ready(kind), host = await openHost(page);
    const currentJob = '00000000000000000000000000000003';
    result.structuredContent.job_id = currentJob;
    result._meta.gateway_ui.job_id = currentJob;
    result._meta.gateway_ui.task.job_id = currentJob;
    result._meta.gateway_ui.engine_view.solver_job.id = currentJob;
    const frame = await host.add({ ...cardOptions(kind, oldResult), result: null });
    await host.notify('card', 'ui/notifications/tool-input', { arguments: { job_id: currentJob } });
    await host.result('card', withoutMeta(oldResult));
    await noMoreRequests(host, frame, 0);

    await host.result('card', withoutMeta(result));
    await expect.poll(async () => (await host.pending('card')).length).toBe(1);
    expect((await host.pending('card'))[0].params.arguments).toEqual({ job_id: currentJob });
    await host.respond('card', 0, result);
    await rendered(kind, frame);
    await noMoreRequests(host, frame, 1);
    await host.assertHealthy();
  });

  test(`${kind} does not bootstrap authorization, tool identity, or stale-resource errors`, async ({ page }) => {
    const result = ready(kind), host = await openHost(page);
    const expired = message('forbidden');
    expired.structuredContent.code = 'INVALID_TOKEN';
    expired.content = [{ type: 'text', text: 'Synthetic expired authentication' }];
    for (const [index, error] of [message('forbidden'), expired, message('mcp_ui_tool_mismatch'), message('stale-resource')].entries()) {
      const id = `error-${index}`;
      const frame = await host.add({ ...cardOptions(kind, result), id, result: error });
      await expect(frame.locator('#notice')).toHaveAttribute('data-error', 'true');
      await expect(frame.locator('.snapshot-svg,.gantt-bar')).toHaveCount(0);
      expect(await host.pending(id)).toHaveLength(0);
    }
    await host.assertHealthy();
  });

  test(`${kind} keeps the fallback when the host does not advertise tool proxying`, async ({ page }) => {
    const result = ready(kind), host = await openHost(page);
    const frame = await host.add({ ...cardOptions(kind, result), result: withoutMeta(result), hostCapabilities: {} });
    await expect(frame.locator('#notice')).toHaveAttribute('data-error', 'true');
    await expect(frame.locator('.snapshot-svg,.gantt-bar')).toHaveCount(0);
    await noMoreRequests(host, frame, 0);
    await host.assertHealthy();
  });

  test(`${kind} keeps a legacy summary closed when both explicit and host tool identities are absent`, async ({ page }) => {
    const result = ready(kind), host = await openHost(page);
    delete result.structuredContent.display_tool_name;
    const frame = await host.add({ ...cardOptions(kind, result), result: withoutMeta(result), context: { toolInfo: undefined } });
    await expect(frame.locator('#notice')).toHaveAttribute('data-error', 'true');
    await expect(frame.locator('.snapshot-svg,.gantt-bar')).toHaveCount(0);
    await noMoreRequests(host, frame, 0);
    await host.assertHealthy();
  });
}
