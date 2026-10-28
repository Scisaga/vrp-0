/** Synthetic fixture only: no real map imagery, production archive or network. */
import fs from 'node:fs';
import {buildViewModel} from '../../main/mcp-ui/model.mjs';
import {buildMapScene} from '../../main/mcp-ui/map-scene.mjs';
import {projectSnapshot} from '../../main/mcp-ui/svg-snapshot.mjs';
import {nativeRaster} from './raster-fixture.mjs';
const image=fs.readFileSync(new URL('./fixtures/synthetic-basemap.png',import.meta.url)).toString('base64');
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function snapshotContext(engineView,provider='AMAP',locale='zh-CN',density=1) {
  const context={enabled:false,provider,browser_key:'',js_url:'',css_url:null,locale,renderer_url:'',renderer_origin:'',render_mode:'svg_snapshot_v1',snapshot:null,error_code:null};
  if(!engineView)return context;
  const model=buildViewModel(engineView),scene=buildMapScene(model),positions=[...scene.markers.map(item=>item.position),...scene.lines.flatMap(item=>item.positions)];
  if(!positions.length){context.error_code='MAP_SNAPSHOT_NO_GEOMETRY';return context;}
  const longitude=positions.reduce((total,point)=>total+point[0],0)/positions.length,latitude=positions.reduce((total,point)=>total+point[1],0)/positions.length;
  const extent=(world_size)=>{const projection={kind:'web_mercator',world_size,origin_x:0,origin_y:0,center_longitude:longitude};const center=projectSnapshot([longitude,latitude],projection);return {...projection,origin_x:center[0]-512,origin_y:center[1]-384};};
  let projection=extent(256*2**16);while(projection.world_size>256&&positions.some(point=>{const [x,y]=projectSnapshot(point,projection);return x<90||x>934||y<70||y>698;}))projection=extent(projection.world_size/2);
  const elements={agents:[],tickets:[],routes:[]},body=[];
  scene.lines.forEach((line,index)=>{const element_id=`s-r${index}`;elements.routes.push({engineer_id:line.agentId,route_index:Number(line.key.slice(line.key.lastIndexOf(':')+1)),element_id,return_route:line.returnLeg});
    const d=line.positions.map((point,index)=>{const [x,y]=projectSnapshot(point,projection);return `${index?'L':'M'}${x} ${y}`;}).join(' ');
    body.push(`<g id="${element_id}"><path d="${d}" fill="none" stroke="${line.color}" stroke-width="3"${line.returnLeg?' stroke-dasharray="7 5"':''}/></g>`);
  });
  scene.markers.forEach((marker,index)=>{const element_id=`s-m${index}`,[x,y]=projectSnapshot(marker.position,projection);
    if(marker.kind==='agent')elements.agents.push({engineer_id:marker.id,element_id,playback_element_id:`s-p${index}`,x,y});
    else elements.tickets.push({ticket_id:marker.id,engineer_id:marker.agentId,element_id,x,y});
    body.push(`<g id="${element_id}" transform="translate(${x} ${y})"><circle r="${marker.kind==='agent'?10:8}" fill="${marker.color}" stroke="#fff" stroke-width="2"/><text y="-16" text-anchor="middle" font-size="14" fill="#172c3b">${escape(marker.label)}</text></g>`);
    if(marker.kind==='agent')body.push(`<g id="s-p${index}" visibility="hidden" transform="translate(0 0)"><circle r="10" fill="${marker.color}" stroke="#fff" stroke-width="3"/></g>`);
  });
  context.enabled=true;context.snapshot={svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 768" width="1024" height="768"><image href="data:image/png;base64,${density===1?image:nativeRaster(density)}" x="0" y="0" width="1024" height="768"/>${body.join('')}</svg>`,width:1024,height:768,projection,elements,attribution:'Synthetic basemap fixture — not real map imagery'};return context;
}
export function withSnapshot(message,{density=1}={}) {const value=structuredClone(message),envelope=value?._meta?.gateway_ui;if(envelope?.view==='map')envelope.map_context=snapshotContext(envelope.engine_view,envelope.task.map_provider,envelope.map_context.locale,density);return value;}
