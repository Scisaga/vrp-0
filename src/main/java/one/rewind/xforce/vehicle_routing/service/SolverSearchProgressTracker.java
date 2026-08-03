package one.rewind.xforce.vehicle_routing.service;

import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Metrics;
import jakarta.enterprise.context.ApplicationScoped;
import one.rewind.xforce.vehicle_routing.db.dto.SolutionMetrics;
import one.rewind.xforce.vehicle_routing.db.dto.SolverSearchProgress;
import org.optaplanner.core.api.score.buildin.hardmediumsoftlong.HardMediumSoftLongScore;

import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 从 OptaPlanner 已暴露的 Micrometer gauge 读取数据；不向 Solver 回写任何状态。
 */
@ApplicationScoped
public class SolverSearchProgressTracker {

    static final long SAMPLE_INTERVAL_MILLIS = 1_000L;

    static final String PROBLEM_ID_TAG = "problem.id";
    static final String BEST_SCORE = "optaplanner.solver.best.score";
    static final String STEP_SCORE = "optaplanner.solver.step.score";

    private final MeterRegistry meterRegistry;
    private final ConcurrentHashMap<UUID, ProgressState> states = new ConcurrentHashMap<>();

    public SolverSearchProgressTracker() {
        this(Metrics.globalRegistry);
    }

    SolverSearchProgressTracker(MeterRegistry meterRegistry) {
        this.meterRegistry = meterRegistry;
    }

    public void markSearchStarted(UUID jobId, long startedAtMillis) {
        if (jobId == null) {
            return;
        }
        states.compute(jobId, (ignored, existing) -> existing == null
                ? new ProgressState(startedAtMillis)
                : existing.started(startedAtMillis));
    }

    public void recordBestScore(UUID jobId, HardMediumSoftLongScore score) {
        ProgressState state = states.get(jobId);
        if (state == null || score == null) {
            return;
        }
        synchronized (state) {
            state.bestScore = score.toString();
        }
    }

    public long elapsedMillis(UUID jobId, long nowMillis) {
        ProgressState state = states.get(jobId);
        if (state == null || state.startedAtMillis <= 0) {
            return 0L;
        }
        return Math.max(0L, nowMillis - state.startedAtMillis);
    }

    public Optional<SolutionMetrics> capture(UUID jobId, long nowMillis) {
        ProgressState state = states.get(jobId);
        if (state == null || state.startedAtMillis <= 0) {
            return Optional.empty();
        }

        synchronized (state) {
            if (state.lastSampleAtMillis > 0
                    && nowMillis - state.lastSampleAtMillis < SAMPLE_INTERVAL_MILLIS) {
                return Optional.empty();
            }

            SolverSearchProgress progress = new SolverSearchProgress(
                    score(jobId, STEP_SCORE),
                    state.bestScore != null ? state.bestScore : score(jobId, BEST_SCORE)
            );
            if (!progress.hasAnyValue()) {
                return Optional.empty();
            }

            state.lastSampleAtMillis = nowMillis;
            return Optional.of(SolutionMetrics.searchSample(
                    progress,
                    nowMillis,
                    Math.max(0L, nowMillis - state.startedAtMillis)
            ));
        }
    }

    public SearchEnd finish(UUID jobId, long finishedAtMillis) {
        ProgressState state = states.remove(jobId);
        long elapsedMillis = state == null || state.startedAtMillis <= 0
                ? 0L
                : Math.max(0L, finishedAtMillis - state.startedAtMillis);
        return new SearchEnd(finishedAtMillis, elapsedMillis);
    }

    public void discard(UUID jobId) {
        states.remove(jobId);
    }

    private String score(UUID jobId, String metricName) {
        // SolverMetric.registerScoreMetrics() 以 score level label 直接拼接 meter id，
        // 例如 optaplanner.solver.step.score.hard，而不是 Prometheus 文本导出名。
        Long hard = meterValue(jobId, metricName + ".hard");
        Long medium = meterValue(jobId, metricName + ".medium");
        Long soft = meterValue(jobId, metricName + ".soft");
        if (hard == null || medium == null || soft == null) {
            return null;
        }
        return HardMediumSoftLongScore.of(hard, medium, soft).toString();
    }

    private Long meterValue(UUID jobId, String meterName) {
        if (jobId == null) {
            return null;
        }
        Gauge gauge = meterRegistry.find(meterName)
                .tag(PROBLEM_ID_TAG, jobId.toString())
                .gauge();
        if (gauge == null && states.size() == 1 && states.containsKey(jobId)) {
            // SolverManager 未设置 monitoring tags 时，OptaPlanner 会注册无 tag 的全局 gauge。
            // 仅有一个正在跟踪的任务时才允许读取，避免把并行任务的得分串到当前任务。
            gauge = meterRegistry.find(meterName).gauge();
        }
        if (gauge == null) {
            return null;
        }
        double value = gauge.value();
        if (!Double.isFinite(value)) {
            return null;
        }
        return Math.round(value);
    }

    public record SearchEnd(long recordedAtMillis, long elapsedMillis) {
    }

    private static final class ProgressState {
        private long startedAtMillis;
        private String bestScore;
        private long lastSampleAtMillis;

        private ProgressState(long startedAtMillis) {
            this.startedAtMillis = startedAtMillis;
        }

        private ProgressState started(long startedAtMillis) {
            if (this.startedAtMillis <= 0) {
                this.startedAtMillis = startedAtMillis;
            }
            return this;
        }
    }
}
