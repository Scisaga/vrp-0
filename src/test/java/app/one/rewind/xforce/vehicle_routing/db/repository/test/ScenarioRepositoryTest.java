package one.rewind.xforce.vehicle_routing.db.repository.test;

import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import one.rewind.xforce.json.OM;
import one.rewind.xforce.geo.transit.Transit;
import one.rewind.xforce.geo.transit.TransitMatrix;
import one.rewind.xforce.vehicle_routing.db.dto.Scenario;
import one.rewind.xforce.vehicle_routing.db.repository.ScenarioRepository;
import one.rewind.xforce.vehicle_routing.domain.agent.AgentEachDay;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

@QuarkusTest
@Tag("app")
class ScenarioRepositoryTest {

    @Inject
    ScenarioRepository scenarioRepository;

    @AfterEach
    void tearDown() {
        scenarioRepository.deleteAll();
    }

    @Test
    void saveAndLoadCurrentScenario() throws IOException {
        Scenario scenario = readScenario("src/test/resources/fixtures/scenarios/scen-3.json");

        Scenario saved = scenarioRepository.saveCurrent(scenario);
        Scenario current = scenarioRepository.getCurrent();

        assertNotNull(saved.getId());
        assertNotNull(current);
        assertEquals(saved.getId(), current.getId());
        assertEquals("scen-3", current.getName());
        assertNotNull(current.getCreateTime());
        assertNotNull(current.getUpdateTime());
        assertTrue(scenarioRepository.exists());
        assertEquals(1, scenarioRepository.count());
        Scenario found = scenarioRepository.findById(current.getId());
        assertNotNull(found);
        assertEquals(current.getId(), found.getId());
    }

    @Test
    void saveCurrentScenarioPersistsMatrix() throws IOException {
        Scenario scenario = readScenario("src/test/resources/fixtures/scenarios/scen-3.json");
        String fromPoiId = scenario.getPlan().getPois().get(0).getId();
        String toPoiId = scenario.getPlan().getPois().get(1).getId();

        TransitMatrix matrix = new TransitMatrix()
                .put(fromPoiId, toPoiId, new Transit(123L, 456L))
                .put(toPoiId, fromPoiId, new Transit(789L, 654L));
        scenario.getPlan().setMatrix(matrix);

        scenarioRepository.saveCurrent(scenario);
        Scenario current = scenarioRepository.getCurrent();

        assertNotNull(current);
        assertNotNull(current.getPlan());
        assertNotNull(current.getPlan().getMatrix());
        assertEquals(123L, current.getPlan().getMatrix().get(fromPoiId, toPoiId).distance());
        assertEquals(456L, current.getPlan().getMatrix().get(fromPoiId, toPoiId).duration());
        assertEquals(789L, current.getPlan().getMatrix().get(toPoiId, fromPoiId).distance());
        assertEquals(654L, current.getPlan().getMatrix().get(toPoiId, fromPoiId).duration());
    }

    @Test
    void deleteCurrentScenarioRemovesSingleton() throws IOException {
        Scenario scenario = readScenario("src/test/resources/fixtures/scenarios/scen-3.json");
        scenarioRepository.saveCurrent(scenario);

        assertTrue(scenarioRepository.deleteCurrent());
        assertFalse(scenarioRepository.exists());
        assertEquals(0, scenarioRepository.count());
        assertNull(scenarioRepository.getCurrent());
    }

    @Test
    void loadCurrentScenarioWhenTicketIdCollidesWithAnotherAgentId() throws IOException {
        Scenario scenario = readScenario("src/test/resources/fixtures/scenarios/scen-3.json");

        AgentEachDay firstAgent = scenario.getPlan().getAgents().get(0);
        AgentEachDay secondAgent = scenario.getPlan().getAgents().get(1);
        var ticket = scenario.getPlan().getTickets().get(0);
        String sharedId = ticket.getId();

        ticket.setAgent(firstAgent);
        firstAgent.setTickets(new ArrayList<>(List.of(ticket)));
        secondAgent.setId(sharedId);
        secondAgent.setName(sharedId);

        scenarioRepository.saveCurrent(scenario);
        Scenario current = scenarioRepository.getCurrent();

        assertNotNull(current);
        assertNotNull(current.getPlan());
        assertTrue(current.getPlan().getAgents().size() >= 2);
        assertTrue(current.getPlan().getTickets().size() >= 1);
        assertInstanceOf(AgentEachDay.class, current.getPlan().getAgents().get(1));
        assertEquals(sharedId, current.getPlan().getAgents().get(1).getId());
        assertEquals(sharedId, current.getPlan().getTickets().get(0).getId());
        assertEquals(firstAgent.getId(), current.getPlan().getTickets().get(0).getAgent().getId());
    }

    private Scenario readScenario(String path) throws IOException {
        return OM.fromJson(Files.readString(Path.of(path), StandardCharsets.UTF_8), Scenario.class);
    }
}
