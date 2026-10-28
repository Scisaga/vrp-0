import { validSnapshotContext, projectSnapshot, SVG_TOKEN } from './svg-snapshot.mjs';
import { buildMapScene } from './map-scene.mjs';
import { poiPosition } from './model.mjs';
import { translate } from './i18n.mjs';
import { snapshotFrame, snapshotZoomLimits, constrainSnapshotViewport, sameSnapshotViewport } from './svg-viewport.mjs';

const NS = 'http://www.w3.org/2000/svg';
const TAGS = new Set(['svg','g','image','path','circle','text','title','desc','rect','line','polyline','polygon','ellipse','tspan']);
const ATTRS = new Set(['id','xmlns','viewBox','width','height','x','y','x1','y1','x2','y2','cx','cy','r','rx','ry','d','points',
  'fill','fill-opacity','stroke','stroke-width','stroke-opacity','stroke-linecap','stroke-linejoin','stroke-dasharray','opacity',
  'transform','preserveAspectRatio','font-size','font-family','font-weight','text-anchor','dominant-baseline','vector-effect',
  'display','visibility','role','aria-label','href']);
const fail = code => Object.assign(new Error(code), {code});
const safeFailure = code => fail(code || 'MAP_SNAPSHOT_INVALID_GEOMETRY');

/** Parse in an inert XML document, reject rather than silently repair active content. */
export function readSafeSvg(snapshot, parser = new DOMParser()) {
  if (/<!DOCTYPE|<!ENTITY|<\?/i.test(snapshot.svg)) throw safeFailure();
  const document = parser.parseFromString(snapshot.svg, 'image/svg+xml');
  const root = document.documentElement;
  if (document.querySelector('parsererror') || root.localName !== 'svg' || root.namespaceURI !== NS
      || root.getAttribute('viewBox') !== `0 0 ${snapshot.width} ${snapshot.height}`) throw safeFailure();
  const nodes = [root, ...root.querySelectorAll('*')], ids = new Map();
  if (nodes.length > 100000) throw safeFailure();
  let images = 0;
  for (const node of nodes) {
    if (node.namespaceURI !== NS || !TAGS.has(node.localName) || (node !== root && node.localName === 'svg')) throw safeFailure();
    for (const attr of node.attributes) {
      if (!ATTRS.has(attr.name) || (attr.namespaceURI !== null && !(attr.name === 'xmlns' && attr.value === NS))
          || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(attr.value)) throw safeFailure();
      if (attr.name === 'href') {
        if (node.localName !== 'image' || !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(attr.value)) throw safeFailure();
      } else if (attr.name !== 'xmlns' && /(?:url\s*\(|(?:https?|javascript|data|blob):|@import)/i.test(attr.value)) throw safeFailure();
      if (attr.name === 'id') {
        if (!SVG_TOKEN.test(attr.value) || ids.has(attr.value)) throw safeFailure();
        ids.set(attr.value,node);
      }
    }
    if (node.localName === 'image') {
      if (!node.hasAttribute('href')) throw safeFailure();
      images++;
    }
  }
  if (images !== 1) throw safeFailure();
  return {root,ids};
}

/** Network-free fixed-extent map; business filtering and replay stay in Viewer. */
export class SvgMapView {
  constructor(container, {onSelect, onFailure, model, onDiagnostic = () => {}}) {
    Object.assign(this,{container,onSelect,onFailure,onDiagnostic,model,disposed:false,bindings:[],view:null,
      fitted:true,rasterDensity:1,gestureNotified:false});
  }
  bind(node,type,listener,options) {
    node.addEventListener(type,listener,options);
    this.bindings.push(()=>node.removeEventListener(type,listener,options));
  }
  async mount(context,provider,scene,locale) {
    if (context?.provider !== provider) throw fail('MAP_PROVIDER_MISMATCH');
    if (!validSnapshotContext(context)) throw safeFailure();
    if (!context.enabled) throw fail(context.error_code || 'MAP_DISABLED');
    this.snapshot=context.snapshot;this.locale=locale;
    const {root,ids}=readSafeSvg(this.snapshot);
    const prefix=`svg-${Array.from(crypto.getRandomValues(new Uint8Array(12)),byte=>byte.toString(16).padStart(2,'0')).join('')}-`;
    for (const [id,node] of ids) node.id=prefix+id;
    this.svg=document.importNode(root,true);
    this.nodes=new Map([...ids.keys()].map(id=>[id,this.svg.querySelector(`[id="${prefix+id}"]`)]));
    this.svg.classList.add('snapshot-svg');
    this.svg.setAttribute('tabindex','0');
    this.svg.setAttribute('aria-label',translate(locale,'mapGestures'));
    this.svg.removeAttribute('width');this.svg.removeAttribute('height');
    this.registerElements();
    this.frame=document.createElement('div');this.frame.className='snapshot-frame';
    this.attribution=document.createElement('div');this.attribution.className='snapshot-attribution';
    this.attribution.textContent=this.snapshot.attribution;
    this.status=document.createElement('div');this.status.className='snapshot-status';this.status.hidden=true;
    this.status.setAttribute('role','status');this.status.setAttribute('aria-live','polite');
    const controls=document.createElement('div');controls.className='snapshot-controls';this.zoomButtons=[];
    for (const [symbol,factor,key] of [['+',.8,'mapZoomIn'],['−',1.25,'mapZoomOut']]) {
      const button=document.createElement('button');button.type='button';button.textContent=symbol;
      button.setAttribute('aria-label',translate(locale,key));
      this.bind(button,'click',()=>{this.beginGesture();this.zoom(factor);});
      controls.append(button);this.zoomButtons.push(button);
    }
    this.frame.append(this.svg,controls,this.attribution,this.status);
    this.container.replaceChildren(this.frame);
    await this.loadImages();
    if(this.disposed)throw fail('MAP_ABORTED');
    this.bindInteractions();this.update(scene);this.fit();this.container.dataset.svgMap='ready';
  }
  registerElements() {
    this.agents=new Map();this.tickets=new Map();this.routes=[];
    const model=this.model,expected=buildMapScene(model);
    const ticketOwners=new Map(expected.markers.filter(marker=>marker.kind==='ticket').map(marker=>[marker.id,marker.agentId]));
    const expectedRoutes=new Map(expected.lines.map(line=>[line.key,line]));
    const get=(id,tag)=>{const node=this.nodes.get(id);if(!node||tag&&!tag.includes(node.localName))throw safeFailure();return node;};
    for(const entry of this.snapshot.elements.agents){
      const agent=model?.indexes.agents.get(entry.engineer_id);
      if(!agent||agent.virtual===true)throw safeFailure();
      const position=poiPosition(model.indexes.pois.get(agent.start_loc));this.checkPoint(entry,position);
      const node=get(entry.element_id,['g']),playback=get(entry.playback_element_id,['g']);
      node.dataset.kind='agent';node.dataset.id=agent.id;node.classList.add('snapshot-point');
      node.setAttribute('role','button');node.setAttribute('tabindex','0');node.setAttribute('aria-label',agent.name||agent.id);
      playback.setAttribute('display','none');playback.classList.add('snapshot-playback','snapshot-point');
      playback.dataset.kind='agent';playback.dataset.id=agent.id;playback.setAttribute('role','button');
      playback.setAttribute('tabindex','0');playback.setAttribute('aria-label',agent.name||agent.id);
      const sourceLabel=node.querySelector('text'),replayLabel=sourceLabel?sourceLabel.cloneNode(true):document.createElementNS(NS,'text');
      for(const label of [replayLabel,...replayLabel.querySelectorAll('[id]')])label.removeAttribute('id');
      if(!sourceLabel){replayLabel.setAttribute('y','-16');replayLabel.setAttribute('text-anchor','middle');replayLabel.setAttribute('font-size','14');replayLabel.setAttribute('fill','#172c3b');replayLabel.textContent=agent.name||agent.id;}
      playback.append(replayLabel);this.agents.set(agent.id,{...entry,node,playback});
    }
    for(const entry of this.snapshot.elements.tickets){
      const ticket=model?.indexes.tickets.get(entry.ticket_id);
      if(!ticket||!ticketOwners.has(ticket.id)||ticketOwners.get(ticket.id)!==entry.engineer_id)throw safeFailure();
      this.checkPoint(entry,poiPosition(model.indexes.pois.get(ticket.loc)));
      const node=get(entry.element_id,['g']);node.dataset.kind='ticket';node.dataset.id=ticket.id;node.classList.add('snapshot-point');
      node.setAttribute('role','button');node.setAttribute('tabindex','0');node.setAttribute('aria-label',ticket.id);
      this.tickets.set(ticket.id,{...entry,node});
    }
    for(const entry of this.snapshot.elements.routes){
      const agent=model?.indexes.agents.get(entry.engineer_id),route=agent?.routes?.[entry.route_index];
      const isReturn=Array.isArray(agent?.tickets)&&agent.routes?.length===agent.tickets.length+1&&entry.route_index===agent.tickets.length;
      if(!agent||agent.virtual===true||!route||!expectedRoutes.has(`${entry.engineer_id}:${entry.route_index}`)||entry.return_route!==isReturn)throw safeFailure();
      let node=get(entry.element_id,['path','polyline','g']);
      if(node.localName!=='g'){
        const wrapper=document.createElementNS(NS,'g');node.before(wrapper);wrapper.append(node);node=wrapper;
      }
      const shape=node.querySelector('path,polyline');if(!shape)throw safeFailure();
      // Clone only safe, inert geometry. Never duplicate IDs or synthesize a business selector.
      const halo=shape.cloneNode(false),hit=shape.cloneNode(false);
      for(const clone of [halo,hit])clone.removeAttribute('id');
      halo.classList.add('snapshot-route-halo');halo.setAttribute('fill','none');
      hit.classList.add('snapshot-route-hit');hit.setAttribute('fill','none');hit.setAttribute('stroke','transparent');
      hit.removeAttribute('stroke-dasharray');hit.setAttribute('stroke-width','12');
      hit.setAttribute('vector-effect','non-scaling-stroke');hit.setAttribute('pointer-events','stroke');
      shape.classList.add('snapshot-route-shape');shape.before(halo);node.append(hit);
      node.dataset.kind='route';node.dataset.id=agent.id;node.dataset.routeIndex=String(entry.route_index);
      node.classList.add('snapshot-route');node.setAttribute('role','button');node.setAttribute('tabindex','0');
      node.setAttribute('aria-pressed','false');
      node.setAttribute('aria-label',`${agent.name||agent.id} · ${translate(this.locale,entry.return_route?'returnLeg':'routes')} ${entry.route_index+1}`);
      this.routes.push({...entry,node});
    }
    // The capacity limit also covers locally added hit/halo/replay elements.
    if(this.svg.querySelectorAll('*').length>100000)throw safeFailure();
  }
  checkPoint(entry,position) {
    const projected=projectSnapshot(position,this.snapshot.projection);
    if(!projected||Math.abs(projected[0]-entry.x)>.1||Math.abs(projected[1]-entry.y)>.1)throw safeFailure();
  }
  loadImages() {
    return Promise.all([...this.svg.querySelectorAll('image')].map(element=>new Promise((resolve,reject)=>{
      let settled=false;
      const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve();};
      const timer=setTimeout(()=>finish(fail('MAP_TIMEOUT')),10000);
      this.bind(element,'error',()=>finish(fail('MAP_LOAD_FAILED')));
      const probe=new Image();
      this.bind(probe,'load',()=>{
        const x=probe.naturalWidth/this.snapshot.width,y=probe.naturalHeight/this.snapshot.height;
        if(![1,1.5,2].includes(x)||x!==y){finish(fail('MAP_LOAD_FAILED'));return;}
        this.rasterDensity=x;this.frame.dataset.rasterScale=String(x);finish();
      });
      this.bind(probe,'error',()=>finish(fail('MAP_CSP_BLOCKED')));probe.src=element.getAttribute('href');
      this.bindings.push(()=>{finish(fail('MAP_ABORTED'));probe.removeAttribute('src');});
    })));
  }
  beginGesture() {this.gestureNotified=false;}
  refreshLimitMessage(force=false) {
    if(!this.statusKey)return;
    const fullscreen=this.container.closest('.map-app')?.dataset.mode==='fullscreen';
    const message=translate(this.locale,this.statusKey+(fullscreen?'Fullscreen':''));
    if(force||this.status.textContent!==message)this.status.textContent=message;
  }
  notifyLimit(key) {
    if(this.gestureNotified||this.disposed)return;this.gestureNotified=true;
    this.statusKey=key;this.refreshLimitMessage(true);this.status.hidden=false;
    clearTimeout(this.statusTimer);this.statusTimer=setTimeout(()=>{if(!this.disposed)this.status.hidden=true;},2500);
  }
  bindInteractions() {
    const select=target=>{
      const node=target.closest?.('[data-kind]');
      if(!node||!this.svg.contains(node)){this.onSelect({kind:'clear-route'});return;}
      if(node.dataset.kind==='route')this.onSelect({kind:'route',id:node.dataset.id,routeIndex:Number(node.dataset.routeIndex)});
      else if(node.dataset.kind==='agent'||node.dataset.kind==='ticket')this.onSelect({kind:node.dataset.kind,id:node.dataset.id});
    };
    this.bind(this.svg,'click',event=>{if(this.dragged){this.dragged=false;return;}select(event.target);});
    this.bind(this.svg,'keydown',event=>{
      if((event.key==='Enter'||event.key===' ')&&event.target!==this.svg){event.preventDefault();select(event.target);return;}
      if(event.key==='Escape'&&this.routes.some(entry=>entry.node.dataset.selected==='true')){
        event.preventDefault();event.stopPropagation();this.onSelect({kind:'clear-route'});return;
      }
      if(!event.repeat)this.beginGesture();
      if(['+','=','-'].includes(event.key)){event.preventDefault();this.zoom(event.key==='-'?1.25:.8);}
      const step=.1,pan={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]}[event.key];
      if(pan){event.preventDefault();this.fitted=false;this.setViewport({...this.view,x:this.view.x+pan[0]*this.view.width,y:this.view.y+pan[1]*this.view.height},{notify:true});}
    });
    this.bind(this.svg,'wheel',event=>{
      event.preventDefault();const now=performance.now();if(!this.lastWheel||now-this.lastWheel>250)this.beginGesture();this.lastWheel=now;
      const rect=this.svg.getBoundingClientRect();this.zoom(event.deltaY<0?.8:1.25,[(event.clientX-rect.left)/rect.width,(event.clientY-rect.top)/rect.height]);
    },{passive:false});
    this.bind(this.svg,'pointerdown',event=>{
      if(event.button!==0||!this.view)return;this.beginGesture();
      this.drag={x:event.clientX,y:event.clientY,view:{...this.view},pointerId:event.pointerId};this.dragged=false;
    });
    this.bind(this.svg,'pointermove',event=>{
      if(!this.drag||event.pointerId!==this.drag.pointerId)return;
      const dx=event.clientX-this.drag.x,dy=event.clientY-this.drag.y;
      if(!this.dragged&&Math.abs(dx)+Math.abs(dy)<=4)return;
      if(!this.dragged){this.dragged=true;this.svg.setPointerCapture(event.pointerId);}
      this.fitted=false;const rect=this.svg.getBoundingClientRect();
      this.setViewport({...this.drag.view,x:this.drag.view.x-dx*this.drag.view.width/rect.width,
        y:this.drag.view.y-dy*this.drag.view.height/rect.height},{notify:true});
    });
    const release=event=>{
      if(this.drag&&event.pointerId!==this.drag.pointerId)return;this.drag=null;
      if(this.svg.hasPointerCapture(event.pointerId))this.svg.releasePointerCapture(event.pointerId);
    };
    this.bind(this.svg,'pointerup',release);this.bind(this.svg,'pointercancel',release);
    this.bind(this.svg,'lostpointercapture',()=>{this.drag=null;});
  }
  update(scene) {
    if(this.disposed)return;
    const key=JSON.stringify([scene.markers.map(item=>item.key),scene.lines.map(item=>item.key)]);
    const changed=this.sceneKey!==key;this.sceneKey=key;this.scene=scene;
    const markers=new Map(scene.markers.map(item=>[item.key,item])),lines=new Map(scene.lines.map(item=>[item.key,item]));
    for(const [id,entry]of this.agents){
      const item=markers.get(`agent:${id}`);entry.node.setAttribute('display',item?'inline':'none');
      entry.node.dataset.selected=String(Boolean(item?.selected));if(!item)entry.playback.setAttribute('display','none');
    }
    for(const [id,entry]of this.tickets){
      const item=markers.get(`ticket:${id}`);entry.node.setAttribute('display',item?'inline':'none');entry.node.dataset.selected=String(Boolean(item?.selected));
    }
    for(const entry of this.routes){
      const item=lines.get(`${entry.engineer_id}:${entry.route_index}`);entry.node.setAttribute('display',item?'inline':'none');
      entry.node.dataset.selected=String(Boolean(item?.selected));entry.node.setAttribute('aria-pressed',String(Boolean(item?.selected)));
    }
    if(changed&&this.view)this.resize(true);
  }
  sceneBounds() {
    const positions=[...(this.scene?.markers||[]).map(item=>item.position),...(this.scene?.lines||[]).flatMap(line=>line.positions)]
      .map(position=>projectSnapshot(position,this.snapshot.projection)).filter(Boolean);
    if(!positions.length)return {left:0,top:0,right:this.snapshot.width,bottom:this.snapshot.height};
    let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
    for(const [x,y]of positions){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
    for(const marker of this.scene?.markers||[]){
      const entry=(marker.kind==='agent'?this.agents:this.tickets).get(marker.id);if(!entry)continue;
      const box=entry.bounds??(entry.bounds=entry.node.getBBox());
      left=Math.min(left,Math.max(0,entry.x+box.x));right=Math.max(right,Math.min(this.snapshot.width,entry.x+box.x+box.width));
      top=Math.min(top,Math.max(0,entry.y+box.y));bottom=Math.max(bottom,Math.min(this.snapshot.height,entry.y+box.y+box.height));
    }
    return {left,top,right,bottom};
  }
  layout() {
    const rect=this.container.getBoundingClientRect();
    const layout=snapshotFrame(rect,this.snapshot,this.sceneBounds());if(!layout)return null;
    this.containerSize={width:rect.width,height:rect.height};this.frameSize=layout.frame;this.lastDpr=window.devicePixelRatio||1;
    const {x,y,width,height}=layout.frame;
    Object.assign(this.frame.style,{left:`${x}px`,top:`${y}px`,width:`${width}px`,height:`${height}px`});
    return layout;
  }
  fit() {
    if(this.disposed)return;const layout=this.layout();if(!layout)return;
    this.fitted=true;this.applyViewport(layout.fit);
  }
  focus(position) {
    const point=projectSnapshot(position,this.snapshot.projection);
    if(point&&this.view){this.fitted=false;this.setViewport({...this.view,x:point[0]-this.view.width/2,y:point[1]-this.view.height/2});}
  }
  limits() {return snapshotZoomLimits(this.snapshot,this.frameSize,this.rasterDensity,window.devicePixelRatio);}
  zoom(factor,anchor=[.5,.5]) {
    if(!this.view||this.disposed)return;
    const old=this.view,{minWidth,maxWidth}=this.limits();
    const width=Math.max(minWidth,Math.min(maxWidth,old.width*factor)),ratio=width/old.width;
    this.fitted=false;
    this.setViewport({x:old.x+old.width*anchor[0]*(1-ratio),y:old.y+old.height*anchor[1]*(1-ratio),width,height:old.height*ratio},{notify:true});
    if(old.width*factor<minWidth-1e-6)this.notifyLimit('mapZoomLimit');
    else if(old.width*factor>maxWidth+1e-6)this.notifyLimit('mapSnapshotEdge');
  }
  resize(force=false) {
    if(this.disposed||!this.view)return;
    if(!this.status.hidden)this.refreshLimitMessage();
    const rect=this.container.getBoundingClientRect();
    if(!force&&this.containerSize&&Math.abs(rect.width-this.containerSize.width)<.1&&Math.abs(rect.height-this.containerSize.height)<.1&&this.lastDpr===(window.devicePixelRatio||1))return;
    const previous=this.getViewport(),layout=this.layout();if(!layout)return;
    if(this.fitted)this.applyViewport(layout.fit);else this.setViewport(previous);
  }
  moveAgents(states) {
    const active=new Set();
    for(const state of states){
      const entry=this.agents.get(state.id),point=projectSnapshot(state.position,this.snapshot.projection);
      if(!entry||!point||entry.node.getAttribute('display')==='none')continue;
      active.add(state.id);entry.playback.removeAttribute('visibility');entry.playback.setAttribute('transform',`translate(${point[0]} ${point[1]})`);
      entry.playback.setAttribute('display','inline');entry.node.setAttribute('visibility','hidden');
    }
    for(const [id,entry]of this.agents)if(!active.has(id)){entry.playback.setAttribute('display','none');entry.node.removeAttribute('visibility');}
  }
  getViewport() {return this.view?{...this.view,fitted:this.fitted,cssWidth:this.frameSize?.width}:null;}
  setViewport(view,{notify=false}={}) {
    if(!this.svg||this.disposed||!view||!this.frameSize)return;
    if(view.fitted===true){this.fit();return;}
    if(view.fitted===false)this.fitted=false;
    if(Number.isFinite(view.cssWidth)&&view.cssWidth>0){
      const width=view.width*this.frameSize.width/view.cssWidth,height=width*this.frameSize.height/this.frameSize.width;
      view={x:view.x+(view.width-width)/2,y:view.y+(view.height-height)/2,width,height};
    }
    this.applyViewport(view,notify);
  }
  applyViewport(view,notify=false) {
    const next=constrainSnapshotViewport(view,this.snapshot,this.frameSize,this.rasterDensity,window.devicePixelRatio);if(!next)return;
    if(notify&&!sameSnapshotViewport(view,next))this.notifyLimit('mapSnapshotEdge');
    this.view=next;
    this.svg.setAttribute('viewBox',`${next.x} ${next.y} ${next.width} ${next.height}`);
    const {minWidth,maxWidth}=this.limits();
    this.zoomButtons[0].disabled=next.width<=minWidth+1e-6;this.zoomButtons[1].disabled=next.width>=maxWidth-1e-6;
  }
  dispose() {
    if(this.disposed)return;this.disposed=true;clearTimeout(this.statusTimer);
    for(const remove of this.bindings.splice(0))remove();
    this.container.replaceChildren();delete this.container.dataset.svgMap;
    this.model=null;this.snapshot=null;this.nodes?.clear();this.agents?.clear();this.tickets?.clear();this.routes=[];
    this.svg=null;this.frame=null;this.attribution=null;this.status=null;this.scene=null;this.drag=null;
  }
}
