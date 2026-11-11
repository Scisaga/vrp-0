import { colorFor } from './palette.mjs';

// Select-only combobox: focus remains on the trigger while the list is open.
// Keyboard behavior follows the WAI APG select-only combobox pattern.
export function createEngineerPicker({ trigger, panel, onSelect }) {
  const valueBox = trigger.querySelector('#engineer-value');
  let current = {}, options = [], fingerprint = '', active = -1, opened = false, destroyed = false;
  let typed = '', typedAt = 0;
  const text = (tag, value, className) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value;
    return element;
  };
  const swatch = id => {
    const element = document.createElement('span');
    element.className = 'swatch'; element.setAttribute('aria-hidden', 'true');
    element.style.setProperty('--agent-color', colorFor(id));
    return element;
  };
  function close({ commit = false, focus = false } = {}) {
    const chosen = options[active]?.id;
    opened = false; panel.hidden = true;
    typed = ''; typedAt = 0;
    trigger.setAttribute('aria-expanded', 'false'); trigger.removeAttribute('aria-activedescendant');
    if (commit && chosen !== undefined && chosen !== current.selectedId) onSelect(chosen);
    if (focus && !destroyed && !trigger.disabled && trigger.isConnected) trigger.focus({ preventScroll: true });
  }
  function position() {
    if (!opened) return;
    const rect = trigger.getBoundingClientRect(), width = document.documentElement.clientWidth, height = innerHeight;
    const below = height - rect.bottom - 14, above = rect.top - 14;
    const downward = below >= 120 || below >= above, available = downward ? below : above;
    if (rect.width <= 0 || width < 48 || available < 40) { close(); return; }
    const panelWidth = Math.min(360, width - 16);
    panel.style.width = `${panelWidth}px`;
    panel.style.maxHeight = `${Math.min(360, available)}px`;
    panel.dataset.columns = panelWidth >= 340 ? '2' : '1';
    panel.style.left = `${Math.max(8, Math.min(rect.left, width - panelWidth - 8))}px`;
    panel.style.top = `${downward ? rect.bottom + 6 : Math.max(8, rect.top - panel.offsetHeight - 6)}px`;
  }
  function activate(index, scroll = true) {
    active = Math.max(0, Math.min(options.length - 1, index));
    for (const [i, option] of options.entries()) option.element.dataset.active = String(opened && i === active);
    const option = options[active];
    if (opened && option) {
      trigger.setAttribute('aria-activedescendant', option.element.id);
      if (scroll) option.element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }
  function open(index = options.findIndex(option => option.id === current.selectedId)) {
    if (destroyed || trigger.disabled || !options.length) return;
    opened = true; panel.hidden = false; trigger.setAttribute('aria-expanded', 'true');
    position(); if (opened) activate(index < 0 ? 0 : index);
  }
  function optionElement(option, index) {
    const element = document.createElement('div');
    element.id = `engineer-option-${index}`; element.className = 'engineer-option';
    if (!option.id) element.classList.add('engineer-option-all');
    element.setAttribute('role', 'option'); element.dataset.engineerId = option.id;
    element.setAttribute('aria-label', option.name + (option.date ? ` · ${option.date}` : ''));
    if (option.id) element.append(swatch(option.id));
    const copy = document.createElement('span'); copy.className = 'engineer-option-copy';
    copy.append(text('span', option.name));
    if (option.date) copy.append(text('small', option.date));
    element.append(copy);
    const check = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    check.classList.add('engineer-check'); check.setAttribute('viewBox', '0 0 16 16'); check.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(check.namespaceURI, 'path'); path.setAttribute('d', 'm3 8 3 3 7-7');
    check.append(path); element.append(check); return element;
  }
  function update({ agents, selectedId = '', missingId = null, allLabel, missingLabel }) {
    if (destroyed) return;
    if (!agents || missingId || current.selectedId !== selectedId) close();
    current = { agents, selectedId, allLabel };
    trigger.disabled = !agents || Boolean(missingId); trigger.value = selectedId;
    const selected = agents?.find(agent => agent.id === selectedId);
    valueBox.replaceChildren();
    if (selected) {
      valueBox.append(swatch(selected.id), text('span', `${selected.name || selected.id}${selected.date ? ' · ' + selected.date : ''}`));
    } else valueBox.append(text('span', missingId ? `${missingId} · ${missingLabel}` : `${allLabel}${agents ? ' · ' + agents.length : ''}`));
    const next = agents ? [{ id: '', name: `${allLabel} · ${agents.length}`, date: null }, ...agents.map(agent => ({ id: agent.id, name: agent.name || agent.id, date: agent.date }))] : [];
    const key = JSON.stringify(next);
    if (key !== fingerprint) {
      const activeId = options[active]?.id, scrollTop = panel.scrollTop;
      fingerprint = key; options = next.map((option, index) => ({ ...option, element: optionElement(option, index) }));
      panel.replaceChildren(...options.map(option => option.element)); panel.scrollTop = scrollTop;
      active = Math.max(0, options.findIndex(option => option.id === activeId));
    }
    for (const option of options) option.element.setAttribute('aria-selected', String(option.id === selectedId));
    if (opened) { position(); if (opened) activate(active); }
  }
  const toggle = () => opened ? close() : open();
  function keydown(event) {
    if (trigger.disabled) return;
    const { key } = event;
    if (key === 'Escape') {
      if (opened) { event.preventDefault(); event.stopPropagation(); close({ focus: true }); }
      return;
    }
    if (key === 'Tab') { if (opened) close({ commit: true }); return; }
    if (['Enter', ' '].includes(key)) {
      event.preventDefault(); opened ? close({ commit: true, focus: true }) : open(); return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(key)) {
      event.preventDefault();
      if (event.altKey && key === 'ArrowUp' && opened) { close({ commit: true, focus: true }); return; }
      if (!opened) {
        open(key === 'Home' || key === 'ArrowUp' ? 0 : key === 'End' ? options.length - 1 : undefined);
      } else activate(key === 'Home' ? 0 : key === 'End' ? options.length - 1 : active + ({ ArrowDown: 1, ArrowUp: -1, PageDown: 10, PageUp: -10 })[key]);
      return;
    }
    if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); if (!opened) open();
      const now = performance.now(); typed = now - typedAt < 700 ? typed + key.toLocaleLowerCase() : key.toLocaleLowerCase(); typedAt = now;
      const repeated = [...typed].every(char => char === typed[0]), query = repeated ? typed[0] : typed;
      const start = repeated ? active + 1 : 0;
      for (let step = 0; step < options.length; step++) {
        const index = (start + step) % options.length;
        if (options[index].name.toLocaleLowerCase().startsWith(query)) { activate(index); break; }
      }
    }
  }
  const picked = event => {
    const element = event.target.closest('[role="option"]');
    if (!element || !panel.contains(element)) return;
    active = options.findIndex(option => option.element === element); close({ commit: true, focus: true });
  };
  const keepFocus = event => { if (event.target.closest('[role="option"]')) event.preventDefault(); };
  const outside = event => { if (opened && !trigger.contains(event.target) && !panel.contains(event.target)) close(); };
  const scrolled = event => { if (opened && event.target !== panel && !panel.contains(event.target)) close(); };
  const resized = () => { position(); if (opened) activate(active); };
  const blurred = () => close();
  const listeners = [[trigger, 'click', toggle], [trigger, 'keydown', keydown], [panel, 'pointerdown', keepFocus], [panel, 'click', picked], [document, 'pointerdown', outside], [document, 'focusin', outside], [document, 'scroll', scrolled, true], [window, 'resize', resized], [window, 'blur', blurred]];
  for (const [target, name, listener, capture] of listeners) target.addEventListener(name, listener, capture);
  return {
    update, close,
    destroy() {
      if (destroyed) return;
      close(); destroyed = true;
      for (const [target, name, listener, capture] of listeners) target.removeEventListener(name, listener, capture);
      options = []; panel.replaceChildren();
    },
  };
}
