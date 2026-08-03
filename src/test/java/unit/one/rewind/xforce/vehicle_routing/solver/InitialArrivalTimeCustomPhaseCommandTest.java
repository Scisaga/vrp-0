package one.rewind.xforce.vehicle_routing.solver;

import one.rewind.xforce.geo.POI;
import one.rewind.xforce.geo.transit.Transit;
import one.rewind.xforce.geo.transit.TransitMatrix;
import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.domain.agent.Agent;
import one.rewind.xforce.vehicle_routing.domain.agent.AgentEachDay;
import one.rewind.xforce.vehicle_routing.domain.ticket.Ticket;
import org.junit.jupiter.api.Test;
import org.optaplanner.core.config.constructionheuristic.ConstructionHeuristicPhaseConfig;
import org.optaplanner.core.config.phase.PhaseConfig;
import org.optaplanner.core.config.phase.custom.CustomPhaseConfig;
import org.optaplanner.core.config.solver.SolverConfig;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class InitialArrivalTimeCustomPhaseCommandTest {

    @Test
    void solverInitializesACompletePreassignedRouteBeforeConstructionHeuristic() {
        POI start = new POI("start");
        POI firstLoc = new POI("ticket-1-loc");
        POI secondLoc = new POI("ticket-2-loc");
        TransitMatrix matrix = new TransitMatrix()
                .put(start.id, firstLoc.id, new Transit(1_000, 600))
                .put(firstLoc.id, secondLoc.id, new Transit(1_000, 900));

        AgentEachDay agent = agent(start);
        Ticket first = ticket("ticket-1", firstLoc, matrix);
        Ticket second = ticket("ticket-2", secondLoc, matrix);
        agent.setTickets(new ArrayList<>(List.of(first, second)));
        first.setPinned(true);
        second.setPinned(true);
        assertNull(first.getArrivalTime());
        assertNull(second.getArrivalTime());

        RoutePlan plan = new RoutePlan();
        plan.setAgents(List.of(agent));
        plan.setTickets(List.of(first, second));
        plan.setMatrix(matrix);

        RoutePlan solvedPlan = SolverWrapper.build(Duration.ofSeconds(1)).solve(plan);
        Ticket solvedFirst = solvedPlan.getTickets().getFirst();
        Ticket solvedSecond = solvedPlan.getTickets().get(1);

        assertEquals(LocalDateTime.of(2026, 1, 2, 8, 10), solvedFirst.getArrivalTime());
        // The first ticket waits for its 09:00 time window and takes 10 minutes to serve.
        assertEquals(LocalDateTime.of(2026, 1, 2, 9, 25), solvedSecond.getArrivalTime());
    }

    @Test
    void routePlanInitializationClearsArrivalTimeForUnassignedTickets() {
        POI start = new POI("start");
        POI assignedLoc = new POI("assigned-loc");
        POI unassignedLoc = new POI("unassigned-loc");
        TransitMatrix matrix = new TransitMatrix()
                .put(start.id, assignedLoc.id, new Transit(1_000, 600));

        AgentEachDay agent = agent(start);
        Ticket assigned = ticket("assigned", assignedLoc, matrix);
        Ticket unassigned = ticket("unassigned", unassignedLoc, matrix);
        assigned.setAgent(agent);
        agent.setTickets(new ArrayList<>(List.of(assigned)));
        unassigned.setArrivalTime(LocalDateTime.of(2026, 1, 2, 10, 0));

        RoutePlan plan = new RoutePlan();
        plan.setAgents(List.of(agent));
        plan.setTickets(List.of(assigned, unassigned));
        plan.setMatrix(matrix);
        plan.init();
        RouteScheduleInitializer.initializePreassignedRoutes(plan);

        assertEquals(LocalDateTime.of(2026, 1, 2, 8, 10), assigned.getArrivalTime());
        assertNull(unassigned.getAgent());
        assertNull(unassigned.getArrivalTime());
    }

    @Test
    void productionSolverConfigurationRunsInitializationBeforeConstructionHeuristic() {
        SolverConfig solverConfig = SolverConfig.createFromXmlResource("solverConfig.xml");
        List<PhaseConfig> phases = solverConfig.getPhaseConfigList();

        assertInstanceOf(CustomPhaseConfig.class, phases.getFirst());
        CustomPhaseConfig customPhase = (CustomPhaseConfig) phases.getFirst();
        assertTrue(customPhase.getCustomPhaseCommandClassList()
                        .contains(InitialArrivalTimeCustomPhaseCommand.class));
        assertInstanceOf(ConstructionHeuristicPhaseConfig.class, phases.get(1));
    }

    private static AgentEachDay agent(POI start) {
        Agent agent = new Agent("agent-1", "Agent 1", "depo-a", start, List.of("Delv"), 10, 10);
        return new AgentEachDay(agent, LocalDate.of(2026, 1, 2), LocalTime.of(8, 0), LocalTime.of(18, 0));
    }

    private static Ticket ticket(String id, POI loc, TransitMatrix matrix) {
        Ticket ticket = new Ticket(
                id,
                "depo-a",
                false,
                Ticket.Type.Delv,
                List.of("Delv"),
                1,
                1,
                loc,
                LocalDateTime.of(2026, 1, 1, 9, 0),
                LocalDateTime.of(2026, 1, 2, 9, 0),
                LocalDateTime.of(2026, 1, 2, 18, 0)
        );
        ticket.setDuration(Duration.ofMinutes(10));
        ticket.matrix = matrix;
        return ticket;
    }
}
