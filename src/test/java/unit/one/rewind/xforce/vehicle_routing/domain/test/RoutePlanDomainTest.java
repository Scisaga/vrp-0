package one.rewind.xforce.vehicle_routing.domain.test;

import one.rewind.xforce.geo.POI;
import one.rewind.xforce.geo.transit.TransitMatrix;
import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.domain.agent.Agent;
import one.rewind.xforce.vehicle_routing.domain.agent.AgentEachDay;
import one.rewind.xforce.vehicle_routing.domain.ticket.Ticket;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RoutePlanDomainTest {

    @Test
    void initPropagatesMatrixAndCostParameterAndStoresOriginalAssignments() {
        AgentEachDay agent = agent("agent-1", false, LocalDate.of(2026, 1, 2));
        Ticket first = ticket("ticket-1", LocalDateTime.of(2026, 1, 2, 9, 0));
        Ticket second = ticket("ticket-2", LocalDateTime.of(2026, 1, 2, 10, 0));
        first.setAgent(agent);
        second.setAgent(agent);
        agent.setTickets(new ArrayList<>(List.of(first, second)));
        TransitMatrix matrix = new TransitMatrix();
        RoutePlan plan = new RoutePlan();
        plan.setAgents(List.of(agent));
        plan.setTickets(List.of(first, second));
        plan.setMatrix(matrix);

        RoutePlan initialized = plan.init();

        assertSame(plan, initialized);
        assertSame(matrix, agent.matrix);
        assertSame(plan.getCostParameter(), agent.costParameter);
        assertSame(matrix, first.matrix);
        assertSame(matrix, second.matrix);
        assertSame(agent, first.getOriginalAgent());
        assertSame(agent, second.getOriginalAgent());
        assertEquals(0, first.getOriginalOrder());
        assertEquals(1, second.getOriginalOrder());
    }

    @Test
    void clearAssignmentsClearsAgentTicketListsAndTicketAssignmentState() {
        AgentEachDay agent = agent("agent-1", false, LocalDate.of(2026, 1, 2));
        Ticket ticket = ticket("ticket-1", LocalDateTime.of(2026, 1, 2, 9, 0));
        ticket.setAgent(agent);
        ticket.setOriginalAgent(agent);
        ticket.setArrivalTime(LocalDateTime.of(2026, 1, 2, 9, 30));
        agent.setTickets(new ArrayList<>(List.of(ticket)));
        RoutePlan plan = new RoutePlan();
        plan.setAgents(List.of(agent));
        plan.setTickets(List.of(ticket));

        RoutePlan cleared = plan.clearAssignments();

        assertSame(plan, cleared);
        assertTrue(agent.getTickets().isEmpty());
        assertNull(ticket.getAgent());
        assertNull(ticket.getOriginalAgent());
        assertNull(ticket.getArrivalTime());
    }

    @Test
    void removeVirtualAgentsUnassignsVirtualTicketsAndKeepsRealAssignments() {
        AgentEachDay real = agent("real-agent", false, LocalDate.of(2026, 1, 2));
        AgentEachDay virtual = agent("virtual-agent", true, LocalDate.of(2026, 1, 2));
        Ticket realTicket = ticket("ticket-real", LocalDateTime.of(2026, 1, 2, 9, 0));
        Ticket virtualTicket = ticket("ticket-virtual", LocalDateTime.of(2026, 1, 2, 10, 0));
        realTicket.setAgent(real);
        virtualTicket.setAgent(virtual);
        virtualTicket.setArrivalTime(LocalDateTime.of(2026, 1, 2, 10, 30));
        real.setTickets(new ArrayList<>(List.of(realTicket)));
        virtual.setTickets(new ArrayList<>(List.of(virtualTicket)));
        RoutePlan plan = new RoutePlan();
        plan.setAgents(new ArrayList<>(List.of(real, virtual)));
        plan.setTickets(List.of(realTicket, virtualTicket));

        plan.removeVirtualAgents();

        assertEquals(List.of(real), plan.getAgents());
        assertSame(real, realTicket.getAgent());
        assertNull(virtualTicket.getAgent());
        assertNull(virtualTicket.getNextTicket());
        assertNull(virtualTicket.getArrivalTime());
    }

    @Test
    void addVirtualAgentsCreatesOneVirtualAgentForEachPlanningDateOnlyOnce() {
        Ticket firstDay = ticket("ticket-1", LocalDateTime.of(2026, 1, 2, 9, 0));
        Ticket secondDay = ticket("ticket-2", LocalDateTime.of(2026, 1, 3, 9, 0));
        secondDay.setMaxEndTime(LocalDateTime.of(2026, 1, 3, 18, 0));
        RoutePlan plan = new RoutePlan();
        plan.setAgents(new ArrayList<>());
        plan.setTickets(List.of(firstDay, secondDay));

        plan.addVirtualAgents();
        plan.addVirtualAgents();

        assertEquals(2, plan.getAgents().size());
        assertTrue(plan.getAgents().stream().allMatch(AgentEachDay::isVirtual));
        assertTrue(plan.getAgents().stream().anyMatch(a -> a.getDate().equals(LocalDate.of(2026, 1, 2))));
        assertTrue(plan.getAgents().stream().anyMatch(a -> a.getDate().equals(LocalDate.of(2026, 1, 3))));
    }

    @Test
    void updateMinStartTimeAndMaxEndTimeBucketsAssignedTicketsByArrivalHour() {
        AgentEachDay agent = agent("agent-1", false, LocalDate.of(2026, 1, 2));
        Ticket morning = assignedTicket("morning", agent, LocalDateTime.of(2026, 1, 2, 8, 30));
        Ticket afternoon = assignedTicket("afternoon", agent, LocalDateTime.of(2026, 1, 2, 14, 30));
        Ticket evening = assignedTicket("evening", agent, LocalDateTime.of(2026, 1, 2, 19, 30));
        RoutePlan plan = new RoutePlan();
        plan.setTickets(List.of(morning, afternoon, evening));

        plan.updateMinStartTimeAndMaxEndTime();

        assertEquals(7, morning.getMinStartTime().getHour());
        assertEquals(12, morning.getMaxEndTime().getHour());
        assertEquals(13, afternoon.getMinStartTime().getHour());
        assertEquals(18, afternoon.getMaxEndTime().getHour());
        assertEquals(18, evening.getMinStartTime().getHour());
        assertEquals(22, evening.getMaxEndTime().getHour());
    }

    @Test
    void rearrangeSortsAssignedTicketsAndRecomputesFollowingArrivalTime() {
        AgentEachDay agent = agent("agent-1", false, LocalDate.of(2026, 1, 2));
        Ticket first = assignedTicket("first", agent, LocalDateTime.of(2026, 1, 2, 9, 0));
        Ticket second = assignedTicket("second", agent, LocalDateTime.of(2026, 1, 2, 8, 0));
        first.setDuration(Duration.ofMinutes(20));
        second.setDuration(Duration.ofMinutes(20));
        agent.setTickets(new ArrayList<>(List.of(first, second)));
        TransitMatrix matrix = new TransitMatrix();
        matrix.put(second.getLoc().id, first.getLoc().id, new one.rewind.xforce.geo.transit.Transit(6000, 900));
        RoutePlan plan = new RoutePlan();
        plan.setAgents(List.of(agent));
        plan.setTickets(List.of(first, second));
        plan.setMatrix(matrix);

        plan.rearrange();

        assertEquals(List.of(second, first), agent.getTickets());
        assertEquals(Duration.ofMinutes(10), first.getDuration());
        assertEquals(Duration.ofMinutes(10), second.getDuration());
        assertEquals(LocalDateTime.of(2026, 1, 2, 8, 10).plusSeconds(900), first.getArrivalTime());
        assertEquals(7, second.getMinStartTime().getHour());
        assertEquals(12, second.getMaxEndTime().getHour());
    }

    @Test
    void serializeToAndFromRoundTripRoutePlan(@TempDir Path tempDir) throws Exception {
        Ticket ticket = ticket("ticket-1", LocalDateTime.of(2026, 1, 2, 9, 0));
        RoutePlan plan = new RoutePlan();
        plan.setTickets(List.of(ticket));
        Path target = tempDir.resolve("nested").resolve("route-plan.json");

        plan.serializeTo(target.toString());
        RoutePlan restored = RoutePlan.from(target.toString());

        assertEquals(1, restored.getTickets().size());
        assertEquals("ticket-1", restored.getTickets().getFirst().getId());
        assertNotNull(restored.getMatrix());
    }

    private static Ticket assignedTicket(String id, AgentEachDay agent, LocalDateTime arrivalTime) {
        Ticket ticket = ticket(id, arrivalTime);
        ticket.setAgent(agent);
        ticket.setArrivalTime(arrivalTime);
        return ticket;
    }

    private static AgentEachDay agent(String id, boolean virtual, LocalDate date) {
        Agent base = new Agent(id, id, "depo-a", new POI("start-" + id), List.of("Delv"), 10, 10);
        AgentEachDay agent = new AgentEachDay(base, date, LocalTime.of(8, 0), LocalTime.of(18, 0));
        agent.setVirtual(virtual);
        return agent;
    }

    private static Ticket ticket(String id, LocalDateTime minStartTime) {
        Ticket ticket = new Ticket(
                id,
                "depo-a",
                false,
                Ticket.Type.Delv,
                List.of("Delv"),
                1,
                1,
                new POI("poi-" + id),
                LocalDateTime.of(2026, 1, 1, 9, 0),
                minStartTime,
                minStartTime.withHour(18)
        );
        assertNotNull(ticket.getLoc());
        return ticket;
    }
}
