package one.rewind.xforce.vehicle_routing.remote.test;

import io.restassured.RestAssured;
import jakarta.ws.rs.core.MediaType;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static io.restassured.RestAssured.given;
import static org.hamcrest.CoreMatchers.notNullValue;

@Tag("external")
public class SolverJobSolveRequestTest {

    @BeforeAll
    static void requireExternalTestsEnabled() {
        one.rewind.xforce.test.support.ExternalTestSupport.requireExternalTestsEnabled();
    }

    private static final String BODY_PATH = "scenarios/public-demo/scen-1.json";

    @Test
    public void solveRequest() throws Exception {
        Path bodyFile = Path.of(BODY_PATH);
        Assumptions.assumeTrue(Files.exists(bodyFile), "Solve request body not found: " + bodyFile);

        String solveUrl = getProperty("vrp.solve.url", "VRP_SOLVE_URL", "");
        String baseUrl = getProperty("vrp.solve.baseUrl", "VRP_SOLVE_BASE_URL", "http://localhost:8080");
        configureRestAssured(baseUrl);

        String solveTime = getProperty("vrp.solve.solveTime", "VRP_SOLVE_TIME", "PT30S");
        String drawRoute = getProperty("vrp.solve.drawRoute", "VRP_SOLVE_DRAW_ROUTE", "false");
        String callback = getProperty("vrp.solve.callback", "VRP_SOLVE_CALLBACK", "");
        String matrixMode = getProperty("vrp.solve.matrixMode", "VRP_SOLVE_MATRIX_MODE", "MANHATTAN");

        String scenarioJson = Files.readString(Path.of(BODY_PATH), StandardCharsets.UTF_8);

        long scenarioStart = System.currentTimeMillis();
        System.out.println("scenario request start: " + scenarioStart + ", url=/scenario");
        String createdScenario = given()
                .header("Content-Type", MediaType.APPLICATION_JSON)
                .queryParam("build", true)
                .queryParam("matrix_mode", matrixMode)
                .body(scenarioJson)
                .when()
                .put("/scenario")
                .then()
                .statusCode(200)
                .extract()
                .body()
                .asString();
        long scenarioEnd = System.currentTimeMillis();
        System.out.println("scenario request end: " + scenarioEnd + ", cost=" + (scenarioEnd - scenarioStart) + "ms");

        String targetUrl = solveUrl.isBlank() ? "/solver_job" : solveUrl;
        long solveStart = System.currentTimeMillis();
        System.out.println("solve request start: " + solveStart + ", url=" + targetUrl);
        var solveRequest = given()
                .header("Content-Type", MediaType.APPLICATION_JSON)
                .body(createdScenario);

        if (!solveTime.isBlank()) {
            solveRequest.queryParam("solve_time", solveTime);
        }
        if (!drawRoute.isBlank()) {
            solveRequest.queryParam("draw_route", drawRoute);
        }
        if (!callback.isBlank()) {
            solveRequest.queryParam("callback", callback);
        }

        solveRequest.when()
                .post(targetUrl)
                .then()
                .statusCode(200)
                .body("status", notNullValue());
        long solveEnd = System.currentTimeMillis();
        System.out.println("solve request end: " + solveEnd + ", cost=" + (solveEnd - solveStart) + "ms");
    }

    private static void configureRestAssured(String baseUrl) {
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
