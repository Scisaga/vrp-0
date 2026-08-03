package one.rewind.xforce.vehicle_routing.mcp.test;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.modelcontextprotocol.client.McpClient;
import io.modelcontextprotocol.client.McpSyncClient;
import io.modelcontextprotocol.client.transport.HttpClientStreamableHttpTransport;
import io.modelcontextprotocol.json.jackson2.JacksonMcpJsonMapper;
import io.modelcontextprotocol.spec.McpSchema;
import io.quarkus.test.common.http.TestHTTPResource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import one.rewind.xforce.json.OM;
import one.rewind.xforce.geo.transit.TransitMatrix;
import one.rewind.xforce.vehicle_routing.db.dto.Scenario;
import one.rewind.xforce.vehicle_routing.db.dto.SolverJob;
import one.rewind.xforce.vehicle_routing.db.repository.ScenarioRepository;
import one.rewind.xforce.vehicle_routing.db.repository.SolverJobRepository;
import one.rewind.xforce.vehicle_routing.solver.Status;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.hamcrest.CoreMatchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

@QuarkusTest
@TestProfile(McpTestProfile.class)
@Tag("app")
public class McpServerTest {

    private static final String TOKEN = "test-mcp-token";
    private static final String ALLOWED_ORIGIN = "https://allowed.example";

    @Inject
    ScenarioRepository scenarioRepository;

    @Inject
    SolverJobRepository solverJobRepository;

    @Inject
    ObjectMapper objectMapper;

    @TestHTTPResource("/mcp")
    URI mcpUri;

    @BeforeEach
    void clearState() {
        scenarioRepository.deleteAll();
        solverJobRepository.deleteAll();
    }

    @Test
    void missingBearerTokenIsRejected() {
        given()
                .contentType("application/json")
                .body("{}")
                .when()
                .post("/mcp")
                .then()
                .statusCode(401)
                .body("error_code", equalTo("permission_denied"));
    }

    @Test
    void invalidBearerTokenIsRejected() {
        given()
                .contentType("application/json")
                .header("Authorization", "Bearer wrong-token")
                .body("{}")
                .when()
                .post("/mcp")
                .then()
                .statusCode(403)
                .body("error_code", equalTo("permission_denied"));
    }

    @Test
    void invalidOriginIsRejected() {
        given()
                .contentType("application/json")
                .header("Authorization", "Bearer " + TOKEN)
                .header("Origin", "https://denied.example")
                .body("{}")
                .when()
                .post("/mcp")
                .then()
                .statusCode(403);
    }

    @Test
    void corsPreflightIsNotRejectedByBearerAuthFilter() {
        given()
                .header("Origin", ALLOWED_ORIGIN)
                .header("Access-Control-Request-Method", "POST")
                .header("Access-Control-Request-Headers", "authorization, content-type")
                .when()
                .options("/mcp")
                .then()
                .statusCode(200);
    }

    @Test
    void streamableHttpClientCanInitializeListToolsAndCallTools() throws Exception {
        try (McpSyncClient client = createClient(ALLOWED_ORIGIN)) {
            McpSchema.InitializeResult initializeResult = client.initialize();
            assertNotNull(initializeResult);

            List<String> toolNames = client.listTools().tools().stream()
                    .map(McpSchema.Tool::name)
                    .toList();
            assertTrue(toolNames.containsAll(List.of(
                    "get_current_scenario",
                    "upsert_current_scenario",
                    "delete_current_scenario",
                    "get_available_agents",
                    "search_pois",
                    "start_solver_job",
                    "get_current_solver_job",
                    "terminate_current_solver_job",
                    "apply_current_solver_job",
                    "delete_current_solver_job",
                    "get_matrix",
                    "set_matrix",
                    "get_amap_conf"
            )));

            Scenario scenario = readScenario("src/test/resources/fixtures/scenarios/scen-3.json");
            McpSchema.CallToolResult upsertResult = client.callTool(new McpSchema.CallToolRequest(
                    "upsert_current_scenario",
                    Map.of(
                            "scenario", scenario,
                            "build", true,
                            "matrix_mode", "MANHATTAN"
                    )
            ));
            assertFalse(Boolean.TRUE.equals(upsertResult.isError()));

            McpSchema.CallToolResult getScenarioResult = client.callTool(new McpSchema.CallToolRequest(
                    "get_current_scenario",
                    Map.of()
            ));
            assertFalse(Boolean.TRUE.equals(getScenarioResult.isError()));
            Scenario currentScenario = objectMapper.convertValue(getScenarioResult.structuredContent(), Scenario.class);
            assertNotNull(currentScenario.getPlan());

            McpSchema.CallToolResult availableAgentsResult = client.callTool(new McpSchema.CallToolRequest(
                    "get_available_agents",
                    Map.of()
            ));
            assertFalse(Boolean.TRUE.equals(availableAgentsResult.isError()));

            McpSchema.CallToolResult invalidPoiSearch = client.callTool(new McpSchema.CallToolRequest(
                    "search_pois",
                    Map.of()
            ));
            assertTrue(Boolean.TRUE.equals(invalidPoiSearch.isError()));
            assertErrorCode(invalidPoiSearch, "invalid_argument");

            McpSchema.CallToolResult startJobResult = client.callTool(new McpSchema.CallToolRequest(
                    "start_solver_job",
                    Map.of("solve_time", "PT5S")
            ));
            assertFalse(Boolean.TRUE.equals(startJobResult.isError()));

            McpSchema.CallToolResult duplicateStartResult = client.callTool(new McpSchema.CallToolRequest(
                    "start_solver_job",
                    Map.of("solve_time", "PT5S")
            ));
            assertTrue(Boolean.TRUE.equals(duplicateStartResult.isError()));
            assertErrorCode(duplicateStartResult, "solver_job_already_running");

            McpSchema.CallToolResult currentJobResult = client.callTool(new McpSchema.CallToolRequest(
                    "get_current_solver_job",
                    Map.of()
            ));
            assertFalse(Boolean.TRUE.equals(currentJobResult.isError()));

            McpSchema.CallToolResult terminateResult = client.callTool(new McpSchema.CallToolRequest(
                    "terminate_current_solver_job",
                    Map.of()
            ));
            assertFalse(Boolean.TRUE.equals(terminateResult.isError()));

            Thread.sleep(500);

            SolverJob finishedJob = new SolverJob();
            finishedJob.setPlan(scenarioRepository.getCurrent().getPlan());
            finishedJob.setStatus(Status.SOLVING_FINISHED);
            solverJobRepository.saveCurrent(finishedJob);

            McpSchema.CallToolResult applyResult = client.callTool(new McpSchema.CallToolRequest(
                    "apply_current_solver_job",
                    Map.of()
            ));
            assertFalse(Boolean.TRUE.equals(applyResult.isError()));

            TransitMatrix matrix = scenarioRepository.getCurrent().getPlan().getMatrix();
            McpSchema.CallToolResult setMatrixResult = client.callTool(new McpSchema.CallToolRequest(
                    "set_matrix",
                    Map.of("matrix", matrix)
            ));
            assertFalse(Boolean.TRUE.equals(setMatrixResult.isError()));

            McpSchema.CallToolResult getMatrixResult = client.callTool(new McpSchema.CallToolRequest(
                    "get_matrix",
                    Map.of()
            ));
            assertFalse(Boolean.TRUE.equals(getMatrixResult.isError()));
            assertNotNull(objectMapper.convertValue(getMatrixResult.structuredContent(), TransitMatrix.class));

            McpSchema.CallToolResult amapConfResult = client.callTool(new McpSchema.CallToolRequest(
                    "get_amap_conf",
                    Map.of()
            ));
            assertFalse(Boolean.TRUE.equals(amapConfResult.isError()));
            assertNotNull(amapConfResult.structuredContent());

            McpSchema.CallToolResult deleteJobResult = client.callTool(new McpSchema.CallToolRequest(
                    "delete_current_solver_job",
                    Map.of()
            ));
            assertFalse(Boolean.TRUE.equals(deleteJobResult.isError()));

            McpSchema.CallToolResult deleteScenarioResult = client.callTool(new McpSchema.CallToolRequest(
                    "delete_current_scenario",
                    Map.of()
            ));
            assertFalse(Boolean.TRUE.equals(deleteScenarioResult.isError()));
        }
    }

    @Test
    void mcpAndRestStayConsistent() throws Exception {
        try (McpSyncClient client = createClient(ALLOWED_ORIGIN)) {
            client.initialize();

            Scenario scenario = readScenario("src/test/resources/fixtures/scenarios/scen-1-1.json");
            McpSchema.CallToolResult upsertResult = client.callTool(new McpSchema.CallToolRequest(
                    "upsert_current_scenario",
                    Map.of("scenario", scenario)
            ));
            assertFalse(Boolean.TRUE.equals(upsertResult.isError()));

            given()
                    .when()
                    .get("/scenario")
                    .then()
                    .statusCode(200)
                    .body("name", equalTo("scen-1-1"));
        }
    }

    private McpSyncClient createClient(String origin) {
        HttpClientStreamableHttpTransport transport = HttpClientStreamableHttpTransport.builder(mcpUri.toString())
                .jsonMapper(new JacksonMcpJsonMapper(objectMapper.copy()))
                .connectTimeout(Duration.ofSeconds(10))
                .customizeRequest(request -> request
                        .header("Authorization", "Bearer " + TOKEN)
                        .header("Origin", origin))
                .build();

        return McpClient.sync(transport)
                .requestTimeout(Duration.ofSeconds(30))
                .initializationTimeout(Duration.ofSeconds(30))
                .build();
    }

    private Scenario readScenario(String path) throws IOException {
        return OM.fromJson(Files.readString(Path.of(path), StandardCharsets.UTF_8), Scenario.class);
    }

    @SuppressWarnings("unchecked")
    private void assertErrorCode(McpSchema.CallToolResult result, String expectedCode) {
        Map<String, Object> payload = (Map<String, Object>) result.structuredContent();
        org.junit.jupiter.api.Assertions.assertEquals(expectedCode, payload.get("error_code"));
    }
}
