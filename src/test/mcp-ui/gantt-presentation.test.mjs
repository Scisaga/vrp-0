import test from 'node:test';
import assert from 'node:assert/strict';
import { shortLocation, ganttDuration, ganttTicks } from '../../main/mcp-ui/gantt-presentation.mjs';
import { parsePlanTime } from '../../main/mcp-ui/model.mjs';

const cases = [
  ['55 Lincoln Rd, Henderson, Auckland 0610', '55 Lincoln Rd'],
  ['  12A  Example Street, City  ', '12A Example Street'],
  ['4/18 Sample Avenue, City', '4/18 Sample Avenue'],
  ['2-4 Example Road North，City', '2-4 Example Road North'],
  ['Example Library, 18 Sample Rd, City', 'Example Library'],
  ['Example Library, 18 Sample Rd', 'Example Library, 18 Sample Rd'],
  ['Shop Alpha, 18 Sample Rd, City', 'Shop Alpha, 18 Sample Rd, City'],
  ['Unit 2, 18 Sample Rd, City', 'Unit 2, 18 Sample Rd, City'],
  ['18 Sample Rd, Level 3, City', '18 Sample Rd, Level 3, City'],
  ['18 Sample Rd, Suite 2, City', '18 Sample Rd, Suite 2, City'],
  ['18 Sample Rd, 22 Other Rd, City', '18 Sample Rd, 22 Other Rd, City'],
  ['测试市示例路 12 号 3 楼', '测试市示例路 12 号 3 楼'],
  ['City, District, Example', 'City, District, Example'],
  ['<img src=x onerror=alert(1)>', '<img src=x onerror=alert(1)>'],
  ['18 Sample Rd', '18 Sample Rd'],
];
for (const [address, expected] of cases) test(`short location preserves meaning: ${address}`, () => {
  const poi = Object.freeze({address, name:'Name should not replace an address'});
  assert.equal(shortLocation(poi), expected);
  assert.equal(poi.address,address);
});
test('missing addresses fall back to the existing name, never IDs or invented locations', () => {
  assert.equal(shortLocation({address:'  ',name:'  Example  Clinic '}),'Example Clinic');
  for(const poi of [null,{}, {address:null,name:null}, {address:' ',name:' ',id:'poi-1'}]) assert.equal(shortLocation(poi),'');
});
test('durations retain short segments, seconds and real zero values in both languages', () => {
  for(const [ms,zh,en] of [[0,'0 分钟','0 minutes'],[30000,'30 秒','30 seconds'],[90000,'1 分钟 30 秒','1 minute 30 seconds'],[5400000,'90 分钟','90 minutes']]){
    assert.equal(ganttDuration(ms,'zh-CN'),zh);assert.equal(ganttDuration(ms,'en-US'),en);
  }
  assert.equal(ganttDuration(60000,'zh-CN',true),'1分');
  assert.equal(ganttDuration(8280000,'zh-CN',true),'2小时18分');
  assert.equal(ganttDuration(8280000,'en-US',true),'2h 18m');
  assert.equal(ganttDuration(30000,'en-US',true),'<1m');
  assert.equal(ganttDuration(167000,'zh-CN',true),'3分');
  assert.equal(ganttDuration(30000,'zh-CN',true),'<1分');
  assert.equal(ganttDuration(-1,'zh-CN'),'未提供');
  assert.equal(ganttDuration(NaN,'en-US'),'Not provided');
});
test('business ticks keep real endpoints, regular interior spacing and full cross-day times', () => {
  const start=parsePlanTime('2026-09-17 21:03:12'),end=parsePlanTime('2026-09-18 07:51:00');
  const ticks=ganttTicks(start,end);
  assert.equal(ticks[0].time,start);assert.equal(ticks.at(-1).time,end);
  assert.equal(ticks[0].text,'21:03:12');assert.equal(ticks.at(-1).text,'07:51');
  assert.equal(ticks.at(-1).full,'2026-09-18 07:51:00');
  assert.ok(ticks.length<=13);
  for(const tick of ticks.slice(1,-1))assert.equal(tick.time%3600000,0);
  assert.equal(ganttTicks(start,start).length,1);
  assert.deepEqual(ganttTicks(end,start),[]);
  assert.deepEqual(ganttTicks(null,end),[]);
  assert.ok(ganttTicks(start,end+400*86400000).length<=13);
});
