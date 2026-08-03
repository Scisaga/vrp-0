import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSolverScoreProgress,
  compareScores,
  hardPenalty,
  latestScorePointAtOrBefore,
  normalizeScoreText,
  parseHardMediumSoftScore
} from "../assets/js/utils/solver-score-progress.mjs";

test("结果概览可复用统一的复合得分规范化", () => {
  assert.equal(
    normalizeScoreText({ hardScore: 0, mediumScore: -1, softScore: -100 }),
    "0hard/-1medium/-100soft"
  );
});

test("历史最优输出原始 Hard、Medium、Soft 分数及 Hard 罚分柱高度", () => {
  const model = buildSolverScoreProgress({
    solution_metrics_list: [
      {
        record_type: "BEST_SOLUTION",
        elapsed_millis: 100,
        metrics: { score: "-3hard/-8medium/-100000soft" }
      },
      {
        record_type: "SEARCH_SAMPLE",
        elapsed_millis: 1000,
        search_progress: {
          current_score: "-2hard/-6medium/-90000soft",
          best_score: "-3hard/-8medium/-100000soft"
        }
      },
      {
        record_type: "BEST_SOLUTION",
        elapsed_millis: 1600,
        metrics: { score: "-2hard/-5medium/-50000soft" }
      },
      {
        record_type: "FINAL_SOLUTION",
        elapsed_millis: 2000,
        metrics: { score: "0hard/-2medium/-10000soft" }
      }
    ]
  });

  assert.deepEqual(model.bestPoints.map((point) => point.x), [0.1, 1.6, 2]);
  assert.deepEqual(model.bestPoints.map((point) => point.score.medium), [-8, -5, -2]);
  assert.deepEqual(model.bestPoints.map((point) => point.score.soft), [-100000, -50000, -10000]);
  assert.deepEqual(model.bestPoints.map((point) => point.hardPenalty), [3, 2, 0]);
  assert.equal(model.finalPoint.score.text, "0hard/-2medium/-10000soft");
  assert.equal(model.finalPoint.hardPenalty, 0);
  assert.equal(hardPenalty({ hard: -4 }), 4);
  assert.equal(hardPenalty({ hard: 0 }), 0);
  assert.equal(hardPenalty({ hard: 2 }), 0);
});

test("当前搜索得分不进入曲线，搜索快照仅在 best_score 严格改善时进入历史最优", () => {
  const model = buildSolverScoreProgress({
    solution_metrics_list: [
      { record_type: "BEST_SOLUTION", elapsed_millis: 0, metrics: { score: "0hard/-10medium/-100soft" } },
      {
        record_type: "SEARCH_SAMPLE",
        elapsed_millis: 1000,
        search_progress: {
          current_score: "-5hard/-999medium/-9999soft",
          best_score: "0hard/-10medium/-100soft"
        }
      },
      {
        record_type: "SEARCH_SAMPLE",
        elapsed_millis: 2000,
        search_progress: {
          current_score: "-9hard/-999medium/-9999soft",
          best_score: "0hard/-5medium/-80soft"
        }
      },
      { record_type: "FINAL_SOLUTION", elapsed_millis: 3000, metrics: { score: "0hard/-5medium/-80soft" } }
    ]
  });

  assert.deepEqual(model.bestPoints.map((point) => point.score.text), [
    "0hard/-10medium/-100soft",
    "0hard/-5medium/-80soft",
    "0hard/-5medium/-80soft"
  ]);
  assert.equal(model.bestPoints.some((point) => point.score.hard < 0), false);
  assert.equal("currentPoints" in model, false);
});

test("重复 Best 不产生虚构点，最终解延伸到真实结束时间", () => {
  const model = buildSolverScoreProgress({
    solution_metrics_list: [
      { record_type: "BEST_SOLUTION", recorded_at_millis: 1000, metrics: { score: "0hard/-2medium/-100soft" } },
      { record_type: "BEST_SOLUTION", recorded_at_millis: 2000, metrics: { score: "0hard/-2medium/-100soft" } },
      { record_type: "FINAL_SOLUTION", recorded_at_millis: 3000, metrics: { score: "0hard/-2medium/-100soft" } }
    ]
  });

  assert.deepEqual(model.bestPoints.map((point) => point.x), [0, 2]);
  assert.equal(model.finalPoint.x, 2);
  assert.equal(model.allPoints.length, 3);
  assert.ok(model.allPoints.every((point) => Number.isFinite(point.x)));
});

test("旧任务回退为最终解，且不补造过程点", () => {
  const model = buildSolverScoreProgress({
    update_time: "2026-07-21 10:00:00",
    score: "0hard/-2medium/-100soft"
  });

  assert.equal(model.bestPoints.length, 1);
  assert.equal(model.finalPoint.x, 0);
  assert.equal(model.bestPoints[0].score.text, "0hard/-2medium/-100soft");
});

test("最终解即使差于历史最优，也保留为可展示和悬浮的真实事件", () => {
  const model = buildSolverScoreProgress({
    solution_metrics_list: [
      { record_type: "BEST_SOLUTION", elapsed_millis: 0, metrics: { score: "0hard/-2medium/-20soft" } },
      { record_type: "FINAL_SOLUTION", elapsed_millis: 2000, metrics: { score: "-3hard/-9medium/-200soft" } }
    ]
  });

  assert.deepEqual(model.bestPoints.map((point) => point.score.text), ["0hard/-2medium/-20soft"]);
  assert.equal(model.finalPoint.hardPenalty, 3);
  assert.equal(latestScorePointAtOrBefore(model.allPoints, 2)?.label, "最终解");
});

test("悬浮阶梯线只读取当前时间及以前的真实历史最优点，不吸附到前方点", () => {
  const model = buildSolverScoreProgress({
    solution_metrics_list: [
      { record_type: "BEST_SOLUTION", elapsed_millis: 0, metrics: { score: "0hard/-8medium/-100soft" } },
      { record_type: "BEST_SOLUTION", elapsed_millis: 1000, metrics: { score: "0hard/-4medium/-80soft" } },
      { record_type: "FINAL_SOLUTION", elapsed_millis: 3000, metrics: { score: "0hard/-2medium/-20soft" } }
    ]
  });

  assert.equal(latestScorePointAtOrBefore(model.bestPoints, -0.01), null);
  assert.equal(latestScorePointAtOrBefore(model.bestPoints, 0.5)?.x, 0);
  assert.equal(latestScorePointAtOrBefore(model.bestPoints, 2.5)?.x, 1);
  assert.equal(latestScorePointAtOrBefore(model.bestPoints, 2.5)?.score.soft, -80);
  assert.equal(latestScorePointAtOrBefore(model.bestPoints, 3)?.x, 3);
  assert.equal(latestScorePointAtOrBefore(model.allPoints, 3)?.label, "最终解");
  assert.ok(compareScores(parseHardMediumSoftScore("0hard/-2medium/-20soft"), parseHardMediumSoftScore("0hard/-4medium/-80soft")) > 0);
});
