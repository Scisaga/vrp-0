const TOOLTIP_SELECTOR = "[data-tooltip]";
const TOOLTIP_GAP = 7.5;
const VIEWPORT_MARGIN = 15;

function eventTooltipTrigger(event) {
  const path = typeof event?.composedPath === "function" ? event.composedPath() : [];
  return path.find((node) => typeof node?.matches === "function" && node.matches(TOOLTIP_SELECTOR)) || null;
}

function overflowElements(trigger) {
  if (!trigger?.hasAttribute?.("data-tooltip-overflow")) {
    return null;
  }
  const selector = String(trigger.getAttribute("data-tooltip-overflow") || "").trim();
  if (!selector || selector === "self") {
    return [trigger];
  }
  try {
    return [...trigger.querySelectorAll(selector)];
  } catch (_error) {
    return [trigger];
  }
}

export function shouldShowTooltip(trigger) {
  const text = String(trigger?.dataset?.tooltip || "").trim();
  if (!text) {
    return false;
  }
  const candidates = overflowElements(trigger);
  if (!candidates) {
    return true;
  }
  return candidates.some((element) => (
    Number(element?.scrollWidth || 0) > Number(element?.clientWidth || 0) + 1
    || Number(element?.scrollHeight || 0) > Number(element?.clientHeight || 0) + 1
  ));
}

export function shouldShowFullValueTooltip(trigger, fullValue) {
  const value = String(fullValue || "").trim();
  if (!trigger || !value) {
    return false;
  }
  const visibleElement = trigger.matches?.(".identifier-value")
    ? trigger
    : trigger.querySelector?.(".identifier-value") || trigger;
  const visibleText = String(visibleElement?.textContent || "").trim();
  if (visibleText !== value) {
    return true;
  }
  const overflows = (element) => (
    Number(element?.scrollWidth || 0) > Number(element?.clientWidth || 0) + 1
    || Number(element?.scrollHeight || 0) > Number(element?.clientHeight || 0) + 1
  );
  return overflows(visibleElement) || (visibleElement !== trigger && overflows(trigger));
}

export function tooltipPosition(triggerRect, tooltipRect, viewport) {
  const viewportWidth = Math.max(0, Number(viewport?.width || 0));
  const viewportHeight = Math.max(0, Number(viewport?.height || 0));
  const tooltipWidth = Math.max(0, Number(tooltipRect?.width || 0));
  const tooltipHeight = Math.max(0, Number(tooltipRect?.height || 0));
  const centeredLeft = Number(triggerRect?.left || 0)
    + Number(triggerRect?.width || 0) / 2
    - tooltipWidth / 2;
  const maxLeft = Math.max(VIEWPORT_MARGIN, viewportWidth - tooltipWidth - VIEWPORT_MARGIN);
  const left = Math.min(Math.max(centeredLeft, VIEWPORT_MARGIN), maxLeft);
  const below = Number(triggerRect?.bottom || 0) + TOOLTIP_GAP;
  const above = Number(triggerRect?.top || 0) - tooltipHeight - TOOLTIP_GAP;
  const maxTop = Math.max(VIEWPORT_MARGIN, viewportHeight - tooltipHeight - VIEWPORT_MARGIN);
  const top = below + tooltipHeight <= viewportHeight - VIEWPORT_MARGIN
    ? below
    : Math.min(Math.max(above, VIEWPORT_MARGIN), maxTop);
  return { left, top };
}

export function initUiTooltips(root = globalThis.document) {
  if (!root?.addEventListener) {
    return () => {};
  }
  const documentRef = root.ownerDocument || root;
  const mountPoint = root.body || root;
  const eventView = documentRef.defaultView || globalThis;
  const tooltip = documentRef.createElement("div");
  tooltip.className = "global-ui-tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.setAttribute("data-open", "false");
  tooltip.hidden = true;
  mountPoint.append(tooltip);

  let hoveredTrigger = null;
  let focusedTrigger = null;
  let activeTrigger = null;
  let animationFrame = 0;
  let hideTimer = 0;
  let pointerDown = false;

  const clearPending = () => {
    if (animationFrame) {
      (documentRef.defaultView || globalThis).cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
    if (hideTimer) {
      (documentRef.defaultView || globalThis).clearTimeout(hideTimer);
      hideTimer = 0;
    }
  };

  const hide = () => {
    activeTrigger = null;
    clearPending();
    tooltip.dataset.open = "false";
    hideTimer = (documentRef.defaultView || globalThis).setTimeout(() => {
      if (!activeTrigger) {
        tooltip.hidden = true;
        tooltip.textContent = "";
      }
      hideTimer = 0;
    }, 150);
  };

  const show = (trigger) => {
    if (!shouldShowTooltip(trigger)) {
      hide();
      return;
    }
    clearPending();
    activeTrigger = trigger;
    const triggerDialog = trigger.closest?.("dialog[open]");
    const targetMountPoint = triggerDialog || mountPoint;
    if (tooltip.parentNode !== targetMountPoint) {
      targetMountPoint.append(tooltip);
    }
    tooltip.textContent = String(trigger.dataset.tooltip || "").trim();
    tooltip.hidden = false;
    tooltip.dataset.open = "false";
    tooltip.style.left = `${VIEWPORT_MARGIN}px`;
    tooltip.style.top = `${VIEWPORT_MARGIN}px`;
    const view = documentRef.defaultView || globalThis;
    animationFrame = view.requestAnimationFrame(() => {
      animationFrame = 0;
      if (activeTrigger !== trigger || !trigger.isConnected) {
        hide();
        return;
      }
      const position = tooltipPosition(
        trigger.getBoundingClientRect(),
        tooltip.getBoundingClientRect(),
        { width: view.innerWidth, height: view.innerHeight }
      );
      tooltip.style.left = `${position.left}px`;
      tooltip.style.top = `${position.top}px`;
      tooltip.dataset.open = "true";
    });
  };

  const refresh = () => {
    const trigger = focusedTrigger || hoveredTrigger;
    if (trigger) {
      show(trigger);
    } else {
      hide();
    }
  };

  const handleMouseOver = (event) => {
    const trigger = eventTooltipTrigger(event);
    if (!trigger || trigger === hoveredTrigger) {
      return;
    }
    hoveredTrigger = trigger;
    refresh();
  };
  const handleMouseOut = (event) => {
    if (!hoveredTrigger || hoveredTrigger.contains?.(event.relatedTarget)) {
      return;
    }
    hoveredTrigger = null;
    refresh();
  };
  const handleFocusIn = (event) => {
    const trigger = eventTooltipTrigger(event);
    if (!trigger || pointerDown) {
      return;
    }
    focusedTrigger = trigger;
    refresh();
  };
  const handleFocusOut = (event) => {
    if (!focusedTrigger || focusedTrigger.contains?.(event.relatedTarget)) {
      return;
    }
    focusedTrigger = null;
    refresh();
  };
  const handlePointerDown = () => {
    pointerDown = true;
    focusedTrigger = null;
    refresh();
  };
  const handlePointerUp = () => {
    pointerDown = false;
  };
  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      hoveredTrigger = null;
      focusedTrigger = null;
      hide();
      return;
    }
    const trigger = eventTooltipTrigger(event);
    if (trigger) {
      focusedTrigger = trigger;
      refresh();
    }
  };
  const handleViewportChange = () => {
    hoveredTrigger = null;
    if (focusedTrigger) {
      show(focusedTrigger);
    } else {
      hide();
    }
  };

  root.addEventListener("mouseover", handleMouseOver);
  root.addEventListener("mouseout", handleMouseOut);
  root.addEventListener("pointerdown", handlePointerDown, true);
  eventView.addEventListener("pointerup", handlePointerUp, true);
  eventView.addEventListener("pointercancel", handlePointerUp, true);
  root.addEventListener("focusin", handleFocusIn);
  root.addEventListener("focusout", handleFocusOut);
  root.addEventListener("keydown", handleKeyDown);
  (documentRef.defaultView || globalThis).addEventListener("resize", handleViewportChange);
  (documentRef.defaultView || globalThis).addEventListener("scroll", handleViewportChange, true);

  return () => {
    clearPending();
    root.removeEventListener("mouseover", handleMouseOver);
    root.removeEventListener("mouseout", handleMouseOut);
    root.removeEventListener("pointerdown", handlePointerDown, true);
    eventView.removeEventListener("pointerup", handlePointerUp, true);
    eventView.removeEventListener("pointercancel", handlePointerUp, true);
    root.removeEventListener("focusin", handleFocusIn);
    root.removeEventListener("focusout", handleFocusOut);
    root.removeEventListener("keydown", handleKeyDown);
    (documentRef.defaultView || globalThis).removeEventListener("resize", handleViewportChange);
    (documentRef.defaultView || globalThis).removeEventListener("scroll", handleViewportChange, true);
    tooltip.remove();
  };
}
