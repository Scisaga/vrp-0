package one.rewind.xforce.vehicle_routing.rest.test;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import jakarta.ws.rs.core.MediaType;
import one.rewind.xforce.json.OM;
import one.rewind.xforce.vehicle_routing.db.dto.Scenario;
import one.rewind.xforce.vehicle_routing.db.dto.SolverJob;
import one.rewind.xforce.vehicle_routing.db.repository.ScenarioRepository;
import one.rewind.xforce.vehicle_routing.db.repository.SolverJobRepository;
import one.rewind.xforce.vehicle_routing.solver.Status;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static io.restassured.RestAssured.given;
import static org.hamcrest.CoreMatchers.equalTo;
import static org.hamcrest.CoreMatchers.notNullValue;

@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@QuarkusTest
@TestProfile(ScenarioResourceTestProfile.class)
@Tag("app")
public class ScenarioResourceTest {

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
    public void getScenarioWhenMissing() {
        given()
                .when()
                .get("/scenario")
                .then()
                .statusCode(404);
    }

    @Test
    @Order(21)
    public void getScenarioOptionalWhenMissing() {
        scenarioRepository.deleteAll();
        solverJobRepository.deleteAll();

        given()
                .when()
                .get("/scenario/optional")
                .then()
                .statusCode(200)
                .body(equalTo("null"));
    }

    @Test
    @Order(3)
    public void putScenarioCreatesCurrent() throws IOException {
        String json = Files.readString(Path.of("src/test/resources/fixtures/scenarios/scen-3.json"), StandardCharsets.UTF_8);

        given()
                .body(json)
                .header("Content-Type", MediaType.APPLICATION_JSON)
                .when()
                .put("/scenario")
                .then()
                .statusCode(200)
                .body("name", equalTo("scen-3"))
                .body("id", org.hamcrest.Matchers.nullValue())
                .body("map_provider", equalTo("AMAP"));

        given()
                .body(json.replaceFirst("\\{", "{\"map_provider\":\"HERE\","))
                .header("Content-Type", MediaType.APPLICATION_JSON)
                .when()
                .put("/scenario")
                .then()
                .statusCode(400)
                .body("error_code", equalTo("scenario_map_provider_mismatch"))
                .body("error_params.expected_provider", equalTo("AMAP"))
                .body("message", equalTo("Scenario map_provider must match MAP_PROVIDER=AMAP"));
    }

    @Test
    @Order(4)
    public void getScenarioReturnsCurrent() {
        given()
                .when()
                .get("/scenario")
                .then()
                .statusCode(200)
                .body("name", equalTo("scen-3"))
                .body("plan", notNullValue());
    }

    @Test
    @Order(5)
    public void putScenarioReplacesCurrent() throws IOException {
        String json = Files.readString(Path.of("src/test/resources/fixtures/scenarios/scen-1-1.json"), StandardCharsets.UTF_8);

        given()
                .body(json)
                .header("Content-Type", MediaType.APPLICATION_JSON)
                .when()
                .put("/scenario")
                .then()
                .statusCode(200)
                .body("name", equalTo("scen-1-1"));

        given()
                .when()
                .get("/scenario")
                .then()
                .statusCode(200)
                .body("name", equalTo("scen-1-1"));
    }

    @Test
    @Order(6)
    public void putScenarioKeepsFinishedSolverJob() throws Exception {
        String currentJson = Files.readString(Path.of("src/test/resources/fixtures/scenarios/scen-1-1.json"), StandardCharsets.UTF_8);

        given()
                .body(currentJson)
                .header("Content-Type", MediaType.APPLICATION_JSON)
                .when()
                .put("/scenario")
                .then()
                .statusCode(200);

        SolverJob job = new SolverJob();
        job.setStatus(Status.SOLVING_FINISHED);
        solverJobRepository.saveCurrent(job);

        String replacementJson = Files.readString(Path.of("src/test/resources/fixtures/scenarios/scen-3.json"), StandardCharsets.UTF_8);
        given()
                .body(replacementJson)
                .header("Content-Type", MediaType.APPLICATION_JSON)
                .when()
                .put("/scenario")
                .then()
                .statusCode(200)
                .body("name", equalTo("scen-3"));

        given()
                .when()
                .get("/solver_job")
                .then()
                .statusCode(200);

        solverJobRepository.deleteAll();
    }

    @Test
    @Order(7)
    public void replaceScenarioClearsFinishedSolverJob() throws Exception {
        String currentJson = Files.readString(Path.of("src/test/resources/fixtures/scenarios/scen-1-1.json"), StandardCharsets.UTF_8);

        given()
                .body(currentJson)
                .header("Content-Type", MediaType.APPLICATION_JSON)
                .when()
                .put("/scenario")
                .then()
                .statusCode(200);

        SolverJob job = new SolverJob();
        job.setStatus(Status.SOLVING_FINISHED);
        solverJobRepository.saveCurrent(job);

        String replacementJson = Files.readString(Path.of("src/test/resources/fixtures/scenarios/scen-3.json"), StandardCharsets.UTF_8);
        given()
                .body(replacementJson)
                .header("Content-Type", MediaType.APPLICATION_JSON)
                .queryParam("replace", true)
                .when()
                .put("/scenario")
                .then()
                .statusCode(200)
                .body("name", equalTo("scen-3"));

        given()
                .when()
                .get("/solver_job")
                .then()
                .statusCode(404);
    }

    @Test
    @Order(8)
    public void runningSolverJobRejectsScenarioMutations() throws Exception {
        String currentJson = Files.readString(Path.of("src/test/resources/fixtures/scenarios/scen-1-1.json"), StandardCharsets.UTF_8);

        given()
                .body(currentJson)
                .header("Content-Type", MediaType.APPLICATION_JSON)
                .when()
                .put("/scenario")
                .then()
                .statusCode(200);

        SolverJob job = new SolverJob();
        job.setStatus(Status.SOLVING_ACTIVE);
        solverJobRepository.saveCurrent(job);

        String replacementJson = Files.readString(Path.of("src/test/resources/fixtures/scenarios/scen-3.json"), StandardCharsets.UTF_8);

        given()
                .body(replacementJson)
                .header("Content-Type", MediaType.APPLICATION_JSON)
                .when()
                .put("/scenario")
                .then()
                .statusCode(409)
                .body("message", equalTo("Solver job is running, scenario mutations are rejected"));

        given()
                .when()
                .delete("/scenario")
                .then()
                .statusCode(409)
                .body("message", equalTo("Solver job is running, scenario mutations are rejected"));

        solverJobRepository.deleteCurrent();
    }

    @Test
    @Order(9)
    public void deleteScenarioClearsFinishedSolverJob() throws Exception {
        String currentJson = Files.readString(Path.of("src/test/resources/fixtures/scenarios/scen-1-1.json"), StandardCharsets.UTF_8);

        given()
                .body(currentJson)
                .header("Content-Type", MediaType.APPLICATION_JSON)
                .when()
                .put("/scenario")
                .then()
                .statusCode(200);

        SolverJob job = new SolverJob();
        job.setStatus(Status.SOLVING_FINISHED);
        solverJobRepository.saveCurrent(job);

        given()
                .when()
                .delete("/scenario")
                .then()
                .statusCode(200);

        given()
                .when()
                .get("/solver_job")
                .then()
                .statusCode(404);
    }

    @Test
    @Order(10)
    public void deleteScenarioRemovesCurrent() throws IOException {
        String json = Files.readString(Path.of("src/test/resources/fixtures/scenarios/scen-3.json"), StandardCharsets.UTF_8);

        given()
                .body(json)
                .header("Content-Type", MediaType.APPLICATION_JSON)
                .when()
                .put("/scenario")
                .then()
                .statusCode(200);

        given()
                .when()
                .delete("/scenario")
                .then()
                .statusCode(200);

        given()
                .when()
                .get("/scenario")
                .then()
                .statusCode(404);
    }

    @Test
    @Order(22)
    public void putScenarioRejectsTicketWithoutType() throws Exception {
        Scenario scenario = OM.fromJson(
                Files.readString(Path.of("src/test/resources/fixtures/scenarios/scen-3.json"), StandardCharsets.UTF_8),
                Scenario.class
        );
        scenario.getPlan().getTickets().getFirst().setType(null);

        given()
                .body(OM.toJson(scenario))
                .header("Content-Type", MediaType.APPLICATION_JSON)
                .when()
                .put("/scenario")
                .then()
                .statusCode(400)
                .body("error_code", equalTo("invalid_argument"))
                .body("error_params.field", equalTo("plan.tickets[0].type"))
                .body("error_params.rule", equalTo("required"))
                .body("message", equalTo("Ticket type is required: ticket-240407-0-d"));
    }
}
