function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function scoreObjectNumber(value, keys) {
  if (!value || typeof value !== "object") {
    return null;
  }
  for (const key of keys) {
    const parsed = numberValue(value[key]);
    if (parsed != null) {
      return parsed;
    }
  }
  return null;
}

export function normalizeScoreText(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (value && typeof value === "object") {
    const hard = scoreObjectNumber(value, ["hardScore", "hard_score", "hard"]);
    const medium = scoreObjectNumber(value, ["mediumScore", "medium_score", "medium"]);
    const soft = scoreObjectNumber(value, ["softScore", "soft_score", "soft"]);
    if (hard != null && medium != null && soft != null) {
      return `${hard}hard/${medium}medium/${soft}soft`;
    }
    if (typeof value.score === "string") {
      return value.score.trim();
    }
  }
  return "";
}

export function parseHardMediumSoftScore(value) {
  const text = normalizeScoreText(value);
  const match = text.match(/(-?\d+)\s*hard\s*\/\s*(-?\d+)\s*medium\s*\/\s*(-?\d+)\s*soft/i);
  if (!match) {
    return null;
  }
  const hard = Number(match[1]);
  const medium = Number(match[2]);
  const soft = Number(match[3]);
  if (![hard, medium, soft].every(Number.isFinite)) {
    return null;
  }
  return { hard, medium, soft, text: `${hard}hard/${medium}medium/${soft}soft` };
}

export function compareScores(left, right) {
  return (left.hard - right.hard)
    || (left.medium - right.medium)
    || (left.soft - right.soft);
}

/**
 * 将 Hard 原始分数转换为柱状图的正向罚分高度。
 * Hard = 0 代表可行解，因此不画有高度的柱；标签仍保留原始负分。
 */
export function hardPenalty(score) {
  return Math.max(0, -(Number(score?.hard) || 0));
}

/**
 * 返回给定时间及以前最近一次真实历史最优事件。
 * 历史最优以阶梯线展示，因此绝不向前取样或补造中间分数。
 */
export function latestScorePointAtOrBefore(points, elapsedSeconds) {
  const elapsed = numberValue(elapsedSeconds);
  if (elapsed == null || !Array.isArray(points)) {
    return null;
  }
  return points.reduce((latest, point) => {
    if (!Number.isFinite(point?.x) || point.x > elapsed) {
      return latest;
    }
    return !latest || point.x >= latest.x ? point : latest;
  }, null);
}

function metricTimeMillis(item) {
  const recorded = numberValue(item?.recorded_at_millis ?? item?.recordedAtMillis);
  if (recorded != null) {
    return recorded;
  }
  const raw = item?.create_time ?? item?.createTime ?? item?.time;
  const parsed = typeof raw === "string" ? Date.parse(raw.replace(" ", "T")) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function metricElapsedMillis(item) {
  const elapsed = numberValue(item?.elapsed_millis ?? item?.elapsedMillis);
  return elapsed != null && elapsed >= 0 ? elapsed : null;
}

function metricsScore(item, job, index, list) {
  return item?.metrics?.score
    ?? item?.score
    ?? (String(item?.record_type ?? item?.recordType) === "FINAL_SOLUTION"
      ? (job?.score ?? job?.plan?.score)
      : null)
    ?? (index === list.length - 1 ? (job?.score ?? job?.plan?.score) : null);
}

function sourceRecords(job) {
  const list = Array.isArray(job?.solution_metrics_list) && job.solution_metrics_list.length
    ? job.solution_metrics_list
    : [{
      record_type: "FINAL_SOLUTION",
      recorded_at_millis: job?.update_time ? Date.parse(String(job.update_time).replace(" ", "T")) : null,
      metrics: job?.metrics || { score: job?.score ?? job?.plan?.score }
    }];
  const rawTimes = list.map(metricTimeMillis).filter((value) => value != null);
  const origin = rawTimes.length ? Math.min(...rawTimes) : 0;
  return list.map((item, index) => ({
    item,
    index,
    recordType: String(item?.record_type ?? item?.recordType ?? ""),
    elapsedMillis: metricElapsedMillis(item),
    timeMillis: metricTimeMillis(item),
    x: null,
    fallbackX: index,
    origin
  })).map((record) => ({
    ...record,
    x: (record.elapsedMillis ?? (record.timeMillis != null ? Math.max(0, record.timeMillis - origin) : record.fallbackX * 1000)) / 1000
  })).sort((left, right) => left.x - right.x || left.index - right.index);
}

function point(record, score, label, kind = "best") {
  return {
    id: `${kind}-${record.index}-${record.x}`,
    x: record.x,
    score,
    scoreText: score.text,
    label,
    kind,
    hardPenalty: hardPenalty(score)
  };
}

/**
 * 将新旧 solution_metrics_list 归一化为真实的历史最优和最终解事件。
 * 当前搜索快照只在其 best_score 严格改善时进入历史最优；current_score 不参与本图。
 */
export function buildSolverScoreProgress(job) {
  const records = sourceRecords(job);
  const bestPoints = [];
  let finalPoint = null;
  let bestScore = null;

  records.forEach((record) => {
    const { item, recordType } = record;
    if (recordType === "SEARCH_SAMPLE") {
      const progress = item?.search_progress ?? item?.searchProgress;
      const sampledBest = parseHardMediumSoftScore(progress?.best_score ?? progress?.bestScore);
      if (sampledBest && (!bestScore || compareScores(sampledBest, bestScore) > 0)) {
        bestScore = sampledBest;
        bestPoints.push(point(record, sampledBest, "历史最优"));
      }
      return;
    }

    const score = parseHardMediumSoftScore(metricsScore(item, job, record.index, records));
    if (!score) {
      return;
    }
    if (recordType === "FINAL_SOLUTION") {
      finalPoint = point(record, score, "最终解", "final");
      const comparison = bestScore ? compareScores(score, bestScore) : 1;
      if (comparison >= 0) {
        bestScore = score;
        // FINAL_SOLUTION 是真实的搜索结束事件：同分也延伸阶梯线，但不表示新的严格改善。
        bestPoints.push(point(record, score, "历史最优（求解结束）"));
      }
      return;
    }
    if (!bestScore || compareScores(score, bestScore) > 0) {
      bestScore = score;
      bestPoints.push(point(record, score, "历史最优"));
    }
  });

  return {
    bestPoints,
    finalPoint,
    allPoints: [...bestPoints, ...(finalPoint ? [finalPoint] : [])]
      .sort((left, right) => left.x - right.x || left.kind.localeCompare(right.kind))
  };
}
