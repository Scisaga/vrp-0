package one.rewind.xforce.vehicle_routing.domain.test;

import one.rewind.xforce.geo.POI;
import one.rewind.xforce.geo.transit.Transit;
import one.rewind.xforce.geo.transit.TransitMatrix;
import one.rewind.xforce.vehicle_routing.db.dto.Scenario;
import one.rewind.xforce.vehicle_routing.db.dto.SolverJob;
import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.domain.agent.Agent;
import one.rewind.xforce.vehicle_routing.domain.agent.AgentEachDay;
import one.rewind.xforce.vehicle_routing.domain.agent.Depo;
import one.rewind.xforce.vehicle_routing.domain.ticket.Ticket;
import one.rewind.xforce.vehicle_routing.exception.AgentOrTicketNotCompatible;
import one.rewind.xforce.vehicle_routing.exception.POINotBuild;
import one.rewind.xforce.vehicle_routing.exception.TransitMatrixNotBuild;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ScenarioDomainTest {

    @Test
    void constructorInitializesPlanningWindowAndEmptyRoutePlan() {
        Scenario scenario = new Scenario("scenario-a", "desc", LocalDate.of(2026, 1, 2), 3);

        assertEquals("scenario-a", scenario.getName());
        assertEquals(LocalDate.of(2026, 1, 2), scenario.getPlanningDate());
        assertEquals(LocalDateTime.of(2026, 1, 3, 0, 0), scenario.getStartTime());
        assertEquals(LocalDateTime.of(2026, 1, 6, 0, 0), scenario.getEndTime());
        assertTrue(scenario.isPOIBuild());
        assertFalse(scenario.isMatrixBuild());
    }

    @Test
    void poiBuildRequiresResolvedDepoAgentAndTicketLocations() {
        Scenario scenario = scenarioWithPlan(completePlan());
        assertTrue(scenario.isPOIBuild());

        scenario.getPlan().getTickets().getFirst().setLoc(new POI("北京市", "raw address"));

        assertFalse(scenario.isPOIBuild());
    }

    @Test
    void matrixBuildRequiresEveryPoiPairToBePresent() {
        RoutePlan plan = completePlan();
        Scenario scenario = scenarioWithPlan(plan);
        assertTrue(scenario.isMatrixBuild());

        plan.getMatrix().data.clear();

        assertFalse(scenario.isMatrixBuild());
    }

    @Test
    void applyRoutePlanReplacesCompatiblePlanAndUpdatesTimestamp() throws Exception {
        Scenario scenario = scenarioWithPlan(completePlan());
        LocalDateTime beforeUpdate = scenario.getUpdateTime();
        RoutePlan replacement = completePlan();

        Scenario updated = scenario.applyRoutePlan(replacement);

        assertSame(scenario, updated);
        assertSame(replacement, scenario.getPlan());
        assertTrue(scenario.getUpdateTime().isAfter(beforeUpdate) || scenario.getUpdateTime().isEqual(beforeUpdate));
    }

    @Test
    void applyRoutePlanRejectsMismatchedAgentOrTicketSets() {
        Scenario scenario = scenarioWithPlan(completePlan());
        RoutePlan replacement = completePlan();
        replacement.getTickets().getFirst().setId("different-ticket");

        assertThrows(AgentOrTicketNotCompatible.class, () -> scenario.applyRoutePlan(replacement));
    }

    @Test
    void getSolverJobRequiresPoiAndMatrixAndCopiesScenarioFields() throws Exception {
        UUID scenarioId = UUID.randomUUID();
        Scenario scenario = scenarioWithPlan(completePlan());
        scenario.setId(scenarioId);
        Duration solveTime = Duration.ofSeconds(45);

        SolverJob job = scenario.getSolverJob(null, solveTime);

        assertEquals(scenarioId, job.getScenarioId());
        assertEquals("scenario-a", job.getScenarioName());
        assertEquals(scenario.getStartTime(), job.getStartDateTime());
        assertEquals(scenario.getEndTime(), job.getEndDateTime());
        assertSame(scenario.getPlan(), job.getPlan());
        assertEquals(solveTime, job.getSolveTime());
    }

    @Test
    void getSolverJobFailsWhenPoiOrMatrixIsMissing() {
        Scenario rawPoiScenario = scenarioWithPlan(completePlan());
        rawPoiScenario.getPlan().getAgents().getFirst().setStartLoc(new POI("北京市", "raw address"));
        assertThrows(POINotBuild.class, () -> rawPoiScenario.getSolverJob(null, Duration.ofSeconds(1)));

        Scenario missingMatrixScenario = scenarioWithPlan(completePlan());
        missingMatrixScenario.getPlan().getMatrix().data.clear();
        assertThrows(TransitMatrixNotBuild.class, () -> missingMatrixScenario.getSolverJob(null, Duration.ofSeconds(1)));
    }

    private static Scenario scenarioWithPlan(RoutePlan plan) {
        Scenario scenario = new Scenario("scenario-a", "desc", LocalDate.of(2026, 1, 2), 1);
        scenario.setPlan(plan);
        return scenario;
    }

    private static RoutePlan completePlan() {
        POI depoLoc = new POI("depo-poi");
        POI agentLoc = new POI("agent-poi");
        POI ticketLoc = new POI("ticket-poi");
        AgentEachDay agent = agent("agent-1", agentLoc);
        Ticket ticket = ticket("ticket-1", ticketLoc);
        ticket.setAgent(agent);
        agent.setTickets(List.of(ticket));
        RoutePlan plan = new RoutePlan();
        plan.setDepos(List.of(new Depo("depo-a", "Depo A", depoLoc)));
        plan.setAgents(List.of(agent));
        plan.setTickets(List.of(ticket));
        plan.setPois(List.of(depoLoc, agentLoc, ticketLoc));
        plan.setMatrix(completeMatrix(plan.getPois()));
        return plan;
    }

    private static TransitMatrix completeMatrix(List<POI> pois) {
        TransitMatrix matrix = new TransitMatrix();
        for (POI from : pois) {
            for (POI to : pois) {
                if (!from.id.equals(to.id)) {
                    matrix.put(from.id, to.id, new Transit(100, 10));
                }
            }
        }
        return matrix;
    }

    private static AgentEachDay agent(String id, POI startLoc) {
        Agent base = new Agent(id, id, "depo-a", startLoc, List.of("Delv"), 10, 10);
        return new AgentEachDay(base, LocalDate.of(2026, 1, 3), LocalTime.of(8, 0), LocalTime.of(18, 0));
    }

    private static Ticket ticket(String id, POI loc) {
        return new Ticket(
                id,
                "depo-a",
                false,
                Ticket.Type.Delv,
                List.of("Delv"),
                1,
                1,
                loc,
                LocalDateTime.of(2026, 1, 1, 9, 0),
                LocalDateTime.of(2026, 1, 3, 8, 0),
                LocalDateTime.of(2026, 1, 3, 18, 0)
        );
    }
}
