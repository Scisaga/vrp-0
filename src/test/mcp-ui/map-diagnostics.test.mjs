import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAP_DIAGNOSTIC_STAGES, MAP_ERROR_CODES, mapDiagnosticError,
  normalizeMapDiagnosticError, safeMapDiagnosticStage, safeMapErrorCode
} from '../../main/mcp-ui/map-diagnostics.mjs';

test('map diagnostic enums accept only fixed safe values', () => {
  assert.equal(safeMapErrorCode('AMAP_OVERLAY_FAILED'), 'AMAP_OVERLAY_FAILED');
  assert.equal(safeMapErrorCode('https://secret.invalid/?key=raw'), 'MAP_LOAD_FAILED');
  assert.equal(safeMapDiagnosticStage('amap_map_created'), 'amap_map_created');
  assert.equal(safeMapDiagnosticStage('raw stage with task data'), null);
  assert.equal(new Set(MAP_ERROR_CODES).size, MAP_ERROR_CODES.length);
  assert.equal(new Set(MAP_DIAGNOSTIC_STAGES).size, MAP_DIAGNOSTIC_STAGES.length);
});

test('diagnostic errors discard raw exception messages and unknown metadata', () => {
  const raw = Object.assign(new Error('https://secret.invalid/?key=never-cross-the-port'), {
    code:'RAW_VENDOR_FAILURE', lastSuccessfulStage:'job-123', failureStage:'raw-url'
  });
  const error = normalizeMapDiagnosticError(raw, 'AMAP_MAP_CREATE_FAILED', 'amap_sdk_ready', 'amap_map_created');
  assert.deepEqual({
    message:error.message, code:error.code,
    lastSuccessfulStage:error.lastSuccessfulStage, failureStage:error.failureStage
  }, {
    message:'AMAP_MAP_CREATE_FAILED', code:'AMAP_MAP_CREATE_FAILED',
    lastSuccessfulStage:'amap_sdk_ready', failureStage:'amap_map_created'
  });
  assert.doesNotMatch(JSON.stringify(error), /secret|key|job-123|raw-url/);
  assert.equal(mapDiagnosticError('AMAP_FIT_FAILED', 'amap_overlays_added').message, 'AMAP_FIT_FAILED');
});
