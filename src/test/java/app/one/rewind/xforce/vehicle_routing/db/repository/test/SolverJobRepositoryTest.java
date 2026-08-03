package one.rewind.xforce.vehicle_routing.db.repository.test;

import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import one.rewind.xforce.geo.transit.Transit;
import one.rewind.xforce.geo.transit.TransitMatrix;
import one.rewind.xforce.json.OM;
import one.rewind.xforce.vehicle_routing.db.dto.SolutionMetrics;
import one.rewind.xforce.vehicle_routing.db.dto.Scenario;
import one.rewind.xforce.vehicle_routing.db.dto.SolverJob;
import one.rewind.xforce.vehicle_routing.db.repository.SolverJobRepository;
import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.solver.Status;
import org.optaplanner.core.api.score.buildin.hardmediumsoftlong.HardMediumSoftLongScore;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

@QuarkusTest
@Tag("app")
class SolverJobRepositoryTest {

    @Inject
    SolverJobRepository solverJobRepository;

    @BeforeEach
    void setUp() {
        solverJobRepository.deleteAll();
    }

    @AfterEach
    void tearDown() {
        solverJobRepository.deleteAll();
    }

    @Test
    void saveAndLoadCurrentSolverJob() throws IOException {
        SolverJob job = newSolverJob(Status.SOLVING_ACTIVE);

        SolverJob saved = solverJobRepository.saveCurrent(job);
        SolverJob current = solverJobRepository.getCurrent();

        assertNotNull(saved.getId());
        assertNotNull(current);
        assertEquals(saved.getId(), current.getId());
        assertEquals(Status.SOLVING_ACTIVE, current.getStatus());
        assertTrue(solverJobRepository.exists());
        assertTrue(solverJobRepository.hasRunningJob());
        assertEquals(1, solverJobRepository.count());
        assertEquals(1, solverJobRepository.countByStatus(Status.SOLVING_ACTIVE));
        assertNotNull(solverJobRepository.findById(current.getId()));
    }

    @Test
    void saveCurrentSolverJobPersistsMatrixAndResetStatus() throws IOException {
        SolverJob job = newSolverJob(Status.SOLVING_ACTIVE);
        String fromPoiId = job.getPlan().getPois().get(0).getId();
        String toPoiId = job.getPlan().getPois().get(1).getId();
        TransitMatrix matrix = new TransitMatrix()
                .put(fromPoiId, toPoiId, new Transit(321L, 654L))
                .put(toPoiId, fromPoiId, new Transit(987L, 456L));
        job.getPlan().setMatrix(matrix);

        solverJobRepository.saveCurrent(job);
        solverJobRepository.resetStatus(Status.ERROR, List.of(Status.SOLVING_ACTIVE, Status.SOLVING_SCHEDULED));

        SolverJob current = solverJobRepository.getCurrent();
        assertNotNull(current);
        assertEquals(Status.ERROR, current.getStatus());
        assertFalse(solverJobRepository.hasRunningJob());
        assertEquals(321L, current.getPlan().getMatrix().get(fromPoiId, toPoiId).distance());
        assertEquals(654L, current.getPlan().getMatrix().get(fromPoiId, toPoiId).duration());
        assertEquals(987L, current.getPlan().getMatrix().get(toPoiId, fromPoiId).distance());
        assertEquals(456L, current.getPlan().getMatrix().get(toPoiId, fromPoiId).duration());
    }

    @Test
    void deleteCurrentSolverJobRemovesSingleton() throws IOException {
        solverJobRepository.saveCurrent(newSolverJob(Status.SOLVING_FINISHED));

        solverJobRepository.deleteCurrent();

        assertFalse(solverJobRepository.exists());
        assertEquals(0, solverJobRepository.count());
        assertNull(solverJobRepository.getCurrent());
    }

    @Test
    void updateJobPreservesEquivalentMetricsAcrossDifferentTimes() throws IOException {
        SolverJob job = newSolverJob(Status.SOLVING_SCHEDULED);
        job.getPlan().setScore(HardMediumSoftLongScore.parseScore("0hard/0medium/-100soft"));

        SolverJob saved = solverJobRepository.saveCurrent(job);
        solverJobRepository.updateJob(saved.getId(), saved.getPlan(), Status.SOLVING_ACTIVE, null,
                SolutionMetrics.RecordType.BEST_SOLUTION);
        solverJobRepository.updateJob(saved.getId(), saved.getPlan(), Status.SOLVING_ACTIVE, null,
                SolutionMetrics.RecordType.BEST_SOLUTION);
        solverJobRepository.updateJob(saved.getId(), saved.getPlan(), Status.SOLVING_FINISHED, "done",
                SolutionMetrics.RecordType.FINAL_SOLUTION);

        SolverJob current = solverJobRepository.getCurrent();
        assertNotNull(current);
        assertEquals(3, current.getSolutionMetricsList().size());
        SolutionMetrics firstMetrics = current.getSolutionMetricsList().get(0);
        SolutionMetrics secondMetrics = current.getSolutionMetricsList().get(1);
        SolutionMetrics thirdMetrics = current.getSolutionMetricsList().get(2);
        assertEquals(SolutionMetrics.RecordType.BEST_SOLUTION, firstMetrics.getRecordType());
        assertEquals(SolutionMetrics.RecordType.BEST_SOLUTION, secondMetrics.getRecordType());
        assertEquals(SolutionMetrics.RecordType.FINAL_SOLUTION, thirdMetrics.getRecordType());
        assertNotNull(firstMetrics.getRecordedAtMillis());
        assertNotNull(secondMetrics.getRecordedAtMillis());
        assertNotNull(thirdMetrics.getRecordedAtMillis());
        assertTrue(secondMetrics.getRecordedAtMillis() >= firstMetrics.getRecordedAtMillis());
        assertTrue(thirdMetrics.getRecordedAtMillis() >= secondMetrics.getRecordedAtMillis());
    }

    @Test
    void updateBestSolutionStoresOnlyStrictImprovementAndKeepsSearchSamplesIndependent() throws IOException {
        SolverJob saved = solverJobRepository.saveCurrent(newSolverJob(Status.SOLVING_SCHEDULED));
        RoutePlan first = saved.getPlan();
        first.setScore(HardMediumSoftLongScore.parseScore("0hard/0medium/-100soft"));

        assertEquals(SolverJobRepository.BestSolutionWriteResult.APPENDED,
                solverJobRepository.updateBestSolution(saved.getId(), first, 1_760_000_000_000L, 100L).result());
        assertEquals(SolverJobRepository.BestSolutionWriteResult.DUPLICATE,
                solverJobRepository.updateBestSolution(saved.getId(), first, 1_760_000_000_200L, 300L).result());

        RoutePlan improved = saved.getPlan();
        improved.setScore(HardMediumSoftLongScore.parseScore("0hard/0medium/-80soft"));
        assertEquals(SolverJobRepository.BestSolutionWriteResult.APPENDED,
                solverJobRepository.updateBestSolution(saved.getId(), improved, 1_760_000_000_500L, 600L).result());

        RoutePlan regressed = saved.getPlan();
        regressed.setScore(HardMediumSoftLongScore.parseScore("0hard/0medium/-120soft"));
        assertEquals(SolverJobRepository.BestSolutionWriteResult.REJECTED,
                solverJobRepository.updateBestSolution(saved.getId(), regressed, 1_760_000_000_700L, 800L).result());

        SolutionMetrics sample = SolutionMetrics.searchSample(
                new one.rewind.xforce.vehicle_routing.db.dto.SolverSearchProgress(
                        "0hard/0medium/-95soft", "0hard/0medium/-80soft"),
                1_760_000_001_000L,
                1_000L
        );
        assertTrue(solverJobRepository.appendSearchSample(saved.getId(), sample));

        SolverJob current = solverJobRepository.getCurrent();
        assertEquals(Status.SOLVING_ACTIVE, current.getStatus());
        assertEquals(3, current.getSolutionMetricsList().size());
        assertEquals(SolutionMetrics.RecordType.BEST_SOLUTION, current.getSolutionMetricsList().get(0).getRecordType());
        assertEquals(100L, current.getSolutionMetricsList().get(0).getElapsedMillis());
        assertEquals(SolutionMetrics.RecordType.BEST_SOLUTION, current.getSolutionMetricsList().get(1).getRecordType());
        assertEquals(SolutionMetrics.RecordType.SEARCH_SAMPLE, current.getSolutionMetricsList().get(2).getRecordType());
        assertEquals(1_000L, current.getSolutionMetricsList().get(2).getElapsedMillis());
    }

    @Test
    void updateJobAppendsDistinctMetrics() throws IOException {
        SolverJob job = newSolverJob(Status.SOLVING_SCHEDULED);
        job.getPlan().setScore(HardMediumSoftLongScore.parseScore("0hard/0medium/-100soft"));

        SolverJob saved = solverJobRepository.saveCurrent(job);
        solverJobRepository.updateJob(saved.getId(), saved.getPlan(), Status.SOLVING_ACTIVE, null,
                SolutionMetrics.RecordType.BEST_SOLUTION);

        saved.getPlan().setScore(HardMediumSoftLongScore.parseScore("0hard/0medium/-50soft"));
        solverJobRepository.updateJob(saved.getId(), saved.getPlan(), Status.SOLVING_FINISHED, "done",
                SolutionMetrics.RecordType.FINAL_SOLUTION);

        SolverJob current = solverJobRepository.getCurrent();
        assertNotNull(current);
        assertEquals(2, current.getSolutionMetricsList().size());
        assertEquals(SolutionMetrics.RecordType.BEST_SOLUTION, current.getSolutionMetricsList().get(0).getRecordType());
        assertEquals(SolutionMetrics.RecordType.FINAL_SOLUTION, current.getSolutionMetricsList().get(1).getRecordType());
    }

    @Test
    void updateJobOverloadInfersMetricRecordTypeFromStatus() throws IOException {
        SolverJob job = newSolverJob(Status.SOLVING_SCHEDULED);
        job.getPlan().setScore(HardMediumSoftLongScore.parseScore("0hard/0medium/-100soft"));

        SolverJob saved = solverJobRepository.saveCurrent(job);
        solverJobRepository.updateJob(saved.getId(), saved.getPlan(), Status.SOLVING_ACTIVE);

        saved.getPlan().setScore(HardMediumSoftLongScore.parseScore("0hard/0medium/-80soft"));
        solverJobRepository.updateJob(saved.getId(), saved.getPlan(), Status.SOLVING_FINISHED);

        SolverJob current = solverJobRepository.getCurrent();
        assertNotNull(current);
        assertEquals(Status.SOLVING_FINISHED, current.getStatus());
        assertEquals(2, current.getSolutionMetricsList().size());
        assertEquals(SolutionMetrics.RecordType.BEST_SOLUTION, current.getSolutionMetricsList().get(0).getRecordType());
        assertEquals(SolutionMetrics.RecordType.FINAL_SOLUTION, current.getSolutionMetricsList().get(1).getRecordType());
    }

    @Test
    void updateJobWithThrowableMarksJobAsError() throws IOException {
        SolverJob saved = solverJobRepository.saveCurrent(newSolverJob(Status.SOLVING_ACTIVE));

        solverJobRepository.updateJob(saved.getId(), new IllegalStateException("solver crashed"));

        SolverJob current = solverJobRepository.getCurrent();
        assertNotNull(current);
        assertEquals(Status.ERROR, current.getStatus());
        assertNotNull(current.getException());
        assertEquals("solver crashed", current.getException().getMessage());
        assertFalse(solverJobRepository.hasRunningJob());
    }

    @Test
    void updateJobWithThrowableIgnoresMissingJob() {
        assertDoesNotThrow(() -> solverJobRepository.updateJob(java.util.UUID.randomUUID(), new IllegalStateException("missing")));
        assertFalse(solverJobRepository.exists());
    }

    @Test
    void listAndDeleteByIdMaintainHistoryAndLatestPointer() throws IOException {
        SolverJob first = newSolverJob(Status.SOLVING_FINISHED);
        SolverJob second = newSolverJob(Status.ERROR);
        first.getPlan().setScore(HardMediumSoftLongScore.parseScore("0hard/-2medium/-100soft"));

        SolverJob savedFirst = solverJobRepository.saveCurrent(first);
        SolverJob savedSecond = solverJobRepository.saveCurrent(second);

        List<one.rewind.xforce.vehicle_routing.db.dto.SolverJobSummary> history = solverJobRepository.listAll();
        assertEquals(2, history.size());
        assertEquals(savedSecond.getId(), history.get(0).getId());
        assertEquals(savedFirst.getId(), history.get(1).getId());
        assertEquals(Duration.ofMinutes(15), history.get(0).getSolveTime());
        assertEquals("MANHATTAN", history.get(0).getMatrixMode());
        assertEquals(Boolean.TRUE, history.get(0).getBuildTransitMatrix());
        assertEquals(Boolean.FALSE, history.get(0).getDrawRoute());
        assertEquals("0hard/-2medium/-100soft", history.get(1).getScore());
        assertEquals(savedSecond.getId(), solverJobRepository.getCurrent().getId());
        assertNotNull(solverJobRepository.findById(savedFirst.getId()));

        solverJobRepository.deleteById(savedSecond.getId());

        assertEquals(1, solverJobRepository.count());
        assertEquals(savedFirst.getId(), solverJobRepository.getCurrent().getId());
        assertNull(solverJobRepository.findById(savedSecond.getId()));
    }

    @Test
    void listBackfillsScoresMissingFromLegacySummaryIndex() throws IOException {
        SolverJob job = newSolverJob(Status.SOLVING_FINISHED);
        job.getPlan().setScore(HardMediumSoftLongScore.parseScore("0hard/-3medium/-120soft"));
        solverJobRepository.saveCurrent(job);

        Path indexPath = Path.of("build/test-data/solver_jobs/index.json");
        String legacyIndex = Files.readString(indexPath, StandardCharsets.UTF_8)
                .replaceAll("(?m)^\\s*\\\"score\\\"\\s*:\\s*\\\"[^\\\"]+\\\",?\\R", "");
        Files.writeString(indexPath, legacyIndex, StandardCharsets.UTF_8);

        List<one.rewind.xforce.vehicle_routing.db.dto.SolverJobSummary> history = solverJobRepository.listAll();

        assertEquals("0hard/-3medium/-120soft", history.get(0).getScore());
        assertTrue(Files.readString(indexPath, StandardCharsets.UTF_8).contains("\"score\""));
    }

    @Test
    void resetStatusUpdatesMultipleRunningJobsWithoutConcurrentModification() throws IOException {
        SolverJob first = newSolverJob(Status.SOLVING_SCHEDULED);
        SolverJob second = newSolverJob(Status.SOLVING_ACTIVE);

        SolverJob savedFirst = solverJobRepository.saveCurrent(first);
        SolverJob savedSecond = solverJobRepository.saveCurrent(second);

        solverJobRepository.resetStatus(Status.NOT_SOLVING, List.of(Status.SOLVING_SCHEDULED, Status.SOLVING_ACTIVE));

        assertEquals(Status.NOT_SOLVING, solverJobRepository.findById(savedFirst.getId()).getStatus());
        assertEquals(Status.NOT_SOLVING, solverJobRepository.findById(savedSecond.getId()).getStatus());
        assertFalse(solverJobRepository.hasRunningJob());
    }

    @Test
    void resetStatusLeavesUnmatchedJobsUnchanged() throws IOException {
        SolverJob saved = solverJobRepository.saveCurrent(newSolverJob(Status.SOLVING_FINISHED));

        solverJobRepository.resetStatus(Status.NOT_SOLVING, List.of(Status.SOLVING_SCHEDULED, Status.SOLVING_ACTIVE));

        assertEquals(Status.SOLVING_FINISHED, solverJobRepository.findById(saved.getId()).getStatus());
    }

    @Test
    void deleteByIdIgnoresNullAndUnknownIds() throws IOException {
        SolverJob saved = solverJobRepository.saveCurrent(newSolverJob(Status.SOLVING_FINISHED));

        solverJobRepository.deleteById(null);
        solverJobRepository.deleteById(java.util.UUID.randomUUID());

        assertEquals(1, solverJobRepository.count());
        assertEquals(saved.getId(), solverJobRepository.getCurrent().getId());
    }

    @Test
    void findByIdKeepsJobJsonCoreFieldsWhenMetaFieldsAreNull() throws IOException {
        SolverJob saved = solverJobRepository.saveCurrent(newSolverJob(Status.SOLVING_FINISHED));
        Path metaPath = solverJobMetaPath(saved);
        Files.writeString(metaPath, "{\n  \"name\" : \"broken-meta\"\n}\n", StandardCharsets.UTF_8);

        SolverJob reloaded = solverJobRepository.findById(saved.getId());

        assertNotNull(reloaded);
        assertEquals(saved.getId(), reloaded.getId());
        assertEquals(Status.SOLVING_FINISHED, reloaded.getStatus());
        assertNotNull(reloaded.getCreateTime());
        assertNotNull(reloaded.getUpdateTime());
    }

    @Test
    void findByIdFallsBackToJobJsonWhenMetaFileIsMissing() throws IOException {
        SolverJob saved = solverJobRepository.saveCurrent(newSolverJob(Status.SOLVING_ACTIVE));
        Files.deleteIfExists(solverJobMetaPath(saved));

        SolverJob reloaded = solverJobRepository.findById(saved.getId());

        assertNotNull(reloaded);
        assertEquals(saved.getId(), reloaded.getId());
        assertEquals(Status.SOLVING_ACTIVE, reloaded.getStatus());
        assertNotNull(reloaded.getCreateTime());
        assertNotNull(reloaded.getUpdateTime());
    }

    private SolverJob newSolverJob(Status status) throws IOException {
        Scenario scenario = OM.fromJson(
                Files.readString(Path.of("src/test/resources/fixtures/scenarios/scen-3.json"), StandardCharsets.UTF_8),
                Scenario.class
        );

        SolverJob job = new SolverJob();
        job.setPlan(scenario.getPlan());
        job.setStatus(status);
        job.setSolveTime(Duration.ofMinutes(15));
        job.setMatrixMode("MANHATTAN");
        job.setBuildTransitMatrix(true);
        job.setDrawRoute(false);
        return job;
    }

    private Path solverJobMetaPath(SolverJob job) {
        return Path.of("build/test-data/solver_jobs/jobs", job.getId().toString(), "meta.json");
    }
}
