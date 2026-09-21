import { startViewer } from './viewer.mjs';
import { buildViewModel, buildReplay, validateViewSemantics } from './model.mjs';
import { MapView, buildMapScene } from './maps.mjs';

startViewer({ kind:'map', buildModel:buildViewModel, buildReplay, validateSemantics:validateViewSemantics, mapApi:{ MapView, buildMapScene } });
