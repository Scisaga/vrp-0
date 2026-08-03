const ELEMENT_NAME = "vrp-date-time-24";
const HTMLElementBase = globalThis.HTMLElement || class {};

function padded(value) {
  return String(value).padStart(2, "0");
}

function validDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function normalizeValue(value, showSeconds) {
  const match = String(value ?? "").trim().match(
    /^(\d{4})[-/](\d{2})[-/](\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?$/
  );
  if (!match) {
    return "";
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText = "00"] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (!validDate(year, month, day) || hour > 23 || minute > 59 || second > 59) {
    return "";
  }

  return `${yearText}-${monthText}-${dayText}T${padded(hour)}:${padded(minute)}`
    + (showSeconds ? `:${padded(second)}` : "");
}

function displayValue(value) {
  return String(value || "").replace("T", " ");
}

function localTodayParts() {
  const today = new Date();
  return {
    year: today.getFullYear(),
    month: today.getMonth() + 1,
    day: today.getDate()
  };
}

function valueParts(value, showSeconds) {
  const normalized = normalizeValue(value, showSeconds);
  if (!normalized) {
    return null;
  }
  return {
    year: Number(normalized.slice(0, 4)),
    month: Number(normalized.slice(5, 7)),
    day: Number(normalized.slice(8, 10)),
    hour: Number(normalized.slice(11, 13)),
    minute: Number(normalized.slice(14, 16)),
    second: showSeconds ? Number(normalized.slice(17, 19)) : 0
  };
}

function partsValue(parts, showSeconds) {
  return `${parts.year}-${padded(parts.month)}-${padded(parts.day)}`
    + `T${padded(parts.hour)}:${padded(parts.minute)}`
    + (showSeconds ? `:${padded(parts.second)}` : "");
}

class DateTime24Input extends HTMLElementBase {
  static get observedAttributes() {
    return ["disabled", "aria-label"];
  }

  constructor() {
    super();
    this._value = "";
    this._draft = null;
    this._viewYear = 0;
    this._viewMonth = 0;
    this._initialized = false;
    this._open = false;
    this._boundOutsidePointer = (event) => this._handleOutsidePointer(event);
    this._boundDocumentKeydown = (event) => this._handleDocumentKeydown(event);
    this._boundViewportChange = () => this._positionPicker();
  }

  connectedCallback() {
    if (!this._initialized) {
      this._render();
      this._initialized = true;
    }
    this._syncDisabled();
    this._syncLabels();
    this._renderValue();
  }

  disconnectedCallback() {
    this._closePicker();
  }

  attributeChangedCallback(name) {
    if (!this._initialized) {
      return;
    }
    if (name === "disabled") {
      this._syncDisabled();
    } else if (name === "aria-label") {
      this._syncLabels();
    }
  }

  get value() {
    return this._value;
  }

  set value(nextValue) {
    const raw = String(nextValue ?? "").trim();
    this._value = raw ? normalizeValue(raw, this._showSeconds()) : "";
    this._renderValue();
  }

  focus(options) {
    this._valueInput?.focus(options);
  }

  select() {
    this._valueInput?.select?.();
  }

  _showSeconds() {
    const step = this.getAttribute("step");
    return this.hasAttribute("seconds") || (step !== null && Number(step) < 60);
  }

  _formatHint() {
    return this._showSeconds() ? "YYYY-MM-DD HH:mm:ss" : "YYYY-MM-DD HH:mm";
  }

  _locale() {
    return document.documentElement.lang || navigator.language || "zh-CN";
  }

  _copy() {
    const chinese = this._locale().toLowerCase().startsWith("zh");
    return chinese
      ? {
        previousMonth: "上个月",
        nextMonth: "下个月",
        hour: "时",
        minute: "分",
        second: "秒",
        today: "今天",
        confirm: "确定",
        open: "打开日期时间选择器"
      }
      : {
        previousMonth: "Previous month",
        nextMonth: "Next month",
        hour: "Hour",
        minute: "Minute",
        second: "Second",
        today: "Today",
        confirm: "Confirm",
        open: "Open date and time picker"
      };
  }

  _render() {
    this.replaceChildren();

    this._valueInput = document.createElement("input");
    this._valueInput.type = "text";
    this._valueInput.className = "datetime24-value";
    this._valueInput.autocomplete = "off";
    this._valueInput.spellcheck = false;
    this._valueInput.maxLength = this._showSeconds() ? 19 : 16;
    this._valueInput.placeholder = this._formatHint();

    this._trigger = document.createElement("button");
    this._trigger.type = "button";
    this._trigger.className = "datetime24-calendar-trigger";
    this._trigger.setAttribute("aria-haspopup", "dialog");
    this._trigger.setAttribute("aria-expanded", "false");

    this._calendarIcon = document.createElement("span");
    this._calendarIcon.className = "datetime24-calendar-icon material-symbols-rounded";
    this._calendarIcon.textContent = "calendar_month";
    this._calendarIcon.setAttribute("aria-hidden", "true");
    this._trigger.append(this._calendarIcon);

    this._picker = document.createElement("div");
    this._picker.className = "datetime24-picker";
    this._picker.setAttribute("role", "dialog");
    this._picker.setAttribute("aria-modal", "false");
    if (typeof this._picker.showPopover === "function") {
      this._picker.setAttribute("popover", "manual");
    } else {
      this._picker.hidden = true;
    }

    this.append(this._valueInput, this._trigger, this._picker);
    this._listenToValueInput();
    this._trigger.addEventListener("click", () => this._togglePicker());
    this._picker.addEventListener("click", (event) => this._handlePickerClick(event));
  }

  _listenToValueInput() {
    this._valueInput.addEventListener("input", (event) => {
      event.stopPropagation();
      if (this._syncValueFromText(false)) {
        this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      }
    });
    this._valueInput.addEventListener("change", (event) => {
      event.stopPropagation();
      if (this._syncValueFromText(true)) {
        this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      }
    });
    this._valueInput.addEventListener("blur", () => this._syncValueFromText(true));
  }

  _syncValueFromText(format) {
    const raw = this._valueInput.value.trim();
    if (!raw) {
      this._value = "";
      this._valueInput.removeAttribute("aria-invalid");
      return true;
    }

    const normalized = normalizeValue(raw, this._showSeconds());
    if (!normalized) {
      this._valueInput.setAttribute("aria-invalid", "true");
      return false;
    }

    this._value = normalized;
    this._valueInput.removeAttribute("aria-invalid");
    if (format) {
      this._valueInput.value = displayValue(normalized);
    }
    return true;
  }

  _togglePicker() {
    if (this.hasAttribute("disabled")) {
      return;
    }
    if (this._open) {
      this._closePicker();
    } else {
      this._openPicker();
    }
  }

  _openPicker() {
    this._syncValueFromText(true);
    const today = localTodayParts();
    this._draft = valueParts(this._value, this._showSeconds()) || {
      ...today,
      hour: 0,
      minute: 0,
      second: 0
    };
    this._viewYear = this._draft.year;
    this._viewMonth = this._draft.month;
    this._renderPicker();

    if (typeof this._picker.showPopover === "function") {
      this._picker.showPopover();
    } else {
      this._picker.hidden = false;
    }
    this._open = true;
    this._trigger.setAttribute("aria-expanded", "true");
    this._positionPicker();
    this._scrollSelectedTimesIntoView();
    document.addEventListener("pointerdown", this._boundOutsidePointer, true);
    document.addEventListener("keydown", this._boundDocumentKeydown, true);
    window.addEventListener("resize", this._boundViewportChange);
    window.addEventListener("scroll", this._boundViewportChange, true);
  }

  _closePicker() {
    if (!this._picker || !this._open) {
      return;
    }
    if (typeof this._picker.hidePopover === "function") {
      try {
        this._picker.hidePopover();
      } catch {
        // The popover may already be closed by the browser.
      }
    } else {
      this._picker.hidden = true;
    }
    this._open = false;
    this._trigger?.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", this._boundOutsidePointer, true);
    document.removeEventListener("keydown", this._boundDocumentKeydown, true);
    window.removeEventListener("resize", this._boundViewportChange);
    window.removeEventListener("scroll", this._boundViewportChange, true);
  }

  _positionPicker() {
    if (!this._open) {
      return;
    }
    const anchor = this.getBoundingClientRect();
    const picker = this._picker.getBoundingClientRect();
    const edge = 10;
    let left = Math.max(edge, Math.min(anchor.left, window.innerWidth - picker.width - edge));
    let top = anchor.bottom + 5;
    if (top + picker.height > window.innerHeight - edge && anchor.top - picker.height - 5 >= edge) {
      top = anchor.top - picker.height - 5;
    }
    this._picker.style.left = `${left}px`;
    this._picker.style.top = `${Math.max(edge, top)}px`;
  }

  _handleOutsidePointer(event) {
    const path = event.composedPath?.() || [];
    const insideComponent = path.includes(this)
      || path.includes(this._picker)
      || this.contains(event.target)
      || this._picker.contains(event.target);
    if (!insideComponent) {
      this._closePicker();
    }
  }

  _handleDocumentKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      this._closePicker();
      this._trigger.focus();
    }
  }

  _renderPicker() {
    const copy = this._copy();
    this._picker.replaceChildren();

    const body = document.createElement("div");
    body.className = "datetime24-picker-body";

    const calendar = document.createElement("section");
    calendar.className = "datetime24-picker-calendar";
    const header = document.createElement("div");
    header.className = "datetime24-picker-header";

    const monthLabel = document.createElement("strong");
    monthLabel.className = "datetime24-picker-month";
    monthLabel.textContent = new Intl.DateTimeFormat(this._locale(), {
      year: "numeric",
      month: "long"
    }).format(new Date(this._viewYear, this._viewMonth - 1, 1));

    const navigation = document.createElement("div");
    navigation.className = "datetime24-picker-navigation";
    navigation.append(
      this._pickerButton("‹", "datetime24-picker-nav", "previous-month", copy.previousMonth),
      this._pickerButton("›", "datetime24-picker-nav", "next-month", copy.nextMonth)
    );
    header.append(monthLabel, navigation);

    const weekdays = document.createElement("div");
    weekdays.className = "datetime24-picker-weekdays";
    const monday = new Date(Date.UTC(2024, 0, 1));
    for (let index = 0; index < 7; index += 1) {
      const label = document.createElement("span");
      const date = new Date(monday);
      date.setUTCDate(monday.getUTCDate() + index);
      label.textContent = new Intl.DateTimeFormat(this._locale(), {
        weekday: "short",
        timeZone: "UTC"
      }).format(date);
      weekdays.append(label);
    }

    const days = document.createElement("div");
    days.className = "datetime24-picker-days";
    this._calendarDates().forEach((date) => {
      const dateValue = `${date.year}-${padded(date.month)}-${padded(date.day)}`;
      const button = this._pickerButton(String(date.day), "datetime24-picker-day", "select-date");
      button.dataset.date = dateValue;
      if (date.month !== this._viewMonth) {
        button.classList.add("datetime24-picker-day-outside");
      }
      if (this._draft.year === date.year && this._draft.month === date.month && this._draft.day === date.day) {
        button.classList.add("datetime24-picker-day-selected");
        button.setAttribute("aria-current", "date");
      }
      const today = localTodayParts();
      if (today.year === date.year && today.month === date.month && today.day === date.day) {
        button.classList.add("datetime24-picker-day-today");
      }
      days.append(button);
    });
    calendar.append(header, weekdays, days);

    const timePanel = document.createElement("aside");
    timePanel.className = "datetime24-picker-time";
    const timeColumns = document.createElement("div");
    timeColumns.className = "datetime24-picker-time-columns";
    const units = [
      ["hour", copy.hour, 24],
      ["minute", copy.minute, 60]
    ];
    if (this._showSeconds()) {
      units.push(["second", copy.second, 60]);
    }
    timeColumns.style.gridTemplateColumns = `repeat(${units.length}, minmax(0, 1fr))`;
    units.forEach(([unit, label, count]) => timeColumns.append(this._timeColumn(unit, label, count)));
    timePanel.append(timeColumns);
    body.append(calendar, timePanel);

    const footer = document.createElement("footer");
    footer.className = "datetime24-picker-footer";
    footer.append(
      this._pickerButton(copy.today, "datetime24-picker-today", "today"),
      this._pickerButton(copy.confirm, "datetime24-picker-confirm", "confirm")
    );
    this._picker.append(body, footer);
  }

  _pickerButton(text, className, action, ariaLabel = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.dataset.pickerAction = action;
    button.textContent = text;
    if (ariaLabel) {
      button.setAttribute("aria-label", ariaLabel);
    }
    return button;
  }

  _calendarDates() {
    const first = new Date(this._viewYear, this._viewMonth - 1, 1);
    const mondayOffset = (first.getDay() + 6) % 7;
    const start = new Date(this._viewYear, this._viewMonth - 1, 1 - mondayOffset);
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return {
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate()
      };
    });
  }

  _timeColumn(unit, label, count) {
    const wrapper = document.createElement("div");
    wrapper.className = "datetime24-picker-time-unit";
    const heading = document.createElement("div");
    heading.className = "datetime24-picker-time-heading";
    heading.textContent = label;
    const list = document.createElement("div");
    list.className = "datetime24-picker-time-list";
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", label);
    list.dataset.timeList = unit;
    for (let value = 0; value < count; value += 1) {
      const button = this._pickerButton(padded(value), "datetime24-picker-time-option", "select-time");
      button.dataset.timeUnit = unit;
      button.dataset.timeValue = String(value);
      button.setAttribute("role", "option");
      if (this._draft[unit] === value) {
        button.classList.add("datetime24-picker-time-option-selected");
        button.setAttribute("aria-selected", "true");
      }
      list.append(button);
    }
    wrapper.append(heading, list);
    return wrapper;
  }

  _handlePickerClick(event) {
    const button = event.target.closest("button[data-picker-action]");
    if (!button) {
      return;
    }
    const action = button.dataset.pickerAction;
    if (action === "previous-month" || action === "next-month") {
      const date = new Date(this._viewYear, this._viewMonth - 1 + (action === "next-month" ? 1 : -1), 1);
      this._viewYear = date.getFullYear();
      this._viewMonth = date.getMonth() + 1;
      this._rerenderOpenPicker();
    } else if (action === "select-date") {
      const [year, month, day] = button.dataset.date.split("-").map(Number);
      Object.assign(this._draft, { year, month, day });
      this._viewYear = year;
      this._viewMonth = month;
      this._rerenderOpenPicker();
    } else if (action === "select-time") {
      this._draft[button.dataset.timeUnit] = Number(button.dataset.timeValue);
      this._rerenderOpenPicker();
    } else if (action === "today") {
      Object.assign(this._draft, localTodayParts());
      this._viewYear = this._draft.year;
      this._viewMonth = this._draft.month;
      this._rerenderOpenPicker();
    } else if (action === "confirm") {
      this._commitPickerValue();
    }
  }

  _rerenderOpenPicker() {
    this._renderPicker();
    this._positionPicker();
    this._scrollSelectedTimesIntoView();
  }

  _scrollSelectedTimesIntoView() {
    requestAnimationFrame(() => {
      this._picker.querySelectorAll(".datetime24-picker-time-list").forEach((list) => {
        const selected = list.querySelector(".datetime24-picker-time-option-selected");
        if (selected) {
          list.scrollTop = selected.offsetTop - ((list.clientHeight - selected.offsetHeight) / 2);
        }
      });
    });
  }

  _commitPickerValue() {
    this._value = partsValue(this._draft, this._showSeconds());
    this._renderValue();
    this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    this._closePicker();
    this._valueInput.focus();
  }

  _renderValue() {
    if (!this._initialized) {
      return;
    }
    this._valueInput.value = displayValue(this._value);
    this._valueInput.removeAttribute("aria-invalid");
  }

  _syncDisabled() {
    const disabled = this.hasAttribute("disabled");
    [this._valueInput, this._trigger]
      .filter(Boolean)
      .forEach((control) => { control.disabled = disabled; });
    if (disabled) {
      this._closePicker();
    }
  }

  _syncLabels() {
    const label = this.getAttribute("aria-label") || this._formatHint();
    const copy = this._copy();
    this._valueInput?.setAttribute("aria-label", label);
    this._trigger?.setAttribute("aria-label", `${copy.open}：${label}`);
  }
}

export function defineDateTime24Input() {
  if (globalThis.customElements && !globalThis.customElements.get(ELEMENT_NAME)) {
    globalThis.customElements.define(ELEMENT_NAME, DateTime24Input);
  }
}

defineDateTime24Input();
