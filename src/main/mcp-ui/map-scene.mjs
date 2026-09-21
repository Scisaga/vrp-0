import { poiPosition, routePosition } from './model.mjs';
import { colorFor } from './palette.mjs';
export { colorFor } from './palette.mjs';

const ROAD = new Set(['AMAP_TRUCK','AMAP_DRIVING','AMAP_BICYCLE','HERE_TRUCK','HERE_DRIVING','HERE_BICYCLE','CAR_FALLBACK']);

/** Build the minimal map-only projection sent to the isolated renderer. */
export function buildMapScene(model, { agentId = null, ticketId = null } = {}) {
  const markers = [], lines = [], warnings = new Set(), ticketSeen = new Set();
  const agents = (model.agents || []).filter(agent => (!agentId || agent.id === agentId) && agent.virtual !== true);
  for (const agent of agents) {
    if (model.analysis.engineers.find(report => report.id === agent.id)?.reasons.includes('inconsistent_assignment')) warnings.add('inconsistent_assignment');
    const color = colorFor(agent.id), start = poiPosition(model.indexes.pois.get(agent.start_loc));
    if (start) markers.push({ key:`agent:${agent.id}`, id:agent.id, kind:'agent', position:start, color, label:agent.name || agent.id, selected:agentId === agent.id });
    else warnings.add('partialMap');
    if (!Array.isArray(agent.tickets)) warnings.add('unknownAssignment');
    for (const [index, id] of (agent.tickets || []).entries()) {
      const ticket = model.indexes.tickets.get(id), position = ticket && poiPosition(model.indexes.pois.get(ticket.loc));
      if (!ticket || !position) { warnings.add('partialMap'); continue; }
      if (ticketSeen.has(id)) { warnings.add('partialMap'); continue; }
      ticketSeen.add(id);
      markers.push({ key:`ticket:${id}`, id, kind:'ticket', position, color, label:String(index + 1), title:`${agent.name || agent.id} · ${index + 1} · ${id}`, selected:ticketId === id });
    }
    if (!Array.isArray(agent.routes)) warnings.add('partialMap');
    for (const [index, route] of (agent.routes || []).entries()) {
      if (!route) { warnings.add('unavailableRoute'); continue; }
      if (route.route_source === 'ESTIMATED') { warnings.add('estimated'); continue; }
      if (route.route_source === 'ZERO_DISTANCE') continue;
      if (!ROAD.has(route.route_source)) { warnings.add('unknownSource'); continue; }
      const positions = Array.isArray(route.polyline) ? route.polyline.map(routePosition) : null;
      if (!positions || positions.length < 2 || positions.some(point => !point)) { warnings.add('unavailableRoute'); continue; }
      if (route.route_source === 'CAR_FALLBACK') warnings.add('fallback');
      lines.push({ key:`${agent.id}:${index}`, agentId:agent.id, positions, color, returnLeg:Array.isArray(agent.tickets) && agent.routes.length === agent.tickets.length + 1 && index === agent.tickets.length });
    }
  }
  if (!agentId) for (const ticket of model.tickets || []) {
    if (ticketSeen.has(ticket.id)) continue;
    const position = poiPosition(model.indexes.pois.get(ticket.loc));
    if (position) markers.push({ key:`ticket:${ticket.id}`, id:ticket.id, kind:'ticket', position, color:'#475569', label:'?', title:ticket.id, selected:ticketId === ticket.id });
    else warnings.add('partialMap');
  }
  return { markers, lines, warnings:[...warnings] };
}
