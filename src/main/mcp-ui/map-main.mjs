import { startViewer } from './viewer.mjs';
import { buildViewModel, buildReplay, validateViewSemantics } from './model.mjs';
import { buildMapScene } from './map-scene.mjs';
import { SvgMapView } from './svg-map.mjs';

startViewer({ kind:'map', buildModel:buildViewModel, buildReplay, validateSemantics:validateViewSemantics, mapApi:{ MapView:SvgMapView, buildMapScene } });
