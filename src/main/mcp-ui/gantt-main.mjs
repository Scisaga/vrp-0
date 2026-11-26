import { startViewer } from './viewer.mjs';
import { buildGanttViewModel, validateGanttSemantics } from './model.mjs';
import { createGanttInteractions } from './gantt-interactions.mjs';

startViewer({ kind:'gantt', buildModel:buildGanttViewModel, validateSemantics:validateGanttSemantics, createGanttInteractions });
