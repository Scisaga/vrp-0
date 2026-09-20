// Shared presentation only. No API, host, data projection or schedule inference.
export const GANTT_STAGE_STYLES = {
  travel: {
    labelKey: "gantt.travel",
    background: "rgba(59, 130, 246, 0.18)",
    baseBackground: "rgba(59, 130, 246, 0.07)",
    border: "rgba(37, 99, 235, 0.34)",
    text: "#1d4ed8",
    dot: "background:#60a5fa;"
  },
  wait: {
    labelKey: "gantt.waiting",
    background: "rgba(59, 130, 246, 0.34)",
    baseBackground: "rgba(59, 130, 246, 0.10)",
    border: "rgba(37, 99, 235, 0.42)",
    text: "#1e40af",
    dot: "background:#2563eb;"
  },
  service: {
    labelKey: "gantt.service",
    background: "rgba(16, 185, 129, 0.26)",
    baseBackground: "rgba(16, 185, 129, 0.08)",
    border: "rgba(5, 150, 105, 0.32)",
    text: "#047857",
    dot: "background:rgba(16, 185, 129, 0.26);"
  },
  return: {
    labelKey: "gantt.return",
    background: "rgba(139, 92, 246, 0.24)",
    baseBackground: "rgba(139, 92, 246, 0.08)",
    border: "rgba(124, 58, 237, 0.34)",
    text: "#6d28d9",
    dot: "background:#8b5cf6;"
  }
};

export const GANTT_OUT_OF_WINDOW_STYLE = {
  border: "rgba(225, 29, 72, 0.98)",
  text: "#be123c",
  dot: "background:#e11d48;box-shadow:0 0 0 2.5px rgba(225,29,72,0.16);"
};
