export const MAP_ERROR_CODES = Object.freeze([
  'MAP_DISABLED', 'MAP_PROVIDER_MISMATCH', 'MAP_CONFIG', 'MAP_NO_POINTS',
  'MAP_CSP_BLOCKED', 'MAP_LOAD_FAILED', 'MAP_TIMEOUT', 'MAP_RESIZE_FAILED', 'MAP_ABORTED',
  'RENDERER_IFRAME_LOAD_FAILED', 'RENDERER_CHANNEL_FAILED',
  'AMAP_SCRIPT_LOAD_FAILED', 'AMAP_SDK_MISSING', 'AMAP_MAP_CREATE_FAILED',
  'AMAP_READY_FAILED', 'AMAP_OVERLAY_FAILED', 'AMAP_FIT_FAILED'
]);

export const MAP_DIAGNOSTIC_STAGES = Object.freeze([
  'renderer_iframe_created', 'renderer_document_loaded', 'renderer_channel_connected',
  'amap_script_loaded', 'amap_sdk_ready', 'amap_map_created', 'amap_ready',
  'amap_overlays_added', 'amap_fit_complete', 'amap_resize'
]);

const ERROR_CODES = new Set(MAP_ERROR_CODES);
const STAGES = new Set(MAP_DIAGNOSTIC_STAGES);

export const safeMapErrorCode = (value, fallback = 'MAP_LOAD_FAILED') =>
  ERROR_CODES.has(value) ? value : fallback;

export const safeMapDiagnosticStage = value => STAGES.has(value) ? value : null;

export function mapDiagnosticError(code, lastSuccessfulStage = null, failureStage = null) {
  const safeCode = safeMapErrorCode(code);
  return Object.assign(new Error(safeCode), {
    code:safeCode,
    lastSuccessfulStage:safeMapDiagnosticStage(lastSuccessfulStage),
    failureStage:safeMapDiagnosticStage(failureStage)
  });
}

export function normalizeMapDiagnosticError(error, fallback, lastSuccessfulStage = null, failureStage = null) {
  return mapDiagnosticError(
    safeMapErrorCode(error?.code, fallback),
    safeMapDiagnosticStage(error?.lastSuccessfulStage) || lastSuccessfulStage,
    safeMapDiagnosticStage(error?.failureStage) || failureStage
  );
}
