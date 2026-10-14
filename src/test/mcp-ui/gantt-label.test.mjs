import assert from 'node:assert/strict';
import test from 'node:test';
import { formatShiftRange } from '../../main/mcp-ui/gantt-label.mjs';

const agent = {
  date:'2026-10-20', shift_start_time:'2026-10-20 08:00:00',
  shift_off_time:'2026-10-20 17:00:00', tickets_done_time:'2026-10-20 14:32:00',
};

test('shift caption uses shift endpoints, not work completion; accessible text retains seconds', () => {
  const value = {...agent, shift_start_time:'2026-10-20 08:00:30'};
  const before = structuredClone(value);
  assert.deepEqual(formatShiftRange(value,'zh-CN'), {
    text:'08:00–17:00',
    accessibleLabel:'班次开始：2026-10-20 08:00:30；班次结束：2026-10-20 17:00:00',
  });
  assert.deepEqual(value,before);
});

test('next-day endpoints are explicit in both languages, including month rollover', () => {
  const value = {...agent, date:'2026-10-31', shift_start_time:'2026-10-31 08:00:00', shift_off_time:'2026-11-01 02:00:00'};
  assert.equal(formatShiftRange(value,'zh-CN').text,'08:00–次日02:00');
  assert.deepEqual(formatShiftRange(value,'en-US'), {
    text:'08:00–+1d 02:00',
    accessibleLabel:'Shift start: 2026-10-31 08:00:00; Shift end: 2026-11-01 02:00:00',
  });
});

test('other day differences retain actual dates rather than claiming next day', () => {
  assert.equal(formatShiftRange({...agent,shift_off_time:'2026-10-22 02:00:00'},'zh-CN').text,'08:00–2026-10-22 02:00');
  assert.equal(formatShiftRange({...agent,shift_start_time:'2026-10-19 22:00:00'},'zh-CN').text,'2026-10-19 22:00–17:00');
  assert.equal(formatShiftRange({...agent,shift_start_time:'2026-10-21 00:00:00',shift_off_time:'2026-10-21 06:00:00'},'zh-CN').text,'次日00:00–次日06:00');
});

test('missing endpoints stay unknown, even with a known completion time', () => {
  assert.equal(formatShiftRange({...agent,shift_off_time:null},'zh-CN').text,'08:00–—');
  assert.equal(formatShiftRange({...agent,shift_start_time:null},'zh-CN').text,'—–17:00');
  assert.deepEqual(formatShiftRange({...agent,shift_start_time:null,shift_off_time:null},'zh-CN'), {
    text:'—–—', accessibleLabel:'班次开始：未提供；班次结束：未提供',
  });
});

test('invalid endpoints are not sliced into plausible times', () => {
  for (const shift_off_time of ['2026-02-30 17:00:00','2026-10-20 24:00:00','2026-10-20T17:00:00Z','<script>17:00</script>']) {
    assert.equal(formatShiftRange({...agent,shift_off_time},'zh-CN').text,'08:00–—');
  }
});

test('unknown business date is not backfilled; known endpoints still define relative days', () => {
  assert.equal(formatShiftRange({...agent,date:null,shift_off_time:'2026-10-21 02:00:00'},'zh-CN').text,'08:00–次日02:00');
  assert.equal(formatShiftRange({...agent,date:null,shift_start_time:null},'zh-CN').text,'—–17:00');
});

test('zero-length and reversed same-day endpoints are not silently moved to tomorrow', () => {
  assert.equal(formatShiftRange({...agent,shift_off_time:agent.shift_start_time},'zh-CN').text,'08:00–08:00');
  assert.equal(formatShiftRange({...agent,shift_off_time:'2026-10-20 07:00:00'},'zh-CN').text,'08:00–07:00');
});

test('business clocks are identical across browser/host timezones', () => {
  const original = process.env.TZ;
  try {
    for (const timezone of ['UTC','America/Los_Angeles','Asia/Shanghai']) {
      process.env.TZ = timezone;
      assert.equal(formatShiftRange(agent,'zh-CN').text,'08:00–17:00');
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});
