import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from '../../main/resources/META-INF/resources/static/node_modules/esbuild/lib/main.js';
import { formatOperatingRange, operatingRange } from '../../main/mcp-ui/gantt-label.mjs';
import { formatPlanTime } from '../../main/mcp-ui/model.mjs';

const agent = {
  id:'engineer', date:'2026-10-20', tickets:['ticket'],
  shift_start_time:'2026-10-20 08:00:00', shift_off_time:'2026-10-20 18:00:00',
  tickets_done_time:'2026-10-20 14:32:00',
};
const ticket = {
  id:'ticket', arrival_time:'2026-10-20 08:15:00',
  start_service_time:'2026-10-20 08:30:00', departure_time:'2026-10-20 09:00:00',
};
const index = value => new Map([[value.id,value]]);
const caption = (value=agent, stage=ticket, locale='zh-CN') => formatOperatingRange(value,index(stage),locale);

test('equal shifts with different solver completion times have different execution captions', () => {
  assert.deepEqual(caption(),{
    text:'08:00–14:32', accessibleLabel:'计划执行开始：2026-10-20 08:00:00；计划执行结束：2026-10-20 14:32:00',
  });
  assert.equal(caption({...agent,tickets_done_time:'2026-10-20 12:15:00'}).text,'08:00–12:15');
  assert.equal(caption({...agent,shift_off_time:'2026-10-20 20:00:00'}).text,'08:00–14:32');
});

test('missing or invalid completion falls back to the last real stage, not shift end', () => {
  for (const tickets_done_time of [null,'2026-02-30 14:32:00','2026-10-20 24:00:00','2026-10-20T14:32:00Z']) {
    assert.equal(caption({...agent,tickets_done_time}).text,'08:00–09:00');
  }
  assert.equal(caption({...agent,tickets_done_time:'2026-10-20 07:00:00'}).text,'08:00–09:00');
});

test('earlier service moves the start before the shift, and missing shift start uses real service start', () => {
  assert.equal(caption({...agent,shift_start_time:'2026-10-20 10:00:00'}).text,'08:30–14:32');
  assert.equal(caption({...agent,shift_start_time:null}).text,'08:30–14:32');
});

test('no assigned tickets, unknown assignments or no real stages do not display an available shift', () => {
  for (const tickets of [[],null,['missing']]) {
    assert.equal(caption({...agent,tickets}).text,'-');
  }
  for (const key of ['arrival_time','start_service_time','departure_time']) {
    assert.equal(caption(agent,{...ticket,[key]:null,duration:'PT30M'}).text,'-');
  }
  assert.equal(caption(agent,{...ticket,start_service_time:'2026-10-20 08:00:00'}).text,'-');
  assert.equal(caption(agent,{...ticket,departure_time:'2026-10-20 08:20:00'}).text,'-');
  assert.equal(caption({...agent,tickets:[]}).accessibleLabel,'暂无有效计划执行时段');
});

test('range handles multiple stages in assignment order without extending to shift end', () => {
  const second={...ticket,id:'second',arrival_time:'2026-10-20 11:00:00',start_service_time:'2026-10-20 11:10:00',departure_time:'2026-10-20 12:05:00'};
  const value={...agent,tickets:['ticket','second'],tickets_done_time:null};
  assert.equal(formatOperatingRange(value,new Map([['ticket',ticket],['second',second]]),'zh-CN').text,'08:00–12:05');
  const snapshot=structuredClone(value);
  operatingRange(value,index(ticket));
  assert.deepEqual(value,snapshot);
});

test('next-day and multi-day solver completion remain explicit; accessible names keep full times', () => {
  const value={...agent,date:'2026-10-31',shift_start_time:'2026-10-31 08:00:30',tickets_done_time:'2026-11-01 02:00:00'};
  const stage=Object.fromEntries(Object.entries(ticket).map(([key,value])=>[key,typeof value==='string'?value.replace('2026-10-20','2026-10-31'):value]));
  assert.equal(caption(value,stage).text,'08:00–次日02:00');
  assert.deepEqual(caption(value,stage,'en-US'),{
    text:'08:00–+1d 02:00',accessibleLabel:'Planned execution start: 2026-10-31 08:00:30; Planned execution end: 2026-11-01 02:00:00',
  });
  assert.equal(caption({...agent,tickets_done_time:'2026-10-22 03:00:00'}).text,'08:00–2026-10-22 03:00');
  assert.equal(caption({...agent,date:null,tickets_done_time:'2026-10-21 02:00:00'}).text,'08:00–次日02:00');
});

test('zero-length real stages never turn into an entire shift or an estimated duration', () => {
  const zero={...ticket,arrival_time:agent.shift_start_time,start_service_time:agent.shift_start_time,departure_time:agent.shift_start_time};
  const value={...agent,tickets_done_time:agent.shift_start_time};
  assert.equal(caption(value,zero).text,'-');
  assert.equal(caption({...value,shift_off_time:null},zero).text,'-');
});

test('execution caption stays timezone neutral', () => {
  const original=process.env.TZ;
  try {
    for (const timezone of ['UTC','America/Los_Angeles','Asia/Shanghai']) {
      process.env.TZ=timezone;
      assert.equal(caption().text,'08:00–14:32');
    }
  } finally {
    if (original===undefined) delete process.env.TZ;
    else process.env.TZ=original;
  }
});

test('real-time ranges match original page Gantt priority without importing its controller into the App', async () => {
  const result=await build({entryPoints:[new URL('../../main/resources/META-INF/resources/static/assets/js/pages/solver-job-detail-page.js',import.meta.url).pathname],bundle:true,format:'cjs',platform:'node',write:false});
  const module={exports:{}};
  new Function('module','exports',result.outputFiles[0].text)(module,module.exports);
  const original=process.env.TZ;
  try {
    process.env.TZ='UTC';
    for (const patch of [{},{tickets_done_time:null},{shift_start_time:null},{shift_start_time:'2026-10-20 10:00:00'},{tickets_done_time:'2026-10-20 07:00:00'},{tickets_done_time:'2026-10-21 02:00:00'}]) {
      const value={...agent,...patch};
      const range=operatingRange(value,index(ticket));
      const expected=`${formatPlanTime(range.start).slice(11,16)} → ${formatPlanTime(range.end).slice(11,16)}`;
      const row=module.exports.buildSolverJobGanttView({start_date_time:'2026-10-20 08:00:00',end_date_time:'2026-10-20 18:00:00',plan:{agents:[{...value,tickets:[{...ticket,min_start_time:ticket.start_service_time,max_end_time:ticket.departure_time}]}]}}).rows[0];
      assert.equal(row.operatingRangeLabel,expected);
    }
  } finally {
    if (original===undefined) delete process.env.TZ;
    else process.env.TZ=original;
  }
});
