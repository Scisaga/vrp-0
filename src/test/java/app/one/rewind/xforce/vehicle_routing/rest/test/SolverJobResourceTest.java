package one.rewind.xforce.vehicle_routing.rest.test;

import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import jakarta.ws.rs.core.MediaType;
import io.restassured.response.Response;
import one.rewind.xforce.geo.POI;
import one.rewind.xforce.vehicle_routing.bootstrap.GeoUtil;
import one.rewind.xforce.json.OM;
import one.rewind.xforce.vehicle_routing.db.dto.Scenario;
import one.rewind.xforce.vehicle_routing.db.dto.SolverJob;
import one.rewind.xforce.vehicle_routing.db.repository.ScenarioRepository;
import one.rewind.xforce.vehicle_routing.db.repository.SolverJobRepository;
import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.exception.AgentOrTicketNotCompatible;
import one.rewind.xforce.vehicle_routing.rest.ScenarioResource;
import one.rewind.xforce.vehicle_routing.rest.SolverJobResource;
import one.rewind.xforce.vehicle_routing.rest.msg.Msg;
import one.rewind.xforce.vehicle_routing.service.SingletonOperationCoordinator;
import one.rewind.xforce.vehicle_routing.service.SolverService;
import one.rewind.xforce.vehicle_routing.service.VrpApplicationFacade;
import one.rewind.xforce.vehicle_routing.solver.Status;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;

import java.lang.reflect.Field;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static io.restassured.RestAssured.given;
import static org.hamcrest.CoreMatchers.equalTo;
import static org.hamcrest.CoreMatchers.notNullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.optaplanner.core.api.score.buildin.hardmediumsoftlong.HardMediumSoftLongScore.parseScore;

@QuarkusTest
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@Tag("app")
public class SolverJobResourceTest {

    @Inject
    ScenarioRepository scenarioRepository;

    @Inject
    SolverJobRepository solverJobRepository;

    @Test
    @Order(1)
    public void clearTables() {
        scenarioRepository.deleteAll();
        solverJobRepository.deleteAll();
    }

    @Test
    @Order(2)
    public void missingResourcesReturn404() {
        given()
                .when()
                .get("/solver_job")
                .then()
                .statusCode(404);

        given()
                .when()
                .post("/solver_job")
                .then()
                .statusCode(404)
                .body("message", equalTo("Scenario not found"));

        given()
                .when()
                .post("/solver_job/apply")
                .then()
                .statusCode(404);

        given()
                .when()
                .delete("/solver_job")
                .then()
                .statusCode(404);
    }

    @Test
    @Order(3)
    public void createScenario() throws IOException {
        String scenarioJson = Files.readString(Path.of("src/test/resources/fixtures/scenarios/scen-3.json"), StandardCharsets.UTF_8);

        given()
                .body(scenarioJson)
                .queryParam("build", true)
                .queryParam("matrix_mode", GeoUtil.MatrixMode.MANHATTAN)
                .header("Content-Type", MediaType.APPLICATION_JSON)
                .when()
                .put("/scenario")
                .then()
                .statusCode(200);
    }

    @Test
    @Order(4)
    public void invalidSolveTimeReturns400() {
        given()
                .queryParam("solve_time", "abc")
                .when()
                .post("/solver_job")
                .then()
                .statusCode(400)
                .body("message", equalTo("Invalid solve_time, expected ISO-8601 duration, e.g. PT30S"));
    }

    @Test
    @Order(5)
    public void scenarioWithoutMatrixReturns400() throws IOException {
        createScenario();
        saveFinishedCurrentJob();

        Scenario scenario = scenarioRepository.getCurrent();
        scenario.getPlan().setMatrix(null);
        scenarioRepository.saveCurrent(scenario);

        given()
                .when()
                .post("/solver_job")
                .then()
                .statusCode(400)
                .body("message", equalTo("Scenario transit matrix not built (try PUT /scenario?build=true)"));

        given()
                .when()
                .get("/solver_job")
                .then()
                .statusCode(200)
                .body("status", equalTo("SOLVING_FINISHED"));

        createScenario();
    }

    @Test
    @Order(6)
    public void scenarioWithoutPoiBuildKeepsCurrentSolverJob() throws IOException {
        createScenario();
        saveFinishedCurrentJob();

        Scenario scenario = scenarioRepository.getCurrent();
        scenario.getPlan().getDepos().get(0).setLoc(new POI("北京市", "北京市朝阳区阜通东大街6号院3号楼"));
        scenarioRepository.saveCurrent(scenario);

        given()
                .when()
                .post("/solver_job")
                .then()
                .statusCode(400)
                .body("message", equalTo("Scenario POI not built (try PUT /scenario?build=true)"));

        given()
                .when()
                .get("/solver_job")
                .then()
                .statusCode(200)
                .body("status", equalTo("SOLVING_FINISHED"));

        createScenario();
    }

    @Test
    @Order(7)
    public void testApplyScenario() {
        solverJobRepository.deleteAll();

        try {
            Scenario scenario = scenarioRepository.getCurrent();
            Scenario source = OM.fromJson(OM.toJson(scenario), Scenario.class);

            SolverJob job = new SolverJob();
            job.setPlan(source.getPlan());
            job.getPlan().setScore(parseScore("0hard/1medium/2soft"));
            job.setStatus(Status.SOLVING_FINISHED);
            solverJobRepository.saveCurrent(job);
        } catch (IOException e) {
            throw new RuntimeException(e);
        }

        given()
                .when()
                .post("/solver_job/apply")
                .then()
                .statusCode(200)
                .body("plan", notNullValue())
                .body("plan.score", equalTo("0hard/1medium/2soft"));

        given()
                .when()
                .get("/scenario")
                .then()
                .statusCode(200)
                .body("plan.score", equalTo("0hard/1medium/2soft"));
    }

    @Test
    @Order(8)
    public void applyAndDeleteAreSerializedByCoordinator() throws Exception {
        Scenario base = OM.fromJson(
                Files.readString(Path.of("src/test/resources/fixtures/scenarios/scen-3.json"), StandardCharsets.UTF_8),
                Scenario.class
        );
        BlockingScenario current = new BlockingScenario(OM.fromJson(OM.toJson(base), Scenario.class));
        SolverJob job = new SolverJob();
        job.setPlan(OM.fromJson(OM.toJson(base), Scenario.class).getPlan());
        job.setStatus(Status.SOLVING_FINISHED);

        InMemoryScenarioRepository localScenarioRepository = new InMemoryScenarioRepository(current);
        InMemorySolverJobRepository localSolverJobRepository = new InMemorySolverJobRepository();
        TestSolverService localSolverService = new TestSolverService(job, false);
        SingletonOperationCoordinator localCoordinator = new SingletonOperationCoordinator();
        VrpApplicationFacade localFacade = new VrpApplicationFacade();
        setField(localFacade, "scenarioRepository", localScenarioRepository);
        setField(localFacade, "solverJobRepository", localSolverJobRepository);
        setField(localFacade, "solverService", localSolverService);
        setField(localFacade, "coordinator", localCoordinator);

        SolverJobResource localSolverJobResource = new SolverJobResource();
        ScenarioResource localScenarioResource = new ScenarioResource();
        setField(localSolverJobResource, "facade", localFacade);
        setField(localScenarioResource, "facade", localFacade);

        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<Scenario> applyFuture = executor.submit(localSolverJobResource::applyToCurrentScenario);
            assertTrue(current.applyStarted.await(2, TimeUnit.SECONDS));

            Future<Msg> deleteFuture = executor.submit(localScenarioResource::deleteCurrent);
            Thread.sleep(200);
            assertFalse(deleteFuture.isDone());

            current.releaseApply.countDown();

            applyFuture.get(2, TimeUnit.SECONDS);
            deleteFuture.get(2, TimeUnit.SECONDS);

            assertNull(localScenarioRepository.getCurrent());
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    @Order(9)
    public void createAndExecuteSolverJob() throws InterruptedException, IOException {
        createScenario();

        given()
                .queryParam("solve_time", "PT5S")
                .queryParam("matrix_mode", GeoUtil.MatrixMode.MANHATTAN)
                .queryParam("build_transit_matrix", true)
                .queryParam("draw_route", true)
                .when()
                .post("/solver_job")
                .then()
                .statusCode(200)
                .body("status", equalTo("SOLVING_SCHEDULED"))
                .body("solve_time", equalTo("PT5S"))
                .body("matrix_mode", equalTo("MANHATTAN"))
                .body("build_transit_matrix", equalTo(true))
                .body("draw_route", equalTo(true));

        given()
                .queryParam("solve_time", "PT5S")
                .when()
                .post("/solver_job")
                .then()
                .statusCode(409)
                .body("message", equalTo("Solver job is already running, queueing is not supported"));

        given()
                .when()
                .get("/solver_job")
                .then()
                .statusCode(200)
                .body("plan", notNullValue());
    }

    @Test
    @Order(10)
    public void terminateCurrentSolverJob() throws InterruptedException {
        given()
                .when()
                .post("/solver_job/terminate")
                .then()
                .statusCode(200)
                .body("status", notNullValue());

        Thread.sleep(1000);

        Response response = given()
                .when()
                .get("/solver_job");
        int statusCode = response.statusCode();
        if (statusCode == 200) {
            String status = response.jsonPath().getString("status");
            if (status == null || status.isBlank()) {
                throw new AssertionError("Solver job status is empty after terminate");
            }
            return;
        }
        if (statusCode == 500) {
            String message = response.jsonPath().getString("message");
            if (message == null || message.isBlank()) {
                throw new AssertionError("Solver job error message is empty after terminate");
            }
            return;
        }
        throw new AssertionError("Unexpected status code after terminate: " + statusCode);
    }

    @Test
    @Order(11)
    public void terminateFinishedSolverJobReturns400() {
        solverJobRepository.deleteAll();

        SolverJob job = new SolverJob();
        job.setStatus(Status.SOLVING_FINISHED);
        solverJobRepository.saveCurrent(job);

        given()
                .when()
                .post("/solver_job/terminate")
                .then()
                .statusCode(400)
                .body("message", equalTo("RoutePlan not solving"));
    }

    @Test
    @Order(12)
    public void deleteSolverJob() {
        solverJobRepository.deleteAll();

        SolverJob job = new SolverJob();
        job.setStatus(Status.SOLVING_FINISHED);
        solverJobRepository.saveCurrent(job);

        given()
                .when()
                .delete("/solver_job")
                .then()
                .statusCode(200);

        given()
                .when()
                .get("/solver_job")
                .then()
                .statusCode(404);

        given()
                .when()
                .delete("/solver_job")
                .then()
                .statusCode(404);
    }

    @Test
    @Order(13)
    public void listGetAndDeleteSolverJobHistoryById() throws IOException {
        createScenario();
        solverJobRepository.deleteAll();

        SolverJob firstJob = saveFinishedJob();
        SolverJob secondJob = saveFinishedJob();

        Response listResponse = given()
                .when()
                .get("/solver_job/list");
        listResponse.then()
                .statusCode(200);

        List<String> ids = listResponse.jsonPath().getList("id");
        assertNotNull(ids);
        assertTrue(ids.contains(firstJob.getId().toString()));
        assertTrue(ids.contains(secondJob.getId().toString()));
        assertEquals(secondJob.getId().toString(), ids.get(0));

        given()
                .when()
                .get("/solver_job/" + firstJob.getId())
                .then()
                .statusCode(200)
                .body("id", equalTo(firstJob.getId().toString()));

        given()
                .when()
                .delete("/solver_job/" + secondJob.getId())
                .then()
                .statusCode(200);

        given()
                .when()
                .get("/solver_job")
                .then()
                .statusCode(200)
                .body("id", equalTo(firstJob.getId().toString()));
    }

    @Test
    @Order(14)
    public void getSolverJobByIdKeepsCoreFieldsWhenMetaFieldsAreNull() throws IOException {
        createScenario();
        solverJobRepository.deleteAll();
        SolverJob job = saveFinishedJob();
        Files.writeString(
                solverJobMetaPath(job),
                "{\n  \"name\" : \"broken-meta\"\n}\n",
                StandardCharsets.UTF_8
        );

        given()
                .when()
                .get("/solver_job/" + job.getId())
                .then()
                .statusCode(200)
                .body("id", equalTo(job.getId().toString()))
                .body("status", equalTo("SOLVING_FINISHED"))
                .body("create_time", notNullValue())
                .body("update_time", notNullValue());
    }

    @Test
    @Order(15)
    public void listSolverJobsSupportsServerSideFilters() throws IOException {
        createScenario();
        solverJobRepository.deleteAll();

        SolverJob first = saveSummaryJob(
                Status.SOLVING_FINISHED,
                LocalDateTime.of(2026, 7, 16, 10, 0),
                "AMAP",
                true,
                false
        );
        SolverJob second = saveSummaryJob(
                Status.ERROR,
                LocalDateTime.of(2026, 7, 16, 11, 0),
                "MANHATTAN",
                false,
                true
        );
        SolverJob third = saveSummaryJob(
                Status.SOLVING_FINISHED,
                LocalDateTime.of(2026, 7, 16, 12, 0),
                "AMAP",
                true,
                true
        );

        given()
                .queryParam("status", "SOLVING_FINISHED")
                .when()
                .get("/solver_job/list")
                .then()
                .statusCode(200)
                .body("id", equalTo(List.of(third.getId().toString(), first.getId().toString())))
                .body("score", equalTo(List.of("0hard/-1medium/-2soft", "0hard/-1medium/-2soft")));

        given()
                .queryParam("matrix_mode", "manhattan")
                .queryParam("build_transit_matrix", false)
                .queryParam("draw_route", true)
                .when()
                .get("/solver_job/list")
                .then()
                .statusCode(200)
                .body("id", equalTo(List.of(second.getId().toString())));

        given()
                .queryParam("create_time_from", "2026-07-16T12:00:00")
                .queryParam("create_time_to", "2026-07-16T12:00:00")
                .queryParam("status", "SOLVING_FINISHED")
                .queryParam("build_transit_matrix", true)
                .queryParam("draw_route", true)
                .when()
                .get("/solver_job/list")
                .then()
                .statusCode(200)
                .body("id", equalTo(List.of(third.getId().toString())));

        given()
                .queryParam("status", "UNKNOWN")
                .when()
                .get("/solver_job/list")
                .then()
                .statusCode(400);

        given()
                .queryParam("matrix_mode", "EUCLIDEAN")
                .when()
                .get("/solver_job/list")
                .then()
                .statusCode(400);

        given()
                .queryParam("create_time_from", "2026-07-16")
                .when()
                .get("/solver_job/list")
                .then()
                .statusCode(400);

        given()
                .queryParam("create_time_from", "2026-07-17T00:00:00")
                .queryParam("create_time_to", "2026-07-16T00:00:00")
                .when()
                .get("/solver_job/list")
                .then()
                .statusCode(400);

        given()
                .queryParam("draw_route", "yes")
                .when()
                .get("/solver_job/list")
                .then()
                .statusCode(400);
    }

    @Test
    @Order(16)
    public void deleteScenarioClearsSolverJobHistory() throws IOException {
        createScenario();
        solverJobRepository.deleteAll();
        saveFinishedJob();

        given()
                .when()
                .delete("/scenario")
                .then()
                .statusCode(200);

        given()
                .when()
                .get("/solver_job/list")
                .then()
                .statusCode(200)
                .body("$", equalTo(List.of()));
    }

    @Test
    @Order(17)
    public void ticketWithoutTypeIsRejectedBeforeSolving() throws IOException {
        createScenario();
        solverJobRepository.deleteAll();

        Scenario scenario = scenarioRepository.getCurrent();
        scenario.getPlan().getTickets().getFirst().setType(null);
        scenarioRepository.saveCurrent(scenario);

        given()
                .when()
                .post("/solver_job")
                .then()
                .statusCode(400)
                .body("error_code", equalTo("invalid_argument"))
                .body("error_params.field", equalTo("plan.tickets[0].type"))
                .body("error_params.rule", equalTo("required"))
                .body("message", equalTo("Ticket type is required: ticket-240407-0-d"));

        given()
                .when()
                .get("/solver_job")
                .then()
                .statusCode(404);
    }

    private void saveFinishedCurrentJob() throws IOException {
        solverJobRepository.deleteAll();

        Scenario scenario = scenarioRepository.getCurrent();
        Scenario source = OM.fromJson(OM.toJson(scenario), Scenario.class);

        SolverJob job = new SolverJob();
        job.setPlan(source.getPlan());
        job.setStatus(Status.SOLVING_FINISHED);
        job.setSolveTime(java.time.Duration.ofSeconds(45));
        job.setMatrixMode("AMAP");
        job.setBuildTransitMatrix(true);
        job.setDrawRoute(false);
        solverJobRepository.saveCurrent(job);
    }

    private SolverJob saveFinishedJob() throws IOException {
        Scenario scenario = scenarioRepository.getCurrent();
        Scenario source = OM.fromJson(OM.toJson(scenario), Scenario.class);

        SolverJob job = new SolverJob();
        job.setPlan(source.getPlan());
        job.setStatus(Status.SOLVING_FINISHED);
        job.setSolveTime(java.time.Duration.ofSeconds(45));
        job.setMatrixMode("AMAP");
        job.setBuildTransitMatrix(true);
        job.setDrawRoute(false);
        return solverJobRepository.saveCurrent(job);
    }

    private SolverJob saveSummaryJob(
            Status status,
            LocalDateTime createTime,
            String matrixMode,
            boolean buildTransitMatrix,
            boolean drawRoute
    ) throws IOException {
        Scenario scenario = scenarioRepository.getCurrent();
        Scenario source = OM.fromJson(OM.toJson(scenario), Scenario.class);
        SolverJob job = new SolverJob();
        job.setPlan(source.getPlan());
        job.getPlan().setScore(parseScore("0hard/-1medium/-2soft"));
        job.setStatus(status);
        job.setSolveTime(java.time.Duration.ofSeconds(45));
        job.setMatrixMode(matrixMode);
        job.setBuildTransitMatrix(buildTransitMatrix);
        job.setDrawRoute(drawRoute);
        job.setCreateTime(createTime);
        job.setUpdateTime(createTime);
        return solverJobRepository.saveCurrent(job);
    }

    private Path solverJobMetaPath(SolverJob job) {
        return Path.of("build/test-data/solver_jobs/jobs", job.getId().toString(), "meta.json");
    }

    private static void setField(Object target, String fieldName, Object value) throws Exception {
        Field field = target.getClass().getDeclaredField(fieldName);
        field.setAccessible(true);
        field.set(target, value);
    }

    private static final class BlockingScenario extends Scenario {
        private final CountDownLatch applyStarted = new CountDownLatch(1);
        private final CountDownLatch releaseApply = new CountDownLatch(1);

        private BlockingScenario(Scenario source) {
            setId(source.getId());
            setName(source.getName());
            setDesc(source.getDesc());
            setPlanningDate(source.getPlanningDate());
            setStartTime(source.getStartTime());
            setEndTime(source.getEndTime());
            setPlan(source.getPlan());
            setCreateTime(source.getCreateTime());
            setUpdateTime(source.getUpdateTime());
        }

        @Override
        public Scenario applyRoutePlan(RoutePlan rp) throws AgentOrTicketNotCompatible {
            applyStarted.countDown();
            await(releaseApply);
            return super.applyRoutePlan(rp);
        }
    }

    private static final class InMemoryScenarioRepository extends ScenarioRepository {
        private final AtomicReference<Scenario> current;

        private InMemoryScenarioRepository(Scenario initialScenario) {
            this.current = new AtomicReference<>(initialScenario);
        }

        @Override
        public Scenario getCurrent() {
            return current.get();
        }

        @Override
        public Scenario saveCurrent(Scenario scenario) {
            current.set(scenario);
            return scenario;
        }

        @Override
        public boolean exists() {
            return current.get() != null;
        }

        @Override
        public boolean deleteCurrent() {
            return current.getAndSet(null) != null;
        }
    }

    private static final class InMemorySolverJobRepository extends SolverJobRepository {
        @Override
        public void deleteCurrent() {
        }

        @Override
        public void deleteAll() {
        }
    }

    private static final class TestSolverService extends SolverService {
        private final SolverJob currentJob;
        private final boolean runningJob;

        private TestSolverService(SolverJob currentJob, boolean runningJob) {
            super(null, null);
            this.currentJob = currentJob;
            this.runningJob = runningJob;
        }

        @Override
        public SolverJob getCurrentSolverJobAndCheckForExceptions() {
            return currentJob;
        }

        @Override
        public boolean hasRunningJob() {
            return runningJob;
        }
    }

    private static void await(CountDownLatch latch) {
        try {
            assertTrue(latch.await(2, TimeUnit.SECONDS));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AssertionError("Interrupted while waiting for test latch", e);
        }
    }
}
