package one.rewind.xforce.vehicle_routing.service;

import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import one.rewind.xforce.vehicle_routing.db.dto.SolutionMetrics;
import org.junit.jupiter.api.Test;
import org.optaplanner.core.api.score.buildin.hardmediumsoftlong.HardMediumSoftLongScore;

import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SolverSearchProgressTrackerTest {

    @Test
    void capturesOnlyCurrentJobsScoreMetrics() {
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        UUID jobId = UUID.randomUUID();
        UUID otherJobId = UUID.randomUUID();
        MetricValues values = registerMetrics(registry, jobId, -20L, -10L);
        registerMetrics(registry, otherJobId, -99L, -88L);
        SolverSearchProgressTracker tracker = new SolverSearchProgressTracker(registry);
        tracker.markSearchStarted(jobId, 10_000L);
        tracker.recordBestScore(jobId, HardMediumSoftLongScore.of(0L, 0L, -10L));

        SolutionMetrics first = tracker.capture(jobId, 11_000L).orElseThrow();
        assertEquals(SolutionMetrics.RecordType.SEARCH_SAMPLE, first.getRecordType());
        assertEquals(1_000L, first.getElapsedMillis());
        assertEquals("0hard/0medium/-20soft", first.getSearchProgress().currentScore());
        assertEquals("0hard/0medium/-10soft", first.getSearchProgress().bestScore());

        assertTrue(tracker.capture(jobId, 11_500L).isEmpty(), "同一秒内不得重复采样");
        values.currentSoft.set(-15L);
        SolutionMetrics second = tracker.capture(jobId, 12_000L).orElseThrow();
        assertEquals("0hard/0medium/-15soft", second.getSearchProgress().currentScore());
    }

    @Test
    void ignoresMissingMetersAndReleasesStateWhenSearchFinishes() {
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        SolverSearchProgressTracker tracker = new SolverSearchProgressTracker(registry);
        UUID jobId = UUID.randomUUID();
        tracker.markSearchStarted(jobId, 20_000L);

        assertTrue(tracker.capture(jobId, 21_000L).isEmpty());
        SolverSearchProgressTracker.SearchEnd end = tracker.finish(jobId, 22_500L);
        assertEquals(2_500L, end.elapsedMillis());
        assertFalse(tracker.capture(jobId, 23_000L).isPresent());
    }

    @Test
    void fallsBackToUntaggedScoreMetricsOnlyForTheSingleTrackedJob() {
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        UUID jobId = UUID.randomUUID();
        UUID concurrentJobId = UUID.randomUUID();
        AtomicLong currentSoft = new AtomicLong(-20L);
        AtomicLong bestSoft = new AtomicLong(-10L);
        registerUntaggedScore(registry, SolverSearchProgressTracker.STEP_SCORE, currentSoft);
        registerUntaggedScore(registry, SolverSearchProgressTracker.BEST_SCORE, bestSoft);

        SolverSearchProgressTracker tracker = new SolverSearchProgressTracker(registry);
        tracker.markSearchStarted(jobId, 10_000L);

        SolutionMetrics first = tracker.capture(jobId, 11_000L).orElseThrow();
        assertEquals("0hard/0medium/-20soft", first.getSearchProgress().currentScore());
        assertEquals("0hard/0medium/-10soft", first.getSearchProgress().bestScore());

        tracker.markSearchStarted(concurrentJobId, 11_100L);
        assertTrue(tracker.capture(jobId, 12_000L).isEmpty(), "并行任务时不得读取无 tag 的全局 gauge");
    }

    private static MetricValues registerMetrics(
            SimpleMeterRegistry registry,
            UUID jobId,
            long currentSoft,
            long bestSoft
    ) {
        MetricValues values = new MetricValues(currentSoft, bestSoft);
        registerScore(registry, SolverSearchProgressTracker.STEP_SCORE, jobId, values.currentSoft);
        registerScore(registry, SolverSearchProgressTracker.BEST_SCORE, jobId, values.bestSoft);
        return values;
    }

    private static void registerScore(SimpleMeterRegistry registry, String prefix, UUID jobId, AtomicLong soft) {
        register(registry, prefix + ".hard", jobId, new AtomicLong(0L));
        register(registry, prefix + ".medium", jobId, new AtomicLong(0L));
        register(registry, prefix + ".soft", jobId, soft);
    }

    private static void registerUntaggedScore(SimpleMeterRegistry registry, String prefix, AtomicLong soft) {
        registerUntagged(registry, prefix + ".hard", new AtomicLong(0L));
        registerUntagged(registry, prefix + ".medium", new AtomicLong(0L));
        registerUntagged(registry, prefix + ".soft", soft);
    }

    private static void register(SimpleMeterRegistry registry, String name, UUID jobId, AtomicLong value) {
        Gauge.builder(name, value, AtomicLong::doubleValue)
                .tag(SolverSearchProgressTracker.PROBLEM_ID_TAG, jobId.toString())
                .register(registry);
    }

    private static void registerUntagged(SimpleMeterRegistry registry, String name, AtomicLong value) {
        Gauge.builder(name, value, AtomicLong::doubleValue).register(registry);
    }

    private record MetricValues(
            AtomicLong currentSoft,
            AtomicLong bestSoft
    ) {
        private MetricValues(long currentSoft, long bestSoft) {
            this(new AtomicLong(currentSoft), new AtomicLong(bestSoft));
        }
    }
}
