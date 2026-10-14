import { parsePlanTime } from './model.mjs';
import { supportedLocale, translate } from './i18n.mjs';

/** Format business-clock shift fields only; never infer a shift from tickets. */
export function formatShiftRange(agent, locale) {
  const t = key => translate(locale,key);
  const start = parsePlanTime(agent.shift_start_time) === null ? null : agent.shift_start_time;
  const end = parsePlanTime(agent.shift_off_time) === null ? null : agent.shift_off_time;
  const businessDay = parsePlanTime(`${agent.date} 00:00:00`);
  const referenceDate = businessDay === null ? (start || end)?.slice(0,10) : agent.date;
  const referenceDay = parsePlanTime(`${referenceDate} 00:00:00`);
  const clock = value => {
    if (value === null) return '—';
    const date = value.slice(0,10), time = value.slice(11,16);
    if (date === referenceDate) return time;
    if (parsePlanTime(`${date} 00:00:00`) - referenceDay === 86400000) return `${t('nextDay')}${time}`;
    return `${date} ${time}`;
  };
  const colon = supportedLocale(locale) === 'en-US' ? ': ' : '：';
  const separator = supportedLocale(locale) === 'en-US' ? '; ' : '；';
  return {
    text:`${clock(start)}–${clock(end)}`,
    accessibleLabel:`${t('shift')}${colon}${start || t('none')}${separator}${t('shiftEnd')}${colon}${end || t('none')}`,
  };
}
