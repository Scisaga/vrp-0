import validateSchema from 'mcp-view-validator';
import { createViewerBridge, readEnvelope } from './bridge.mjs';
import { buildViewModel, buildReplay, parsePlanTime, formatPlanTime, poiPosition, validateViewSemantics } from './model.mjs';
import { MapView, buildMapScene, colorFor } from './maps.mjs';
import { translate, supportedLocale } from './i18n.mjs';

const $ = id => document.getElementById(id);
const state = {
  envelope:null, model:null, replay:null, playbackRangeCache:null, input:null, expectedJob:null, boundVersion:null,
  view:'map', engineerId:null, ticketId:null, missingEngineer:null, missingTicket:null, locale:'zh-CN', theme:'light',
  mode:'inline', sidebar:'agents', search:'', sidebarOpen:false, zoom:1, ganttScroll:{left:0,top:0},
  cursor:null, speed:1, playing:false, connected:false, refreshing:false, error:null, stale:false,
  map:null, mapKey:null, mapReady:false, mapError:null, mapEpoch:0, resultEpoch:0,
  destroyed:false, frame:0, lastTick:null, lastLabels:0, inputApplied:false,
};
const t = key => translate(state.locale,key);
function node(tag, text, className) { const element=document.createElement(tag); if(text!==undefined)element.textContent=String(text); if(className)element.className=className; return element; }
function button(text, click, className) { const element=node('button',text,className);element.type='button';element.addEventListener('click',click);return element; }
function label(value) { return value === null || value === undefined || value === '' ? t('none') : String(value); }
function nameOf(agent) { return agent ? agent.name || agent.id : t('unknown'); }
function rememberFocus() { return document.activeElement?.dataset?.focusKey; }
function restoreFocus(key) { if(!key)return;for(const element of document.querySelectorAll('[data-focus-key]'))if(element.dataset.focusKey===key){element.focus({preventScroll:true});break;} }
function pair(container, key, value) { container.append(node('dt',t(key)),node('dd',label(value))); }
function tell(key, { stale=false }={}) { state.error=key;state.stale=stale;renderNotice(); }
function errorKey(error) {
  const code=error?.code || '';
  if(/AUTH|TOKEN|UNAUTHENTICATED/.test(code))return 'auth';
  if(/FORBIDDEN|ACCESS_DENIED|NOT_FOUND/.test(code))return 'denied';
  if(/TOOL_MISMATCH/.test(code))return 'wrongTool';
  if(/RESOURCE/.test(code))return 'resource';
  if(/VIEW_UNSUPPORTED/.test(code))return 'unsupportedView';
  if(/FULLSCREEN/.test(code))return 'fullscreenDenied';
  if(/CANCEL/.test(code))return 'canceledTool';
  if(/UNAVAILABLE/.test(code))return 'unavailable';
  if(/TOOL_FAILED|RATE_LIMITED|REQUEST_SCHEMA/.test(code))return 'businessError';
  if(/REFRESH_FAILED|CONNECTION_CLOSED|NOT_CONNECTED/.test(code))return 'networkError';
  if(/MODEL|ENVELOPE|IDENTITY|CONTRACT|SCHEMA|INPUT/.test(code))return 'invalidResult';
  return 'protocolError';
}
function handleError(error) {
  if(state.destroyed)return;
  pause();
  if(error?.clearData){clearData();state.expectedJob=null;}
  tell(errorKey(error),{stale:!error?.clearData && Boolean(state.envelope) && !/FULLSCREEN/.test(error?.code || '')});
  render();
}
function clearData() {
  pause(); disposeMap(); state.envelope=null;state.model=null;state.replay=null;state.playbackRangeCache=null;state.cursor=null;
  state.engineerId=null;state.ticketId=null;state.missingEngineer=null;state.missingTicket=null;state.search='';state.resultEpoch++;
  $('side-detail').replaceChildren();$('map-legend').replaceChildren();$('search').value='';
}
function disposeMap() { state.mapEpoch++; state.map?.dispose();state.map=null;state.mapKey=null;state.mapReady=false;state.mapError=null; }
function resetSelection() { state.engineerId=null;state.ticketId=null;state.missingEngineer=null;state.missingTicket=null;state.cursor=null;state.zoom=1;state.ganttScroll={left:0,top:0};state.search='';$('search').value=''; }
function acceptInput(input) {
  if(state.destroyed)return;
  if(input.job_id !== state.expectedJob) { clearData();resetSelection();state.inputApplied=false;state.expectedJob=input.job_id;state.error=null; }
  state.input=input;state.inputApplied=false;render();
}
function acceptResult(result, meta) {
  if(state.destroyed)return;
  if(meta?.requestJobId && state.expectedJob && meta.requestJobId!==state.expectedJob)return;
  try {
    const envelope=readEnvelope(result,{
      expectedJobId:state.expectedJob || undefined,expectedVersionId:state.boundVersion || undefined,
      expectedToolName:bridge.getHostContext()?.toolInfo?.tool?.name,
      validateView:value=>validateSchema(value) && validateViewSemantics(value),
    });
    const model=envelope.engine_view ? buildViewModel(envelope.engine_view) : null;
    if(model?.invalidIdentity)throw Object.assign(new Error('MCP_UI_MODEL_INVALID'),{code:'MCP_UI_MODEL_INVALID',clearData:true});
    const changed=state.envelope?.job_id!==envelope.job_id;
    const previousCursor=state.cursor;
    pause();
    if(changed){disposeMap();resetSelection();}
    state.envelope=envelope;state.model=model;state.replay=model ? buildReplay(model) : null;
    state.expectedJob=envelope.job_id;state.boundVersion=envelope.image_version_id;state.error=null;state.stale=false;
    if(!state.inputApplied){state.view=envelope.view;state.engineerId=envelope.engineer_id;state.inputApplied=true;}
    if(state.engineerId && !model?.indexes.agents.has(state.engineerId)){
      if(changed){state.missingEngineer=state.engineerId;state.engineerId=null;tell('engineerNotFound');}
      else{state.engineerId=null;tell('invalidSelection');}
    }else state.missingEngineer=null;
    if(state.ticketId && (!model?.indexes.tickets.has(state.ticketId)||(state.engineerId&&model.indexes.tickets.get(state.ticketId)?.agent!==state.engineerId))){state.ticketId=null;tell('invalidSelection');}
    state.cursor=changed ? null : previousCursor;state.resultEpoch++;
    render();syncMap({refresh:true});
  }catch(error){handleError(error);}
}
function hostContext(context) {
  if(state.destroyed)return;
  const oldLocale=state.locale, oldMode=state.mode;
  state.locale=supportedLocale(context.locale);
  state.theme=context.theme==='dark'?'dark':'light';
  state.mode=context.displayMode==='fullscreen'?'fullscreen':'inline';
  if(oldMode==='fullscreen' && state.mode!=='fullscreen')pause();
  document.documentElement.lang=state.locale;document.documentElement.dataset.theme=state.theme;
  const colors={'--color-background-primary':'--surface','--color-background-secondary':'--surface-alt','--color-text-primary':'--ink','--color-text-secondary':'--muted','--color-border-primary':'--line'};
  for(const [host,local]of Object.entries(colors)){
    const value=context.styles?.variables?.[host];
    if(typeof value==='string' && CSS.supports('color',value))document.documentElement.style.setProperty(local,value);
    else document.documentElement.style.removeProperty(local);
  }
  render();
  if(oldLocale!==state.locale)syncMap({refresh:true,reload:true});else state.map?.resize();
}
const bridge=createViewerBridge({onInput:acceptInput,onResult:acceptResult,onHostContext:hostContext,onError:handleError,onTeardown:cleanup});

function localizeShell() {
  for(const [id,key]of Object.entries({refresh:'refresh', 'tab-map':'map','tab-gantt':'gantt','engineer-label':'engineer','sidebar-toggle':'objects','fit-map':'fit','side-agents':'agents','side-tickets':'tickets','search-label':'search','map-retry':'retryMap','playback-label':'playback','speed-label':'speed','footer':'footer'}))$(id).textContent=t(key);
  $('fullscreen').textContent=t(state.mode==='fullscreen'?'exitFullscreen':'fullscreen');$('search').placeholder=t('search');
  for(const [id,key]of Object.entries({'summary':'totals','gantt-in':'zoomIn','gantt-out':'zoomOut','map-canvas':'mapLabel','map-legend':'legend','gantt-scroll':'chartLabel','inline-detail':'selected','ordered-tickets':'tickets','playback':'playback','cursor':'time'}))$(id).setAttribute('aria-label',t(key));
  document.querySelector('.view-tabs').setAttribute('aria-label',t('resultView'));document.querySelector('.side-tabs').setAttribute('aria-label',t('objectType'));
}
function renderNotice() {
  const notice=$('notice');notice.hidden=!state.error && !state.refreshing;
  notice.dataset.error=String(Boolean(state.error));
  notice.textContent=state.refreshing?t('refreshing'):state.error?`${state.stale?t('stale')+' · ':''}${t(state.error)}`:'';
}
function platformDate(value) {
  if(typeof value!=='string' || !/(Z|[+-][0-9]{2}:[0-9]{2})$/.test(value))return label(value);
  const time=Date.parse(value);if(!Number.isFinite(time))return t('unknown');
  return new Date(time+8*3600000).toISOString().slice(0,19).replace('T',' ');
}
function renderSummary() {
  const fragment=document.createDocumentFragment();fragment.append(node('span',t('totals')));
  for(const [key,value]of [['schedules',state.model?.analysis.counts.engineer_schedule_count],['assigned',state.model?.analysis.counts.assigned_ticket_count],['unassigned',state.model?.analysis.counts.unassigned_ticket_count],['score',state.envelope?.task?.result_score]]){
    const row=node('span',t(key));row.append(node('strong',value===null||value===undefined?t('unknown'):value));fragment.append(row);
  }
  $('summary').replaceChildren(fragment);
}
function renderEngineerSelect() {
  const options=[new Option(state.missingEngineer?`${state.missingEngineer} · ${t('missingReference')}`:t('allEngineers'),'')];
  for(const agent of state.model?.agents || [])options.push(new Option(`${nameOf(agent)}${agent.date?' · '+agent.date:''}${agent.virtual===true?' · '+t('virtual'):''}`,agent.id));
  $('engineer').replaceChildren(...options);$('engineer').value=state.engineerId || '';
  $('engineer').disabled=!state.model?.agents || state.missingEngineer!=null;
}
function selectedAgent(){return state.model?.indexes.agents.get(state.engineerId);}
function selectedTicket(){return state.model?.indexes.tickets.get(state.ticketId);}
function ticketOrder(ticket) { const owner=state.model?.indexes.agents.get(ticket.agent);const index=owner?.tickets?.indexOf(ticket.id);return Number.isInteger(index)&&index>=0?index+1:null; }
function selectEngineer(id) {
  pause();state.missingEngineer=null;state.engineerId=id||null;state.ticketId=null;state.missingTicket=null;state.cursor=null;state.error=null;
  render();syncMap({refresh:true});state.map?.fit();
}
function selectTicket(id, ownerId=null) {
  const ticket=state.model?.indexes.tickets.get(id);
  if(!ticket){state.missingTicket=id;state.ticketId=null;if(ownerId)state.engineerId=ownerId;render();return;}
  state.missingTicket=null;state.ticketId=id;
  const agent=state.model.indexes.agents.get(ownerId || ticket.agent);
  if(agent && agent.virtual!==true)state.engineerId=agent.id;
  pause();state.cursor=null;render();syncMap({refresh:true});state.map?.focus(poiPosition(state.model.indexes.pois.get(ticket.loc)));
}
function swatch(id){const element=node('span',undefined,'swatch');element.style.setProperty('--agent-color',colorFor(id));element.setAttribute('aria-hidden','true');return element;}
function ticketRow(id,index,ownerId) {
  const ticket=state.model?.indexes.tickets.get(id),poi=ticket && state.model.indexes.pois.get(ticket.loc);
  const row=button('',()=>selectTicket(id,ownerId),'ticket-row');row.dataset.focusKey=`ticket:${ownerId || ''}:${id}`;
  row.setAttribute('aria-pressed',String(state.ticketId===id || state.missingTicket===id));
  row.append(node('span',index===null?'—':index+1,'number'));
  const copy=node('span',undefined,'row-copy');copy.append(node('span',id));
  copy.append(node('small',ticket ? `${poi?.name || t('none')} · ${label(ticket.start_service_time)} → ${label(ticket.departure_time)}` : t('missingReference')));
  row.append(copy);return row;
}
function renderOrdered() {
  const box=$('ordered-tickets'),agent=selectedAgent();box.hidden=state.mode==='fullscreen'||!agent;box.replaceChildren();
  if(!agent)return;
  if(agent.tickets===null){box.append(node('p',t('unknownAssignment'),'empty'));return;}
  if(!agent.tickets.length){box.append(node('p',t('noTickets'),'empty'));return;}
  for(const [index,id]of agent.tickets.entries())box.append(ticketRow(id,index,agent.id));
}
function renderDetails(container) {
  container.replaceChildren();
  const ticket=selectedTicket(),agent=selectedAgent();
  if(state.missingTicket){container.append(node('h2',state.missingTicket,'detail-heading'),node('p',t('missingReference'),'muted'));return;}
  if(!ticket&&!agent){container.append(node('p',t('choose'),'muted'));return;}
  container.append(node('h2',ticket?.id || nameOf(agent),'detail-heading'));const list=node('dl',undefined,'detail-grid');
  if(ticket){
    const poi=state.model.indexes.pois.get(ticket.loc),owner=state.model.indexes.agents.get(ticket.agent);
    pair(list,'owner',ticket.agent===null?t('unassigned'):owner?nameOf(owner):t('missingReference'));
    pair(list,'sequence',ticketOrder(ticket));pair(list,'status',ticket.status);pair(list,'type',ticket.type);
    pair(list,'arrival',ticket.arrival_time);pair(list,'start',ticket.start_service_time);pair(list,'departure',ticket.departure_time);pair(list,'duration',ticket.duration);
    pair(list,'location',poi?.name || (ticket.loc && !poi?t('missingReference'):null));pair(list,'address',poi?.address);
    if(!poiPosition(poi))pair(list,'location',t('noLocation'));
  }else{
    pair(list,'id',agent.id);pair(list,'date',agent.date);pair(list,'type',t(agent.virtual===false?'real':agent.virtual===true?'virtual':'unknownVirtual'));
    pair(list,'shift',agent.shift_start_time);pair(list,'assigned',agent.tickets?.length ?? null);
    const poi=state.model.indexes.pois.get(agent.start_loc);pair(list,'plannedOrigin',poi?.name || (agent.start_loc&&!poi?t('missingReference'):null));
    const analysis=state.model.analysis.engineers.find(item=>item.id===agent.id);
    if(analysis&&!analysis.replay_eligible)pair(list,'playback',analysis.reasons.map(t).join(' · '));
    if(Array.isArray(agent.routes)){
      const sources=agent.routes.map((route,index)=>{
        const text=!route?t('unavailableRoute'):route.route_source==='ESTIMATED'?t('estimated'):route.route_source==='CAR_FALLBACK'?t('fallback'):route.route_source==='ZERO_DISTANCE'?t('zeroDistance'):route.route_source || t('unknownSource');
        return `${index+1}. ${text}${index===agent.tickets?.length?' · '+t('returnLeg'):''}`;
      });pair(list,'routes',sources.join(' / '));
    }
  }
  container.append(list);
}
function renderSidebar() {
  const full=state.mode==='fullscreen',narrow=window.innerWidth<=700;
  $('sidebar').hidden=!full || (narrow&&!state.sidebarOpen);$('sidebar-toggle').hidden=!full||!narrow;$('sidebar-toggle').setAttribute('aria-expanded',String(full&&(!narrow||state.sidebarOpen)));
  for(const key of ['agents','tickets']){$(`side-${key}`).setAttribute('aria-selected',String(state.sidebar===key));$(`side-${key}`).tabIndex=state.sidebar===key?0:-1;}
  const box=$('side-list');box.setAttribute('aria-labelledby',`side-${state.sidebar}`);box.replaceChildren();const query=state.search.toLocaleLowerCase();
  if(!state.model){box.append(node('p',t('noResult'),'empty'));$('side-detail').replaceChildren();return;}
  if((state.sidebar==='agents'?state.model.agents:state.model.tickets)===null){box.append(node('p',t('unknownCollections'),'empty'));renderDetails($('side-detail'));return;}
  if(state.sidebar==='agents'){
    for(const agent of state.model.agents || []){
      if(query&&!`${agent.id} ${agent.name || ''}`.toLocaleLowerCase().includes(query))continue;
      const row=button('',()=>selectEngineer(agent.id),'ticket-row');row.dataset.focusKey=`agent:${agent.id}`;row.setAttribute('aria-pressed',String(agent.id===state.engineerId));row.append(swatch(agent.id));
      const copy=node('span',undefined,'row-copy');copy.append(node('span',nameOf(agent)),node('small',`${label(agent.date)} · ${t('tickets')} ${agent.tickets?.length ?? t('unknown')}`));
      const report=state.model.analysis.engineers.find(item=>item.id===agent.id);
      if(report&&!report.replay_eligible)copy.append(node('small',report.reasons.map(t).join(' · ')));
      row.append(copy);box.append(row);
    }
  }else{
    for(const ticket of state.model.tickets || []){
      if(state.engineerId && ticket.agent!==state.engineerId)continue;
      const poi=state.model.indexes.pois.get(ticket.loc);if(query&&!`${ticket.id} ${poi?.name || ''}`.toLocaleLowerCase().includes(query))continue;
      const order=ticketOrder(ticket);box.append(ticketRow(ticket.id,order===null?null:order-1,ticket.agent));
    }
  }
  if(!box.childNodes.length)box.append(node('p',t(query?'noMatch':state.sidebar==='tickets'&&state.engineerId?'noTickets':'empty'),'empty'));
  renderDetails($('side-detail'));
}
function ganttAgents() { if(state.missingEngineer)return [];return (state.model?.agents || []).filter(agent=>!state.engineerId||agent.id===state.engineerId); }
function renderGantt() {
  const chart=$('gantt-chart'),scroll=$('gantt-scroll');
  chart.replaceChildren();
  if(state.missingEngineer){chart.append(node('p',t('engineerNotFound'),'empty'));return;}
  if(!state.model){chart.append(node('p',state.envelope?t('noResult'):t('waiting'),'empty'));return;}
  const agents=ganttAgents(),times=[];
  for(const agent of agents){const shift=parsePlanTime(agent.shift_start_time);if(shift!==null&&agent.tickets?.length)times.push(shift);}
  for(const agent of agents)for(const id of agent.tickets || []){const ticket=state.model.indexes.tickets.get(id);if(ticket)for(const key of ['arrival_time','start_service_time','departure_time']){const time=parsePlanTime(ticket[key]);if(time!==null)times.push(time);}}
  if(!times.length){chart.append(node('p',t('noSchedule'),'empty'));for(const agent of agents)for(const [index,id]of(agent.tickets || []).entries())chart.append(ticketRow(id,index,agent.id));return;}
  const min=Math.min(...times),max=Math.max(...times),span=max-min;
  const grid=node('div',undefined,'gantt-grid');grid.style.width=`${Math.max(640,scroll.clientWidth)*state.zoom}px`;
  const head=node('div',undefined,'gantt-head');head.append(node('div',t('engineer'),'gantt-label'));const scale=node('div',undefined,'gantt-scale');
  for(let index=0;index<4;index++){const time=min+span*index/4;const tick=node('span',formatPlanTime(time).slice(5),'gantt-tick');tick.style.left=`${index*25}%`;scale.append(tick);}head.append(scale);grid.append(head);
  const percent=time=>span===0?50:Math.max(0,Math.min(100,100*(time-min)/span));
  function bar(track,ticket,agent,index,phase,start,end){
    const element=button(phase==='service'?`${index+1} · ${ticket.id}`:'',()=>selectTicket(ticket.id,agent.id),'gantt-bar');
    element.style.setProperty('--agent-color',colorFor(agent.id));element.style.left=`${percent(start)}%`;element.style.width=`${Math.max(0,percent(end)-percent(start))}%`;
    element.dataset.phase=phase;element.dataset.zero=String(end===start);element.dataset.focusKey=`gantt:${agent.id}:${ticket.id}:${phase}`;
    element.setAttribute('aria-label',`${index+1} · ${ticket.id} · ${t(phase==='waiting'?'waitingPhase':phase)} · ${formatPlanTime(start)} → ${formatPlanTime(end)}`);
    element.setAttribute('aria-pressed',String(state.ticketId===ticket.id));track.append(element);
  }
  for(const agent of agents){
    const row=node('div',undefined,'gantt-row'),name=node('div',undefined,'gantt-label'),select=button('',()=>selectEngineer(agent.id));select.dataset.focusKey=`gantt-agent:${agent.id}`;select.append(swatch(agent.id),node('span',nameOf(agent)));name.append(select,node('small',label(agent.date)));row.append(name);
    const track=node('div',undefined,'gantt-track');let previous=parsePlanTime(agent.shift_start_time),missing=[];
    const report=state.model.analysis.engineers.find(item=>item.id===agent.id);
    if(report?.reasons.includes('inconsistent_assignment'))missing.push(t('inconsistent_assignment'));
    if(agent.tickets===null)missing.push(t('unknownAssignment'));
    for(const [index,id]of(agent.tickets || []).entries()){
      const ticket=state.model.indexes.tickets.get(id);if(!ticket){missing.push(`${index+1} · ${id} · ${t('missingReference')}`);previous=null;continue;}
      const arrival=parsePlanTime(ticket.arrival_time),start=parsePlanTime(ticket.start_service_time),end=parsePlanTime(ticket.departure_time);
      const ordered=previous===null||arrival===null||arrival>=previous;
      if(!ordered||arrival!==null&&start!==null&&start<arrival)missing.push(`${index+1} · ${id} · ${t('non_monotonic_schedule')}`);
      if(arrival===null)missing.push(`${index+1} · ${id} · ${t('missingTime')}`);
      if(previous!==null&&arrival!==null&&arrival>previous)bar(track,ticket,agent,index,'travel',previous,arrival);
      if(ordered&&arrival!==null&&start!==null&&start>arrival)bar(track,ticket,agent,index,'waiting',arrival,start);
      if(start!==null&&end!==null&&end>=start)bar(track,ticket,agent,index,'service',start,end);
      else missing.push(`${index+1} · ${id} · ${t('missingTime')}`);
      previous=end;
    }
    if(missing.length){const info=node('div',undefined,'gantt-missing');info.style.position='relative';info.style.marginTop='52px';for(const value of missing)info.append(node('span',value,'metadata'));track.append(info);}
    if(Array.isArray(agent.tickets)&&!agent.tickets.length)track.append(node('span',t('noTickets'),'gantt-missing'));
    row.append(track);grid.append(row);
  }
  chart.append(grid);if(state.view==='gantt'){scroll.scrollLeft=state.ganttScroll.left;scroll.scrollTop=state.ganttScroll.top;}
}
function renderLegend(scene) {
  const box=$('map-legend');box.replaceChildren();
  const agents=(state.model?.agents || []).filter(agent=>agent.virtual!==true&&(!state.engineerId||state.engineerId===agent.id));
  for(const agent of agents){const element=button('',()=>selectEngineer(agent.id));element.append(swatch(agent.id),node('span',nameOf(agent)));element.setAttribute('aria-pressed',String(state.engineerId===agent.id));box.append(element);}
  if(scene?.warnings.length){const info=node('span',scene.warnings.map(t).join(' · '));info.style.cssText='background:#162535;color:#e2e8f0;padding:5px 8px;font-size:12px';box.append(info);}
}
function mapMessage() {
  if(state.missingEngineer)return t('engineerNotFound');
  if(!state.envelope)return t(state.error==='noHost'?'noHost':'waiting');
  if(!state.model)return `${t(state.envelope.result_state)} · ${t('noResult')}`;
  const keys={MAP_DISABLED:'mapDisabled',MAP_PROVIDER_MISMATCH:'mapMismatch',MAP_CONFIG:'mapFailed',MAP_NO_POINTS:'mapNoPoints',MAP_CSP_BLOCKED:'mapBlocked',MAP_LOAD_FAILED:'mapFailed',MAP_TIMEOUT:'mapFailed'};
  return state.mapError?t(keys[state.mapError] || 'mapFailed'):t('mapLoading');
}
function renderMapStatus() { $('map-state').hidden=state.mapReady;$('map-message').textContent=mapMessage();$('map-retry').hidden=!state.model||!state.mapError;$('fit-map').disabled=!state.mapReady; }
async function syncMap({refresh=false,reload=false}={}) {
  if(state.destroyed)return;
  if(!state.model||state.missingEngineer){disposeMap();renderMapStatus();return;}
  const scene=buildMapScene(state.model,{agentId:state.engineerId,ticketId:state.ticketId});renderLegend(scene);
  if(state.view!=='map')return;
  const context=state.envelope.map_context;
  const key=JSON.stringify([context,state.envelope.job_id,state.locale]);
  if(state.map && state.mapKey===key && !reload){if(refresh&&state.mapReady)state.map.update(scene);renderMapStatus();updatePlayback();return;}
  const viewport=state.map?.getViewport();disposeMap();
  state.mapKey=key;const epoch=state.mapEpoch;state.mapError=null;renderMapStatus();
  const map=new MapView($('map-canvas'),{onSelect:item=>item.kind==='agent'?selectEngineer(item.id):selectTicket(item.id),onFailure:error=>{if(epoch!==state.mapEpoch)return;state.mapError=error.code;state.mapReady=false;map.dispose();pause();renderMapStatus();updatePlayback();}});
  state.map=map;
  try {
    await map.mount(context,state.envelope.task.map_provider,scene,state.locale);
    if(state.destroyed||epoch!==state.mapEpoch){map.dispose();return;}
    if(!state.mapError){state.mapReady=true;map.update(buildMapScene(state.model,{agentId:state.engineerId,ticketId:state.ticketId}));if(viewport)map.setViewport(viewport);}
  }catch(error){
    if(epoch!==state.mapEpoch)return;
    state.mapError=error.code || 'MAP_LOAD_FAILED';state.mapReady=false;map.dispose();
  }
  renderMapStatus();updatePlayback();
}
function replayRange() {
  if(state.playbackRangeCache?.model===state.model&&state.playbackRangeCache.engineerId===state.engineerId&&state.playbackRangeCache.missingEngineer===state.missingEngineer)return state.playbackRangeCache.range;
  const agents=(state.model?.analysis.engineers || []).filter(agent=>agent.replay_eligible&&(!state.engineerId||agent.id===state.engineerId));
  const range=!agents.length||state.missingEngineer?{start:null,end:null,ids:[]}:{start:Math.min(...agents.map(agent=>parsePlanTime(agent.replay_start))),end:Math.max(...agents.map(agent=>parsePlanTime(agent.replay_end))),ids:agents.map(agent=>agent.id)};
  state.playbackRangeCache={model:state.model,engineerId:state.engineerId,missingEngineer:state.missingEngineer,range};return range;
}
function updatePlayback({labels=true}={}) {
  const range=replayRange();$('playback').hidden=state.mode!=='fullscreen'||state.view!=='map';
  $('play').textContent=t(state.playing?'pause':'play');$('play').setAttribute('aria-pressed',String(state.playing));
  const playable=range.start!==null && state.mapReady && !state.missingEngineer;
  $('play').disabled=!playable || range.end===range.start;$('cursor').disabled=!playable;
  $('playback-scope').textContent=range.ids.length?`${t('eligible')}: ${range.ids.length} / ${(state.model?.analysis.engineers || []).filter(a=>!state.engineerId||a.id===state.engineerId).length}`:t('notPlayable');
  if(range.start===null){$('playback-time').textContent='—';$('playback-states').replaceChildren();return;}
  state.cursor=Math.max(range.start,Math.min(range.end,state.cursor??range.start));
  $('cursor').value=range.end===range.start?'0':String(Math.round((state.cursor-range.start)/(range.end-range.start)*1000));
  $('cursor').setAttribute('aria-valuetext',formatPlanTime(state.cursor));$('playback-time').textContent=formatPlanTime(state.cursor);
  if(state.mode==='fullscreen'&&state.view==='map'&&state.mapReady){
    const positions=state.replay.at(state.cursor,range.ids);state.map.moveAgents(positions);
    if(labels){const box=$('playback-states');box.replaceChildren();for(const item of positions){const agent=state.model.indexes.agents.get(item.id);box.append(node('span',`${nameOf(agent)} · ${t(item.phase==='waiting'?'waitingPhase':item.phase)}${item.ticketId?' · '+item.ticketId:''}`));}}
  }
}
function pause(){state.playing=false;state.lastTick=null;cancelAnimationFrame(state.frame);state.frame=0;if($('play'))$('play').textContent=t('play');}
function frame(now) {
  if(!state.playing||state.destroyed)return;
  const range=replayRange();if(range.start===null||!state.mapReady){pause();updatePlayback();return;}
  if(state.lastTick!==null)state.cursor=Math.min(range.end,(state.cursor??range.start)+(now-state.lastTick)*state.speed);
  state.lastTick=now;updatePlayback({labels:now-state.lastLabels>=200});if(now-state.lastLabels>=200)state.lastLabels=now;
  if(state.cursor>=range.end){pause();updatePlayback();return;}
  state.frame=requestAnimationFrame(frame);
}
function togglePlay(){if(state.playing){pause();updatePlayback();return;}const range=replayRange();if(!state.mapReady||range.start===null||state.mode!=='fullscreen'||state.view!=='map')return;if(state.cursor>=range.end)state.cursor=range.start;state.playing=true;state.lastTick=null;updatePlayback();state.frame=requestAnimationFrame(frame);}
function render() {
  if(state.destroyed)return;const focus=rememberFocus();
  localizeShell();$('app').dataset.mode=state.mode;$('app').setAttribute('aria-busy',String(!state.envelope&&!state.error));
  $('task-title').textContent=state.envelope?.engine_view?.solver_job?.name || state.envelope?.job_id || t('waiting');
  $('task-meta').replaceChildren();
  if(state.envelope){const identity=node('span',`${state.envelope.job_id} · ${t(state.envelope.result_state)}`);identity.title=identity.textContent;$('task-meta').append(identity);
    const dates=['created','started','finished'].filter(key=>state.envelope.task[`${key}_at`]).map(key=>`${t(key)} ${platformDate(state.envelope.task[`${key}_at`])}`);
    if(dates.length){const datesLine=node('div',`${t('platformTime')} · ${dates.join(' · ')}`);datesLine.title=datesLine.textContent;$('task-meta').append(datesLine);}}
  $('refresh').disabled=!state.connected||!state.envelope||state.refreshing;
  const modes=bridge.getHostContext()?.availableDisplayModes || [];$('fullscreen').disabled=!state.connected||(!modes.includes('fullscreen')&&state.mode!=='fullscreen');
  $('map-panel').hidden=state.view!=='map';$('gantt-panel').hidden=state.view!=='gantt';$('gantt-tools').hidden=state.view!=='gantt';$('fit-map').hidden=state.view!=='map';
  for(const key of ['map','gantt']){$(`tab-${key}`).setAttribute('aria-selected',String(state.view===key));$(`tab-${key}`).tabIndex=state.view===key?0:-1;}
  renderNotice();renderSummary();renderEngineerSelect();renderSidebar();renderDetails($('inline-detail'));renderOrdered();renderGantt();renderMapStatus();updatePlayback();restoreFocus(focus);
}
function setView(view){if(state.view===view)return;if(state.view==='gantt')state.ganttScroll={left:$('gantt-scroll').scrollLeft,top:$('gantt-scroll').scrollTop};pause();state.view=view;render();syncMap({refresh:true});state.map?.resize();}
$('tab-map').addEventListener('click',()=>setView('map'));$('tab-gantt').addEventListener('click',()=>setView('gantt'));
function tabKeys(container,ids){container.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;const current=ids.indexOf(event.target.id);if(current<0)return;event.preventDefault();const index=event.key==='Home'?0:event.key==='End'?ids.length-1:(current+(event.key==='ArrowRight'?1:-1)+ids.length)%ids.length;$(ids[index]).click();$(ids[index]).focus();});}
tabKeys(document.querySelector('.view-tabs'),['tab-map','tab-gantt']);tabKeys(document.querySelector('.side-tabs'),['side-agents','side-tickets']);
$('gantt-scroll').addEventListener('scroll',()=>{if(state.view==='gantt')state.ganttScroll={left:$('gantt-scroll').scrollLeft,top:$('gantt-scroll').scrollTop};});
$('engineer').addEventListener('change',event=>selectEngineer(event.target.value));
$('refresh').addEventListener('click',async()=>{if(!state.envelope||state.refreshing)return;pause();state.refreshing=true;renderNotice();$('refresh').disabled=true;try{await bridge.refresh(state.envelope,{view:state.view,engineerId:state.engineerId});}finally{state.refreshing=false;if(!state.destroyed){renderNotice();$('refresh').disabled=!state.envelope;}}});
$('fullscreen').addEventListener('click',()=>bridge.requestDisplayMode(state.mode==='fullscreen'?'inline':'fullscreen'));
$('sidebar-toggle').addEventListener('click',()=>{state.sidebarOpen=!state.sidebarOpen;renderSidebar();if(state.sidebarOpen)$('search').focus();});
$('sidebar').addEventListener('keydown',event=>{if(event.key==='Escape'&&window.innerWidth<=700){event.preventDefault();state.sidebarOpen=false;renderSidebar();$('sidebar-toggle').focus();}});
for(const key of ['agents','tickets'])$(`side-${key}`).addEventListener('click',()=>{state.sidebar=key;renderSidebar();});
$('search').addEventListener('input',event=>{state.search=event.target.value;renderSidebar();});
$('fit-map').addEventListener('click',()=>state.map?.fit());$('map-retry').addEventListener('click',()=>syncMap({reload:true}));
$('gantt-in').addEventListener('click',()=>{state.zoom=Math.min(16,state.zoom*1.5);renderGantt();});$('gantt-out').addEventListener('click',()=>{state.zoom=Math.max(1,state.zoom/1.5);renderGantt();});
$('play').addEventListener('click',togglePlay);$('speed').addEventListener('change',event=>{state.speed=Number(event.target.value);});
$('cursor').addEventListener('input',event=>{pause();const range=replayRange();if(range.start===null)return;state.cursor=range.start+(range.end-range.start)*Number(event.target.value)/1000;updatePlayback();});
const visibility=()=>{if(document.hidden){pause();updatePlayback();}};
document.addEventListener('visibilitychange',visibility);
let resizeFrame=0;
const resizeObserver=new ResizeObserver(()=>{
  cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{if(state.destroyed)return;renderSidebar();state.map?.resize();bridge.reportSize({width:document.documentElement.clientWidth,height:$('app').getBoundingClientRect().height});});
});resizeObserver.observe($('app'));
const onResize=()=>{renderSidebar();if(state.view==='gantt')renderGantt();};window.addEventListener('resize',onResize);
function cleanup(){if(state.destroyed)return;state.destroyed=true;pause();disposeMap();resizeObserver.disconnect();cancelAnimationFrame(resizeFrame);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('resize',onResize);state.envelope=null;state.model=null;state.replay=null;state.playbackRangeCache=null;state.input=null;state.expectedJob=null;window.removeEventListener('pagehide',destroy);$('app').replaceChildren();}
function destroy(){cleanup();return bridge.destroy();}
window.addEventListener('pagehide',destroy,{once:true});
render();
if(window.parent===window){tell('noHost');render();}
else bridge.connect().then(connected=>{if(state.destroyed)return;state.connected=connected;render();if(connected)bridge.reportSize({width:document.documentElement.clientWidth,height:$('app').getBoundingClientRect().height});});
