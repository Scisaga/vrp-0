import { parsePlanTime, formatPlanTime } from './model.mjs';
import { supportedLocale, translate } from './i18n.mjs';

/** Format business-clock shift fields only; never infer a shift from tickets. */
export function formatShiftRange(agent, locale) {
  const start = parsePlanTime(agent.shift_start_time) === null ? null : agent.shift_start_time;
  const end = parsePlanTime(agent.shift_off_time) === null ? null : agent.shift_off_time;
  return formatRange(agent,start,end,locale,['shift','shiftEnd']);
}

/** Original page range priority, using only the App's real, drawable stages. */
export function operatingRange(agent, ticketsIndex) {
  if (!Array.isArray(agent.tickets) || !agent.tickets.length) return null;
  const shiftStart = parsePlanTime(agent.shift_start_time);
  let previous = shiftStart, stageStart = null, stageEnd = null, earliestServiceStart = null;
  for (const id of agent.tickets) {
    const ticket = ticketsIndex?.get(id);
    if (!ticket) continue;
    const arrival = parsePlanTime(ticket.arrival_time);
    const service = parsePlanTime(ticket.start_service_time);
    const departure = parsePlanTime(ticket.departure_time);
    if (arrival === null || service === null || departure === null || service < arrival || departure < service) continue;
    const segmentStart = previous !== null && previous < arrival ? previous : arrival;
    stageStart = stageStart === null ? segmentStart : Math.min(stageStart,segmentStart);
    stageEnd = stageEnd === null ? departure : Math.max(stageEnd,departure);
    earliestServiceStart = earliestServiceStart === null ? service : Math.min(earliestServiceStart,service);
    previous = departure;
  }
  // A shift/completion timestamp alone is not evidence of an operating range.
  if (stageStart === null) return null;
  const start = earliestServiceStart !== null && shiftStart !== null && earliestServiceStart < shiftStart
    ? earliestServiceStart : (shiftStart ?? earliestServiceStart ?? stageStart);
  const end = parsePlanTime(agent.tickets_done_time) ?? stageEnd;
  const positiveRange = (first,last) => first !== null && last !== null && last > first ? {start:first,end:last} : null;
  // A zero-length real stage must not become an entire available shift.
  // Unlike the console, this App never estimates a missing/zero service end.
  return positiveRange(start,end) || positiveRange(stageStart,stageEnd);
}

export function formatOperatingRange(agent, ticketsIndex, locale) {
  const range = operatingRange(agent,ticketsIndex);
  if (!range) return {text:'-',accessibleLabel:translate(locale,'noOperatingRange')};
  return formatRange(agent,formatPlanTime(range.start),formatPlanTime(range.end),locale,['operatingStart','operatingEnd']);
}

function formatRange(agent, start, end, locale, keys) {
  const t = key => translate(locale,key);
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
    accessibleLabel:`${t(keys[0])}${colon}${start || t('none')}${separator}${t(keys[1])}${colon}${end || t('none')}`,
  };
}
