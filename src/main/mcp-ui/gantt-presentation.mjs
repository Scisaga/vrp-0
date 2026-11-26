import { formatPlanTime } from './model.mjs';
import { translate } from './i18n.mjs';

const clean = value => typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : '';
const streetAddress = /^\d+[A-Za-z]?(?:[-/]\d+[A-Za-z]?)?\s+[\p{L}][\p{L}\d .’'()-]*\b(?:Rd|Road|St|Street|Ave|Avenue|Dr|Drive|Way|Ln|Lane|Hwy|Highway|Pl|Place|Tce|Terrace|Cres|Crescent|Blvd|Boulevard|Ct|Court|Close|Square)(?:\s+(?:North|South|East|West|N|S|E|W))?$/iu;
const namedPlace = /\b(?:Library|Hospital|Clinic|School|Museum|University|Airport|Station|Shopping Centre|Shopping Center)$/iu;
const unitOrFloor = /\b(?:unit|suite|apartment|apt|flat|room|floor|level|building|block)\b|#\s*\d|\d+(?:st|nd|rd|th)\s+fl\b|[栋楼室层]/iu;

/** Display only: never guess an unfamiliar address or change the source POI. */
export function shortLocation(poi, {usePlaceName = false} = {}) {
  const address = clean(poi?.address), name = clean(poi?.name);
  if (!address) return name;
  const parts = address.split(/[,，]/u).map(clean).filter(Boolean);
  if (unitOrFloor.test(address)) return address;
  if (parts.length > 1 && streetAddress.test(parts[0]) && !parts.slice(1).some(part => streetAddress.test(part))) return parts[0];
  if (parts.length > 2 && namedPlace.test(parts[0]) && streetAddress.test(parts[1]) && !parts.slice(2).some(part => streetAddress.test(part))) return parts[0];
  return (usePlaceName && name) || address;
}

const streetSuffixes = {street:'St', road:'Rd', lane:'Ln', drive:'Dr', avenue:'Ave'};

/** Keep each band at its true width and reserve three pixels either side of its text. */
export function fitBandLabel(location, width, measure) {
  if (width < 62) return '';
  if (measure(location) + 6 <= width) return location;
  const shorter = location.replace(/\b(street|road|lane|drive|avenue)$/i, suffix => streetSuffixes[suffix.toLowerCase()]);
  return shorter !== location && measure(shorter) + 6 <= width ? shorter : '';
}

/** Durations come from actual stage endpoints, never the estimated duration field. */
export function ganttDuration(milliseconds, locale, compact = false) {
  const t = key => translate(locale, key);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return t('none');
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60), seconds = totalSeconds % 60;
  const en = locale === 'en-US';
  if (!compact) {
    const parts = [];
    if (minutes || !seconds) parts.push(`${minutes} ${en && minutes === 1 ? 'minute' : t('minutes')}`);
    if (seconds) parts.push(`${seconds} ${en && seconds === 1 ? 'second' : t('seconds')}`);
    return parts.join(' ');
  }
  // Compact annotations use minute precision; exact seconds remain in aria/title.
  if (totalSeconds > 0 && totalSeconds < 60) return en ? '<1m' : '<1分';
  const roundedMinutes = Math.round(totalSeconds / 60);
  const hours = Math.floor(roundedMinutes / 60), remaining = roundedMinutes % 60, parts = [];
  if (hours) parts.push(`${hours}${en ? 'h' : '小时'}`);
  if (remaining || !hours) parts.push(`${remaining}${en ? 'm' : '分'}`);
  return parts.join(en ? ' ' : '');
}

function clockLabel(timestamp) {
  return timestamp.slice(17) === '00' ? timestamp.slice(11, 16) : timestamp.slice(11);
}

export function stageTimeRange(start, end, businessDate) {
  const endpoint = time => {
    const full = formatPlanTime(time), date = full.slice(0, 10);
    return date === businessDate ? clockLabel(full) : `${date} ${clockLabel(full)}`;
  };
  return `${endpoint(start)}–${endpoint(end)}`;
}

/** Keep real bounds and reserve room for the two inward-facing endpoint labels. */
export function ganttTicks(min, max, plotWidth = Infinity) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return [];
  const span = max - min;
  const intervals = Math.max(2, Math.min(11, Math.floor(plotWidth / 72)));
  const steps = [1, 5, 15, 30, 60, 120, 180, 360, 720, 1440].map(minutes => minutes * 60000);
  const step = steps.find(value => span / value <= intervals) || Math.ceil(span / intervals / 86400000) * 86400000;
  const edgeGap = Math.max(step * .65, 76 * span / plotWidth);
  const values = [min];
  for (let time = Math.ceil(min / step) * step; time < max; time += step) {
    if (time - min >= edgeGap && max - time >= edgeGap) values.push(time);
  }
  if (max > min) values.push(max);
  return values.map(time => {
    const full = formatPlanTime(time);
    return {time, full, text:clockLabel(full)};
  });
}
