import { startViewer } from './viewer.mjs';
import { buildGanttViewModel, validateGanttSemantics } from './model.mjs';

startViewer({ kind:'gantt', buildModel:buildGanttViewModel, validateSemantics:validateGanttSemantics });
