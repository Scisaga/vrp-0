import { startViewer } from './viewer.mjs';
import { buildViewModel, buildReplay, validateViewSemantics } from './model.mjs';
import { buildMapScene } from './map-scene.mjs';
import { SvgMapView } from './svg-map.mjs';
import { createEngineerPicker } from './engineer-picker.mjs';

startViewer({ kind:'map', buildModel:buildViewModel, buildReplay, validateSemantics:validateViewSemantics, createEngineerPicker, mapApi:{ MapView:SvgMapView, buildMapScene } });
