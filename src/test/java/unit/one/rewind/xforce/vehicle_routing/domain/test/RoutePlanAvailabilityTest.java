package one.rewind.xforce.vehicle_routing.domain.test;

import one.rewind.xforce.geo.POI;
import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.domain.agent.Agent;
import one.rewind.xforce.vehicle_routing.domain.agent.AgentEachDay;
import one.rewind.xforce.vehicle_routing.domain.ticket.Ticket;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

class RoutePlanAvailabilityTest {

    @Test
    void availableAgentWindowsExcludeVirtualAgentsAndBusyWindows() {
        AgentEachDay availableAgent = agent("agent-1", false);
        Ticket ticket = ticket("ticket-1");
        ticket.setAgent(availableAgent);
        ticket.setArrivalTime(LocalDateTime.of(2026, 1, 2, 8, 20));
        ticket.setDuration(Duration.ofMinutes(30));
        availableAgent.getTickets().add(ticket);

        AgentEachDay virtualAgent = agent("agent-virtual", true);

        RoutePlan routePlan = new RoutePlan();
        routePlan.setAgents(List.of(availableAgent, virtualAgent));

        List<RoutePlan.AvailableAgentWindow> windows = routePlan.getAvailableAgentsCount(
                LocalDateTime.of(2026, 1, 2, 8, 0),
                LocalDateTime.of(2026, 1, 2, 10, 0),
                Duration.ofMinutes(30)
        );

        assertEquals(4, windows.size());
        assertEquals(0, windows.get(0).availableAgents());
        assertEquals(0, windows.get(1).availableAgents());
        assertEquals(1, windows.get(2).availableAgents());
        assertEquals(1, windows.get(3).availableAgents());
    }

    @Test
    void availableAgentWindowsReturnEmptyForInvalidRangeOrInterval() {
        RoutePlan routePlan = new RoutePlan();

        assertEquals(List.of(), routePlan.getAvailableAgentsCount(
                LocalDateTime.of(2026, 1, 2, 10, 0),
                LocalDateTime.of(2026, 1, 2, 8, 0),
                Duration.ofMinutes(30)
        ));
        assertEquals(List.of(), routePlan.getAvailableAgentsCount(
                LocalDateTime.of(2026, 1, 2, 8, 0),
                LocalDateTime.of(2026, 1, 2, 10, 0),
                Duration.ZERO
        ));
    }

    private static AgentEachDay agent(String id, boolean virtual) {
        Agent agent = new Agent(id, id, "depo-a", new POI("start-" + id), List.of("Delv"), 10, 10);
        agent.setVirtual(virtual);
        return new AgentEachDay(agent, LocalDate.of(2026, 1, 2), LocalTime.of(8, 0), LocalTime.of(10, 0));
    }

    private static Ticket ticket(String id) {
        LocalDateTime createTime = LocalDateTime.of(2026, 1, 1, 9, 0);
        return new Ticket(
                id,
                "depo-a",
                false,
                Ticket.Type.Delv,
                List.of("Delv"),
                1,
                1,
                new POI("poi-" + id),
                createTime,
                LocalDateTime.of(2026, 1, 2, 8, 0),
                LocalDateTime.of(2026, 1, 2, 18, 0)
        );
    }
}
