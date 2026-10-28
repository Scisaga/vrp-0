import { isModelIdentity } from './model.mjs';
/** Shared wire checks and Mercator math; no browser/network or raw-job access. */
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = isModelIdentity;
export const SVG_TOKEN = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
export const SNAPSHOT_ERRORS = Object.freeze([
  'MAP_SNAPSHOT_NOT_CONFIGURED','MAP_SNAPSHOT_NO_GEOMETRY','MAP_SNAPSHOT_INVALID_GEOMETRY',
  'MAP_SNAPSHOT_UPSTREAM_ERROR','MAP_SNAPSHOT_TOO_LARGE',
]);
export function projectSnapshot(position, projection) {
  if (!Array.isArray(position) || position.length !== 2 || !position.every(Number.isFinite)
      || Math.abs(position[0]) > 180 || Math.abs(position[1]) > 85.0511287798066) return null;
  const [longitude, latitude] = position;
  const wrapped = longitude + 360 * Math.round((projection.center_longitude - longitude) / 360);
  return [(wrapped / 360 + .5) * projection.world_size - projection.origin_x,
    (.5 - Math.log(Math.tan(Math.PI / 4 + latitude * Math.PI / 360)) / (2 * Math.PI)) * projection.world_size - projection.origin_y];
}
export function validSnapshot(snapshot) {
  if (!object(snapshot) || typeof snapshot.svg !== 'string' || !snapshot.svg.length
      || new TextEncoder().encode(snapshot.svg).length > 8 * 1024 * 1024 || snapshot.width !== 1024 || snapshot.height !== 768
      || typeof snapshot.attribution !== 'string' || !snapshot.attribution.trim()
      || snapshot.attribution.length > 2000 || !object(snapshot.projection) || !object(snapshot.elements)) return false;
  const projection = snapshot.projection;
  if (projection.kind !== 'web_mercator' || !['world_size','origin_x','origin_y','center_longitude'].every(key => Number.isFinite(projection[key]))
      || projection.world_size <= 0 || Math.abs(projection.center_longitude) > 180) return false;
  const elementIds = new Set(), agents = new Set(), tickets = new Set(), routes = new Set();
  const token = value => typeof value === 'string' && SVG_TOKEN.test(value) && !elementIds.has(value) && (elementIds.add(value), true);
  for (const key of ['agents','tickets','routes']) if (!Array.isArray(snapshot.elements[key])) return false;
  // Capacity guard only, not a business engineer/ticket count limit. Every
  // mapping requires at least one DOM element (two for an engineer).
  if (snapshot.elements.agents.length * 2 + snapshot.elements.tickets.length + snapshot.elements.routes.length > 100000) return false;
  for (const entry of snapshot.elements.agents) {
    if (!object(entry) || !id(entry.engineer_id) || agents.has(entry.engineer_id)
        || !token(entry.element_id) || !token(entry.playback_element_id)
        || !Number.isFinite(entry.x) || !Number.isFinite(entry.y)) return false;
    agents.add(entry.engineer_id);
  }
  for (const entry of snapshot.elements.tickets) {
    if (!object(entry) || !id(entry.ticket_id) || tickets.has(entry.ticket_id)
        || !(entry.engineer_id === null || id(entry.engineer_id)) || !token(entry.element_id)
        || !Number.isFinite(entry.x) || !Number.isFinite(entry.y)) return false;
    tickets.add(entry.ticket_id);
  }
  for (const entry of snapshot.elements.routes) {
    const key = JSON.stringify([entry?.engineer_id, entry?.route_index]);
    if (!object(entry) || !id(entry.engineer_id) || routes.has(key) || !token(entry.element_id)
        || !Number.isSafeInteger(entry.route_index) || entry.route_index < 0 || typeof entry.return_route !== 'boolean') return false;
    routes.add(key);
  }
  return true;
}
export function validSnapshotContext(context) {
  if (context.render_mode !== 'svg_snapshot_v1' || context.browser_key !== '' || context.js_url !== ''
      || context.css_url !== null || context.renderer_url !== '' || context.renderer_origin !== '') return false;
  return context.enabled === true
    ? context.error_code === null && validSnapshot(context.snapshot)
    : context.snapshot === null && (context.error_code === null || SNAPSHOT_ERRORS.includes(context.error_code));
}
