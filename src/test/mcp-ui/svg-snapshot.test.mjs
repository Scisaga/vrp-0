import {buildViewModel} from '../../main/mcp-ui/model.mjs';
import {buildMapScene} from '../../main/mcp-ui/map-scene.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {validSnapshot,validSnapshotContext,projectSnapshot} from '../../main/mcp-ui/svg-snapshot.mjs';
import {readEnvelope} from '../../main/mcp-ui/bridge.mjs';
const source=JSON.parse(fs.readFileSync(new URL('../../../docs/integrations/gateway/fixtures/mcp-result-view/payloads.json',import.meta.url),'utf8')).find(item=>item.name==='ready').message;
const context=()=>structuredClone(source._meta.gateway_ui.map_context);
test('route selection uses original index without changing the engineer filter or road semantics',()=>{
 const model=buildViewModel(source._meta.gateway_ui.engine_view),agent=model.agents[0];
 const all=buildMapScene(model),scene=buildMapScene(model,{route:{engineerId:agent.id,routeIndex:2}});
 assert.equal(scene.lines.length,all.lines.length);assert.equal(scene.markers.length,all.markers.length);
 assert.deepEqual(scene.lines.filter(line=>line.selected).map(line=>line.key),[`${agent.id}:2`]);
 assert.equal(scene.lines.find(line=>line.selected).returnLeg,true);
 const missing=buildMapScene(model,{route:{engineerId:agent.id,routeIndex:99}});
 assert.equal(missing.lines.some(line=>line.selected),false);
});
test('SVG context rejects credentials, renderer URLs and inconsistent snapshot/error states',()=>{
 assert.equal(validSnapshotContext(context()),true);
 for(const change of [value=>value.browser_key='unexpected-browser-key',value=>value.renderer_url='https://external.invalid/',value=>value.render_mode='other',value=>value.error_code='RAW_SECRET',value=>value.snapshot=null,value=>value.enabled=false]){
  const value=context();change(value);assert.equal(validSnapshotContext(value),false);
 }
 const error=context();Object.assign(error,{enabled:false,snapshot:null,error_code:'MAP_SNAPSHOT_UPSTREAM_ERROR'});assert.equal(validSnapshotContext(error),true);
 const result=structuredClone(source);result._meta.gateway_ui.map_context=error;
 assert.ok(readEnvelope(result,{viewKind:'map'}).engine_view,'map failure must retain the already-ready safe projection');
});
test('snapshot metadata validates finite projection, fixed dimensions and unique typed references',()=>{
 const original=context().snapshot;assert.equal(validSnapshot(original),true);
 for(const change of [value=>value.width=0,value=>value.height=512,value=>value.projection.world_size=0,value=>value.projection.origin_x=Infinity,
  value=>value.projection.center_longitude=181,value=>value.elements.agents[0].element_id='bad" id',value=>value.elements.agents[0].element_id=true,
  value=>value.elements.agents[0].playback_element_id=value.elements.agents[0].element_id,
  value=>value.elements.tickets.push(value.elements.tickets[0]),value=>value.elements.routes[0].route_index=-1,
  value=>value.elements.routes[0].return_route=null,value=>value.attribution='' ]){
  const value=structuredClone(original);change(value);assert.equal(validSnapshot(value),false);
 }
});
test('Mercator uses correct longitude/latitude and shortest wrap near date line',()=>{
 const projection={kind:'web_mercator',world_size:1024,origin_x:0,origin_y:0,center_longitude:0};
 assert.deepEqual(projectSnapshot([0,0],projection),[512,512]);
 assert.equal(projectSnapshot([120,90],projection),null);assert.equal(projectSnapshot([NaN,30],projection),null);assert.equal(projectSnapshot(null,projection),null);
 const wrapped={...projection,center_longitude:179};
 const first=projectSnapshot([179,0],wrapped),second=projectSnapshot([-179,0],wrapped);assert.ok(Math.abs(second[0]-first[0])<6);
 const north=projectSnapshot([0,30],projection);assert.ok(north[1]<512);assert.equal(north[0],512);
});

test('Gantt rejects SVG context additions and never acquires Map capabilities',()=>{
 const payloads=JSON.parse(fs.readFileSync(new URL('../../../docs/integrations/gateway/fixtures/mcp-result-view/payloads.json',import.meta.url),'utf8'));
 for(const key of ['snapshot','render_mode','error_code']){
  const value=structuredClone(payloads.find(item=>item.name==='gantt-ready').message);value._meta.gateway_ui.map_context[key]=null;
  assert.throws(()=>readEnvelope(value,{viewKind:'gantt'}),error=>error.code==='MCP_UI_ENVELOPE_INVALID');
 }
});

test('fixture sizes are not product limits; 201 engineers and 1001 tickets are accepted',()=>{
 const snapshot=context().snapshot;
 snapshot.elements.agents=Array.from({length:201},(_,index)=>({engineer_id:`engineer-${index}`,element_id:`agent-${index}`,playback_element_id:`playback-${index}`,x:index,y:0}));
 snapshot.elements.tickets=Array.from({length:1001},(_,index)=>({ticket_id:`ticket-${index}`,engineer_id:null,element_id:`ticket-${index}`,x:index,y:0}));
 assert.equal(validSnapshot(snapshot),true);
 snapshot.svg='中'.repeat(3*1024*1024);assert.equal(validSnapshot(snapshot),false,'UTF-8 bytes, not UTF-16 length, enforce SVG capacity');
 const explosion=context().snapshot;explosion.elements.routes=new Array(100001).fill(null);assert.equal(validSnapshot(explosion),false,'reject mapping explosions before iterating untrusted entries');
});

test('opaque business IDs retain original model semantics while SVG tokens stay strict',()=>{
 const result=structuredClone(source),plan=result._meta.gateway_ui.engine_view.solver_job.plan;
 const old=plan.agents[0].id,special='工程师\n\u007f\u0001';plan.agents[0].id=special;for(const ticket of plan.tickets)if(ticket.agent===old)ticket.agent=special;
 assert.equal(buildViewModel(result._meta.gateway_ui.engine_view).invalidIdentity,false);
 const snapshot=context().snapshot;for(const entry of [...snapshot.elements.agents,...snapshot.elements.routes])entry.engineer_id=special;
 for(const entry of snapshot.elements.tickets)if(entry.engineer_id===old)entry.engineer_id=special;
 assert.equal(validSnapshot(snapshot),true);snapshot.elements.agents[0].element_id='unsafe\nid';assert.equal(validSnapshot(snapshot),false);
});
