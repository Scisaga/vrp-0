package one.rewind.xforce.vehicle_routing.rest.test;

import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import jakarta.ws.rs.core.MediaType;
import one.rewind.xforce.vehicle_routing.bootstrap.GeoUtil;
import one.rewind.xforce.vehicle_routing.db.repository.ScenarioRepository;
import one.rewind.xforce.vehicle_routing.db.repository.SolverJobRepository;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static io.restassured.RestAssured.given;
import static org.hamcrest.CoreMatchers.notNullValue;

@QuarkusTest
@Tag("app")
class ScenarioResourceRegressionTest {

    @Inject
    ScenarioRepository scenarioRepository;

    @Inject
    SolverJobRepository solverJobRepository;

    @Test
    void putScenarioFromJson1AndReadBack() throws Exception {
        scenarioRepository.deleteAll();
        solverJobRepository.deleteAll();

        String json = Files.readString(Path.of("src/test/resources/fixtures/scenarios/json1.json"), StandardCharsets.UTF_8);

        given()
                .body(json)
                .queryParam("build", true)
                .queryParam("matrix_mode", GeoUtil.MatrixMode.MANHATTAN)
                .header("Content-Type", MediaType.APPLICATION_JSON)
                .when()
                .put("/scenario")
                .then()
                .statusCode(200)
                .body("plan", notNullValue());

        given()
                .when()
                .get("/scenario")
                .then()
                .statusCode(200)
                .body("plan", notNullValue());
    }

    @Test
    void putScenarioWithIncompleteMatrixStillReadable() throws Exception {
        scenarioRepository.deleteAll();
        solverJobRepository.deleteAll();

        String json = Files.readString(Path.of("src/test/resources/fixtures/scenarios/json1.json"), StandardCharsets.UTF_8);

        given()
                .body(json)
                .queryParam("build", false)
                .header("Content-Type", MediaType.APPLICATION_JSON)
                .when()
                .put("/scenario")
                .then()
                .statusCode(200)
                .body("plan", notNullValue());

        given()
                .when()
                .get("/scenario")
                .then()
                .statusCode(200)
                .body("plan", notNullValue());
    }
}
