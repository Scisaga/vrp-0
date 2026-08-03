package one.rewind.xforce.vehicle_routing.remote.test;

import io.restassured.RestAssured;
import io.restassured.response.Response;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import jakarta.ws.rs.core.MediaType;
import one.rewind.xforce.vehicle_routing.db.repository.ScenarioRepository;
import one.rewind.xforce.vehicle_routing.db.repository.SolverJobRepository;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static io.restassured.RestAssured.given;
import static org.hamcrest.CoreMatchers.notNullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

@Tag("external")
@QuarkusTest
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
public class ScenarioCreateFromJsonFileTest {

    @BeforeAll
    static void requireExternalTestsEnabled() {
        one.rewind.xforce.test.support.ExternalTestSupport.requireExternalTestsEnabled();
    }

    private static final String DEFAULT_BODY_PATH = "src/test/resources/fixtures/scenarios/json1.json";
    private static final boolean DEFAULT_BUILD = true;
    private static final String DEFAULT_MATRIX_MODE = "MANHATTAN";
    private static final String DEFAULT_SOLVE_TIME = "PT5S";
    private static final long DEFAULT_WAIT_TIMEOUT_MS = 120_000L;
    private static final long DEFAULT_POLL_INTERVAL_MS = 1_000L;

    @Inject
    ScenarioRepository scenarioRepository;

    @Inject
    SolverJobRepository solverJobRepository;

    @BeforeEach
    void resetState() {
        solverJobRepository.deleteAll();
        scenarioRepository.deleteAll();
    }

    @Test
    @Order(1)
    public void createScenarioFromJsonFile() throws Exception {
        createScenario();
    }

    @Test
    @Order(2)
    public void solveCurrentScenarioAfterCreate() throws Exception {
        createScenario();
        solveCurrentScenario();
    }

    public static void main(String[] args) throws Exception {
        ScenarioCreateFromJsonFileTest test = new ScenarioCreateFromJsonFileTest();
        test.createScenario();
        test.solveCurrentScenario();
    }

    private void createScenario() throws Exception {
        Path bodyFile = Path.of(getProperty("vrp.scenario.bodyPath", "VRP_SCENARIO_BODY_PATH", DEFAULT_BODY_PATH));
        Assumptions.assumeTrue(Files.exists(bodyFile), "Scenario body file not found: " + bodyFile.toAbsolutePath());

        configureRestAssuredIfConfigured();

        boolean build = Boolean.parseBoolean(
                getProperty("vrp.scenario.build", "VRP_SCENARIO_BUILD", Boolean.toString(DEFAULT_BUILD))
        );
        String matrixMode = getProperty("vrp.scenario.matrixMode", "VRP_SCENARIO_MATRIX_MODE", DEFAULT_MATRIX_MODE);
        String scenarioJson = Files.readString(bodyFile, StandardCharsets.UTF_8);

        long start = System.currentTimeMillis();
        System.out.println("scenario create start: " + start + ", body=" + bodyFile.toAbsolutePath());

        String response = given()
                .header("Content-Type", MediaType.APPLICATION_JSON)
                .header("Accept", MediaType.APPLICATION_JSON)
                .queryParam("build", build)
                .queryParam("matrix_mode", matrixMode)
                .body(scenarioJson)
                .when()
                .put("/scenario")
                .then()
                .statusCode(200)
                .body("plan", notNullValue())
                .extract()
                .body()
                .asString();

        long end = System.currentTimeMillis();
        System.out.println("scenario create end: " + end + ", cost=" + (end - start) + "ms");
        System.out.println(response);
    }

    private void solveCurrentScenario() throws Exception {
        configureRestAssuredIfConfigured();

        String solveTime = getProperty("vrp.scenario.solveTime", "VRP_SCENARIO_SOLVE_TIME", DEFAULT_SOLVE_TIME);
        boolean drawRoute = Boolean.parseBoolean(
                getProperty("vrp.scenario.drawRoute", "VRP_SCENARIO_DRAW_ROUTE", "false")
        );
        String callback = getProperty("vrp.scenario.callback", "VRP_SCENARIO_CALLBACK", "");

        long start = System.currentTimeMillis();
        System.out.println("solver request start: " + start + ", url=/solver_job");

        var request = given()
                .header("Accept", MediaType.APPLICATION_JSON);

        if (!solveTime.isBlank()) {
            request.queryParam("solve_time", solveTime);
        }
        request.queryParam("draw_route", drawRoute);
        if (!callback.isBlank()) {
            request.queryParam("callback", callback);
        }

        String acceptedStatus = request
                .when()
                .post("/solver_job")
                .then()
                .statusCode(200)
                .body("status", notNullValue())
                .extract()
                .path("status");

        long accepted = System.currentTimeMillis();
        System.out.println("solver request accepted: " + accepted + ", cost=" + (accepted - start) + "ms, status=" + acceptedStatus);

        Response finalJob = waitForTerminalSolverStatus(
                Long.parseLong(getProperty(
                        "vrp.scenario.waitTimeoutMs",
                        "VRP_SCENARIO_WAIT_TIMEOUT_MS",
                        Long.toString(DEFAULT_WAIT_TIMEOUT_MS)
                )),
                Long.parseLong(getProperty(
                        "vrp.scenario.pollIntervalMs",
                        "VRP_SCENARIO_POLL_INTERVAL_MS",
                        Long.toString(DEFAULT_POLL_INTERVAL_MS)
                ))
        );

        String finalStatus = finalJob.path("status");
        System.out.println("solver final status: " + finalStatus);
        System.out.println(finalJob.asPrettyString());

        assertNotEquals("ERROR", finalStatus, "Solver job finished with ERROR");
        assertEquals("SOLVING_FINISHED", finalStatus, "Solver job did not finish successfully");
    }

    private Response waitForTerminalSolverStatus(long waitTimeoutMs, long pollIntervalMs) throws Exception {
        long deadline = System.currentTimeMillis() + waitTimeoutMs;
        Response lastResponse = null;

        while (System.currentTimeMillis() < deadline) {
            lastResponse = given()
                    .header("Accept", MediaType.APPLICATION_JSON)
                    .when()
                    .get("/solver_job")
                    .then()
                    .statusCode(200)
                    .extract()
                    .response();

            String status = lastResponse.path("status");
            if ("SOLVING_FINISHED".equals(status) || "ERROR".equals(status) || "NOT_SOLVING".equals(status)) {
                return lastResponse;
            }
            Thread.sleep(pollIntervalMs);
        }

        if (lastResponse == null) {
            throw new IllegalStateException("No solver job response received while waiting for terminal status");
        }
        throw new IllegalStateException("Timed out waiting for solver job to finish, last status=" + lastResponse.path("status"));
    }

    private static void configureRestAssuredIfConfigured() {
        String baseUrl = getProperty("vrp.scenario.baseUrl", "VRP_SCENARIO_BASE_URL", "");
        if (baseUrl == null || baseUrl.isBlank()) {
            return;
        }
        String normalized = baseUrl;
        if (normalized != null && !normalized.isBlank() && !normalized.contains("://")) {
            normalized = "http://" + normalized;
        }
        URI uri = URI.create(normalized);
        String scheme = uri.getScheme() != null ? uri.getScheme() : "http";
        String host = uri.getHost() != null ? uri.getHost() : "localhost";
        int port = uri.getPort();
        RestAssured.baseURI = scheme + "://" + host;
        RestAssured.basePath = "";
        if (port != -1) {
            RestAssured.port = port;
        }
        String path = uri.getPath();
        if (path != null && !path.isBlank() && !"/".equals(path)) {
            RestAssured.basePath = path;
        }
    }

    private static String getProperty(String sysProp, String envKey, String defaultValue) {
        String value = System.getProperty(sysProp);
        if (value == null || value.isBlank()) {
            value = System.getenv(envKey);
        }
        if (value == null || value.isBlank()) {
            return defaultValue;
        }
        return value;
    }
}
