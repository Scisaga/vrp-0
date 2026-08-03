package one.rewind.xforce.vehicle_routing.service;

import jakarta.ws.rs.core.Response;
import one.rewind.xforce.vehicle_routing.db.dto.SolutionMetrics;
import one.rewind.xforce.vehicle_routing.db.dto.SolverJob;
import one.rewind.xforce.vehicle_routing.db.repository.SolverJobRepository;
import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.io.DeployUtilBean;
import one.rewind.xforce.vehicle_routing.rest.exception.SolverJobException;
import one.rewind.xforce.vehicle_routing.solver.Status;
import org.apache.logging.log4j.core.impl.ThrowableProxy;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.optaplanner.core.api.score.ScoreExplanation;
import org.optaplanner.core.api.score.buildin.hardmediumsoftlong.HardMediumSoftLongScore;
import org.optaplanner.core.api.solver.SolutionManager;
import org.optaplanner.core.api.solver.SolverManager;
import org.optaplanner.core.api.solver.SolverStatus;

import java.lang.reflect.Field;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SolverServiceLifecycleTest {

    private SolverService service;

    @AfterEach
    void shutdownScheduler() {
        if (service != null) {
            service.ses.shutdownNow();
            service.progressSamplingFutures.values().forEach(future -> future.cancel(false));
            service.scheduledFutures.values().forEach(future -> future.cancel(false));
        }
    }

    @Test
    void getSolverJobAndCheckForExceptionsUsesCurrentJobWhenIdIsNull() throws Exception {
        FakeSolverJobRepository repository = new FakeSolverJobRepository();
        SolverJob current = job(UUID.randomUUID(), Status.NOT_SOLVING, new RoutePlan());
        repository.current = current;
        service = service(repository, new SolverManagerStub());

        SolverJob result = service.getSolverJobAndCheckForExceptions(null);

        assertSame(current, result);
    }

    @Test
    void getSolverJobAndCheckForExceptionsRejectsMissingJob() throws Exception {
        service = service(new FakeSolverJobRepository(), new SolverManagerStub());

        SolverJobException exception = assertThrows(
                SolverJobException.class,
                () -> service.getSolverJobAndCheckForExceptions(UUID.randomUUID())
        );

        assertEquals(Response.Status.NOT_FOUND, exception.getStatus());
        assertEquals("No SolverJob found", exception.getMessage());
        assertFalse(exception.shouldLogStackTrace());
    }

    @Test
    void getSolverJobAndCheckForExceptionsUsesNestedThrowableMessage() throws Exception {
        UUID jobId = UUID.randomUUID();
        FakeSolverJobRepository repository = new FakeSolverJobRepository();
        SolverJob failed = job(jobId, Status.ERROR, new RoutePlan());
        failed.setException(new ThrowableProxy(new RuntimeException("outer", new IllegalStateException("root cause"))));
        repository.jobs.put(jobId, failed);
        service = service(repository, new SolverManagerStub());

        SolverJobException exception = assertThrows(
                SolverJobException.class,
                () -> service.getSolverJobAndCheckForExceptions(jobId)
        );

        assertEquals(Response.Status.INTERNAL_SERVER_ERROR, exception.getStatus());
        assertEquals("root cause", exception.getMessage());
    }

    @Test
    void hasRunningJobUsesStoredStatusBeforeConsultingSolverManager() throws Exception {
        UUID activeId = UUID.randomUUID();
        FakeSolverJobRepository repository = new FakeSolverJobRepository();
        SolverManagerStub solverManager = new SolverManagerStub();
        service = service(repository, solverManager);

        assertFalse(service.hasRunningJob());

        repository.current = job(activeId, Status.SOLVING_SCHEDULED, new RoutePlan());
        assertTrue(service.hasRunningJob());

        repository.current = job(activeId, Status.NOT_SOLVING, new RoutePlan());
        solverManager.statuses.put(activeId, SolverStatus.NOT_SOLVING);
        assertFalse(service.hasRunningJob());

        solverManager.statuses.put(activeId, SolverStatus.SOLVING_ACTIVE);
        assertTrue(service.hasRunningJob());
    }

    @Test
    void stopRejectsNotSolvingJobAndTerminatesActiveJob() throws Exception {
        UUID jobId = UUID.randomUUID();
        FakeSolverJobRepository repository = new FakeSolverJobRepository();
        SolverJob active = job(jobId, Status.SOLVING_ACTIVE, new RoutePlan());
        repository.jobs.put(jobId, active);
        SolverManagerStub solverManager = new SolverManagerStub();
        service = service(repository, solverManager);

        solverManager.statuses.put(jobId, SolverStatus.NOT_SOLVING);
        SolverJobException exception = assertThrows(SolverJobException.class, () -> service.stop(jobId));
        assertEquals(Response.Status.BAD_REQUEST, exception.getStatus());
        assertEquals("RoutePlan not solving", exception.getMessage());
        assertFalse(solverManager.terminated.containsKey(jobId));

        solverManager.statuses.put(jobId, SolverStatus.SOLVING_ACTIVE);
        SolverJob result = service.stop(jobId);

        assertSame(active, result);
        assertTrue(solverManager.terminated.containsKey(jobId));
    }

    @Test
    void stopCurrentTerminatesCurrentJob() throws Exception {
        UUID jobId = UUID.randomUUID();
        FakeSolverJobRepository repository = new FakeSolverJobRepository();
        SolverJob current = job(jobId, Status.SOLVING_ACTIVE, new RoutePlan());
        repository.current = current;
        repository.jobs.put(jobId, current);
        SolverManagerStub solverManager = new SolverManagerStub();
        solverManager.statuses.put(jobId, SolverStatus.SOLVING_ACTIVE);
        service = service(repository, solverManager);

        SolverJob result = service.stopCurrent();

        assertSame(current, result);
        assertTrue(solverManager.terminated.containsKey(jobId));
    }

    @Test
    void deleteRejectsRunningJobAndDeletesStoppedJob() throws Exception {
        UUID jobId = UUID.randomUUID();
        FakeSolverJobRepository repository = new FakeSolverJobRepository();
        SolverManagerStub solverManager = new SolverManagerStub();
        service = service(repository, solverManager);

        solverManager.statuses.put(jobId, SolverStatus.SOLVING_SCHEDULED);
        SolverJobException exception = assertThrows(SolverJobException.class, () -> service.delete(jobId));
        assertEquals(Response.Status.BAD_REQUEST, exception.getStatus());
        assertEquals("Terminate SolverJob first", exception.getMessage());
        assertNull(repository.deletedId);

        solverManager.statuses.put(jobId, SolverStatus.NOT_SOLVING);
        service.delete(jobId);

        assertEquals(jobId, repository.deletedId);
    }

    @Test
    void deleteCurrentDeletesStoppedCurrentJob() throws Exception {
        UUID jobId = UUID.randomUUID();
        FakeSolverJobRepository repository = new FakeSolverJobRepository();
        SolverJob current = job(jobId, Status.NOT_SOLVING, new RoutePlan());
        repository.current = current;
        repository.jobs.put(jobId, current);
        SolverManagerStub solverManager = new SolverManagerStub();
        solverManager.statuses.put(jobId, SolverStatus.NOT_SOLVING);
        service = service(repository, solverManager);

        service.deleteCurrent();

        assertEquals(jobId, repository.deletedId);
        assertNull(repository.current);
    }

    @Test
    void solveInitializesJobSavesScheduledStatusAndStartsSampling() throws Exception {
        FakeSolverJobRepository repository = new FakeSolverJobRepository();
        SolverManagerStub solverManager = new SolverManagerStub();
        service = service(repository, solverManager);
        SolverJob job = new SolverJob();
        job.setId(null);
        job.setCreateTime(null);
        job.setUpdateTime(null);
        job.setPlan(new RoutePlan());
        job.setSolveTime(Duration.ofSeconds(5));

        SolverJob result = service.solve(job, false, null);

        assertSame(job, result);
        assertNotNull(result.getId());
        assertNotNull(result.getCreateTime());
        assertNotNull(result.getUpdateTime());
        assertEquals(Status.SOLVING_SCHEDULED, result.getStatus());
        assertSame(result, repository.current);
        assertEquals(result.getId(), solverManager.solveAndListenJobId);
        assertNull(repository.updatedJobId);
        assertTrue(service.progressSamplingFutures.containsKey(result.getId()));
        assertTrue(service.scheduledFutures.containsKey(result.getId()));
    }

    @Test
    void recordSearchSampleWritesOnlySearchSnapshotsForActiveSolver() throws Exception {
        UUID jobId = UUID.randomUUID();
        FakeSolverJobRepository repository = new FakeSolverJobRepository();
        SolverManagerStub solverManager = new SolverManagerStub();
        service = service(repository, solverManager);

        assertFalse(recordSearchSample(service, jobId));

        repository.jobs.put(jobId, job(jobId, Status.NOT_SOLVING, new RoutePlan()));
        assertFalse(recordSearchSample(service, jobId));

        repository.jobs.put(jobId, job(jobId, Status.SOLVING_SCHEDULED, new RoutePlan()));
        solverManager.statuses.put(jobId, SolverStatus.SOLVING_SCHEDULED);
        assertTrue(recordSearchSample(service, jobId));
        assertNull(repository.updatedJobId);

        SolverJob active = job(jobId, Status.SOLVING_ACTIVE, new RoutePlan());
        repository.jobs.put(jobId, active);
        solverManager.statuses.put(jobId, SolverStatus.SOLVING_ACTIVE);
        assertTrue(recordSearchSample(service, jobId));

        assertNull(repository.updatedJobId);
        assertNull(repository.searchSample);
    }

    @Test
    void solveRecordsBestSolutionOnlyWhenSolverEmitsBestSolution() throws Exception {
        FakeSolverJobRepository repository = new FakeSolverJobRepository();
        SolverManagerStub solverManager = new SolverManagerStub();
        service = service(repository, solverManager);
        SolverJob job = new SolverJob();
        job.setPlan(new RoutePlan());
        job.setSolveTime(Duration.ofSeconds(5));

        SolverJob result = service.solve(job, false, null);
        assertNull(repository.updatedJobId);

        RoutePlan bestSolution = new RoutePlan();
        solverManager.bestSolutionConsumer.accept(bestSolution);

        assertEquals(result.getId(), repository.updatedJobId);
        assertSame(bestSolution, repository.updatedPlan);
        assertEquals(Status.SOLVING_ACTIVE, repository.updatedStatus);
        assertEquals(SolutionMetrics.RecordType.BEST_SOLUTION, repository.updatedRecordType);
    }

    @Test
    void solvePersistsJobBeforeStartingSolverSoImmediateBestSolutionIsRecorded() throws Exception {
        FakeSolverJobRepository repository = new FakeSolverJobRepository();
        SolverManagerStub solverManager = new SolverManagerStub();
        RoutePlan immediateBestSolution = new RoutePlan();
        solverManager.immediateBestSolution = immediateBestSolution;
        service = service(repository, solverManager);
        SolverJob job = new SolverJob();
        job.setPlan(new RoutePlan());
        job.setSolveTime(Duration.ofSeconds(5));

        SolverJob result = service.solve(job, false, null);

        assertSame(result, repository.current);
        assertEquals(result.getId(), repository.updatedJobId);
        assertSame(immediateBestSolution, repository.updatedPlan);
        assertEquals(Status.SOLVING_ACTIVE, repository.current.getStatus());
        assertEquals(SolutionMetrics.RecordType.BEST_SOLUTION, repository.updatedRecordType);
    }

    @Test
    void solveCleansProgressResourcesWhenSolverRegistrationFailsSynchronously() throws Exception {
        FakeSolverJobRepository repository = new FakeSolverJobRepository();
        SolverManagerStub solverManager = new SolverManagerStub();
        solverManager.throwOnSolveAndListen = true;
        service = service(repository, solverManager);
        SolverJob job = new SolverJob();
        job.setPlan(new RoutePlan());
        job.setSolveTime(Duration.ofSeconds(5));

        assertThrows(IllegalStateException.class, () -> service.solve(job, false, null));

        assertTrue(service.progressSamplingFutures.isEmpty());
        assertTrue(service.scheduledFutures.isEmpty());
        assertEquals("solver registration failed", repository.updateError.getMessage());
    }

    private static SolverService service(FakeSolverJobRepository repository, SolverManagerStub solverManager) throws Exception {
        SolverService solverService = new SolverService(solverManager.proxy(), solutionManager());
        setField(solverService, "solverJobRepository", repository);
        DeployUtilBean deployUtilBean = new DeployUtilBean();
        deployUtilBean.maxSolveTime = Duration.ofMinutes(10);
        setField(solverService, "deployUtilBean", deployUtilBean);
        return solverService;
    }

    private static SolverJob job(UUID id, Status status, RoutePlan plan) {
        SolverJob job = new SolverJob();
        job.setId(id);
        job.setStatus(status);
        job.setPlan(plan);
        job.setCreateTime(LocalDateTime.of(2026, 1, 2, 8, 0));
        job.setUpdateTime(LocalDateTime.of(2026, 1, 2, 8, 0));
        return job;
    }

    private static boolean recordSearchSample(SolverService service, UUID jobId) throws Exception {
        Method method = SolverService.class.getDeclaredMethod("recordSearchSample", UUID.class);
        method.setAccessible(true);
        return (boolean) method.invoke(service, jobId);
    }

    private static void setField(Object target, String fieldName, Object value) throws Exception {
        Field field = target.getClass().getDeclaredField(fieldName);
        field.setAccessible(true);
        field.set(target, value);
    }

    @SuppressWarnings("unchecked")
    private static SolutionManager<RoutePlan, HardMediumSoftLongScore> solutionManager() {
        InvocationHandler handler = (proxy, method, args) -> {
            if ("explain".equals(method.getName())) {
                return Proxy.newProxyInstance(
                        ScoreExplanation.class.getClassLoader(),
                        new Class<?>[]{ScoreExplanation.class},
                        (explainProxy, explainMethod, explainArgs) ->
                                "getSummary".equals(explainMethod.getName()) ? "summary" : null
                );
            }
            return null;
        };
        return (SolutionManager<RoutePlan, HardMediumSoftLongScore>) Proxy.newProxyInstance(
                SolutionManager.class.getClassLoader(),
                new Class<?>[]{SolutionManager.class},
                handler
        );
    }

    private static class FakeSolverJobRepository extends SolverJobRepository {
        private final Map<UUID, SolverJob> jobs = new HashMap<>();
        private SolverJob current;
        private UUID deletedId;
        private UUID updatedJobId;
        private RoutePlan updatedPlan;
        private Status updatedStatus;
        private SolutionMetrics.RecordType updatedRecordType;
        private SolutionMetrics searchSample;
        private Throwable updateError;

        @Override
        public SolverJob getCurrent() {
            return current;
        }

        @Override
        public SolverJob findById(UUID id) {
            return id == null ? current : jobs.get(id);
        }

        @Override
        public SolverJob saveCurrent(SolverJob job) {
            current = job;
            jobs.put(job.getId(), job);
            return job;
        }

        @Override
        public SolverJob updateJob(UUID jobId, RoutePlan plan, Status status, String scoreExplanation, SolutionMetrics.RecordType recordType) {
            updatedJobId = jobId;
            updatedPlan = plan;
            updatedStatus = status;
            updatedRecordType = recordType;
            SolverJob job = jobs.get(jobId);
            if (job != null) {
                job.setPlan(plan);
                job.setStatus(status);
            }
            return job;
        }

        @Override
        public BestSolutionUpdate updateBestSolution(UUID jobId, RoutePlan plan, long recordedAtMillis, long elapsedMillis) {
            updatedJobId = jobId;
            updatedPlan = plan;
            updatedStatus = Status.SOLVING_ACTIVE;
            updatedRecordType = SolutionMetrics.RecordType.BEST_SOLUTION;
            SolverJob job = jobs.get(jobId);
            if (job != null) {
                job.setPlan(plan);
                job.setStatus(Status.SOLVING_ACTIVE);
            }
            return new BestSolutionUpdate(job, BestSolutionWriteResult.APPENDED);
        }

        @Override
        public boolean appendSearchSample(UUID jobId, SolutionMetrics sample) {
            searchSample = sample;
            return true;
        }

        @Override
        public void updateJob(UUID jobId, Throwable error) {
            updateError = error;
            SolverJob job = jobs.get(jobId);
            if (job != null) {
                job.setStatus(Status.ERROR);
            }
        }

        @Override
        public void deleteAndRelatedItems(UUID id) {
            deletedId = id;
            jobs.remove(id);
            if (current != null && id.equals(current.getId())) {
                current = null;
            }
        }
    }

    private static class SolverManagerStub implements InvocationHandler {
        private final Map<UUID, SolverStatus> statuses = new HashMap<>();
        private final Map<UUID, Boolean> terminated = new HashMap<>();
        private UUID solveAndListenJobId;
        private Consumer<RoutePlan> bestSolutionConsumer;
        private RoutePlan immediateBestSolution;
        private boolean throwOnSolveAndListen;

        @SuppressWarnings("unchecked")
        private SolverManager<RoutePlan, UUID> proxy() {
            return (SolverManager<RoutePlan, UUID>) Proxy.newProxyInstance(
                    SolverManager.class.getClassLoader(),
                    new Class<?>[]{SolverManager.class},
                    this
            );
        }

        @Override
        @SuppressWarnings("unchecked")
        public Object invoke(Object proxy, Method method, Object[] args) {
            return switch (method.getName()) {
                case "getSolverStatus" -> statuses.getOrDefault((UUID) args[0], SolverStatus.NOT_SOLVING);
                case "terminateEarly" -> {
                    terminated.put((UUID) args[0], true);
                    yield null;
                }
                case "solveAndListen" -> {
                    if (throwOnSolveAndListen) {
                        throw new IllegalStateException("solver registration failed");
                    }
                    solveAndListenJobId = (UUID) args[0];
                    bestSolutionConsumer = (Consumer<RoutePlan>) args[2];
                    if (immediateBestSolution != null) {
                        bestSolutionConsumer.accept(immediateBestSolution);
                    }
                    yield null;
                }
                case "addProblemChange" -> CompletableFuture.completedFuture(null);
                case "close" -> null;
                default -> null;
            };
        }
    }
}
