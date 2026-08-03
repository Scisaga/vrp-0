package one.rewind.xforce.vehicle_routing.rest.test;

import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import jakarta.ws.rs.core.MediaType;
import one.rewind.xforce.json.OM;
import one.rewind.xforce.vehicle_routing.bootstrap.GeoUtil;
import one.rewind.xforce.vehicle_routing.db.dto.Scenario;
import one.rewind.xforce.vehicle_routing.db.repository.ScenarioRepository;
import one.rewind.xforce.vehicle_routing.db.repository.SolverJobRepository;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;

import static io.restassured.RestAssured.given;
import static org.hamcrest.CoreMatchers.notNullValue;

@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@QuarkusTest
@Tag("app")
public class ScenarioResourceAuxTest {

    @Inject
    ScenarioRepository scenarioRepository;

    @Inject
    SolverJobRepository solverJobRepository;

    @Test
    @Order(1)
    public void clearDB() {
        scenarioRepository.deleteAll();
        solverJobRepository.deleteAll();
    }

    @Test
    @Order(2)
    public void availableAgentsWhenMissingScenario() {
        given()
                .when()
                .get("/scenario/available_agents")
                .then()
                .statusCode(404);
    }

    @Test
    @Order(3)
    public void testPutAndBuild() throws IOException {
        String json = Files.readString(Path.of("src/test/resources/fixtures/scenarios/scen-3.json"), StandardCharsets.UTF_8);

        given()
                .body(json)
                .queryParam("build", true)
                .queryParam("matrix_mode", GeoUtil.MatrixMode.MANHATTAN)
                .header("Content-Type", MediaType.APPLICATION_JSON)
                .when()
                .put("/scenario")
                .then()
                .statusCode(200)
                .body("plan.matrix", notNullValue());

        given()
                .when()
                .get("/scenario/available_agents")
                .then()
                .statusCode(200);

        given()
                .when()
                .delete("/scenario")
                .then()
                .statusCode(200);
    }

    @Test
    @Order(4)
    public void availableAgentsRequiresTimeRange() throws IOException {
        Scenario scenario = OM.fromJson(
                Files.readString(Path.of("src/test/resources/fixtures/scenarios/scen-3.json"), StandardCharsets.UTF_8),
                Scenario.class
        );
        scenario.setStartTime(null);
        scenarioRepository.saveCurrent(scenario);

        given()
                .when()
                .get("/scenario/available_agents")
                .then()
                .statusCode(400)
                .body("message", org.hamcrest.CoreMatchers.equalTo("Scenario start_time or end_time is empty"));

        scenario.setStartTime(LocalDateTime.parse("2024-04-08T00:00:00"));
        scenario.setEndTime(null);
        scenarioRepository.saveCurrent(scenario);

        given()
                .when()
                .get("/scenario/available_agents")
                .then()
                .statusCode(400)
                .body("message", org.hamcrest.CoreMatchers.equalTo("Scenario start_time or end_time is empty"));
    }

    @Test
    @Order(5)
    public void availableAgentsRequiresPlan() throws IOException {
        Scenario scenario = OM.fromJson(
                Files.readString(Path.of("src/test/resources/fixtures/scenarios/scen-3.json"), StandardCharsets.UTF_8),
                Scenario.class
        );
        scenario.setPlan(null);
        scenarioRepository.saveCurrent(scenario);

        given()
                .when()
                .get("/scenario/available_agents")
                .then()
                .statusCode(400)
                .body("message", org.hamcrest.CoreMatchers.equalTo("Scenario has no plan"));

        scenarioRepository.deleteAll();
        solverJobRepository.deleteAll();
    }
}
