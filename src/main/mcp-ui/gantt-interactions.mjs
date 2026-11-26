/** The inline time ruler and service hints share the existing chart's focus and scroll surface. */
export function createGanttInteractions(chart, scroll, tooltip) {
  const events = new AbortController();
  const options = {signal:events.signal};
  const tickAt = el => el?.closest?.('button.gantt-tick');
  const pinnedTick = () => chart.querySelector('.gantt-tick[aria-pressed="true"]');
  let hintedBar = null;

  function showGuide(tick) {
    const grid = chart.querySelector('.gantt-grid');
    if (!grid) return;
    grid.toggleAttribute('data-time-guide', Boolean(tick));
    if (tick) grid.style.setProperty('--gantt-guide-position', tick.style.left);
  }

  function hideHint() {
    if (!hintedBar) return;
    hintedBar = null;
    tooltip.hidden = true;
    tooltip.replaceChildren();
  }

  function showHint(bar) {
    if (!bar || bar.getAttribute('aria-pressed') === 'true') {
      hideHint();
      return;
    }
    if (hintedBar === bar) return;
    hintedBar = bar;
    const range = document.createElement('span');
    range.textContent = bar.dataset.serviceTime;
    tooltip.replaceChildren(document.createTextNode(bar.dataset.serviceAddress), range);
    tooltip.hidden = false;
    const bounds = bar.getBoundingClientRect();
    const anchor = (bounds.left + bounds.right - tooltip.offsetWidth) / 2;
    const left = Math.min(anchor, document.documentElement.clientWidth - tooltip.offsetWidth - 4);
    const above = bounds.top - tooltip.offsetHeight;
    const top = above >= 4 ? above : Math.min(bounds.bottom, document.documentElement.clientHeight - tooltip.offsetHeight - 4);
    tooltip.style.left = Math.max(4, left) + 'px';
    tooltip.style.top = Math.max(4, top) + 'px';
  }

  function highlight(target) {
    showGuide(tickAt(target) || pinnedTick());
    if (!tooltip.contains(target)) showHint(target?.closest?.('[data-service-time]'));
  }

  chart.addEventListener('pointerover', event => {
    if (event.pointerType === 'mouse') highlight(event.target);
  }, options);
  chart.addEventListener('pointerleave', event => {
    if (!tooltip.contains(event.relatedTarget)) highlight(null);
  }, options);
  tooltip.addEventListener('pointerleave', event => {
    if (!hintedBar?.contains(event.relatedTarget)) hideHint();
  }, options);
  chart.addEventListener('focusin', event => {
    if (event.target.matches(':focus-visible')) highlight(event.target);
  }, options);
  chart.addEventListener('focusout', event => {
    hideHint();
    showGuide(tickAt(event.relatedTarget) || pinnedTick());
  }, options);
  chart.addEventListener('pointerdown', hideHint, options);
  chart.addEventListener('click', event => {
    const tick = tickAt(event.target), previous = pinnedTick();
    previous?.setAttribute('aria-pressed', 'false');
    const next = tick === previous ? null : tick;
    next?.setAttribute('aria-pressed', 'true');
    showGuide(next);
  }, options);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      hideHint();
      pinnedTick()?.setAttribute('aria-pressed', 'false');
      showGuide(null);
    }
  }, options);
  scroll.addEventListener('scroll', () => {
    hideHint();
    scroll.toggleAttribute('data-panned', scroll.scrollLeft > 1);
  }, {...options, passive:true});

  return {hideHint, showGuide, destroy() { events.abort(); hideHint(); }};
}
