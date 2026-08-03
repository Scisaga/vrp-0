package one.rewind.xforce.vehicle_routing.domain.test;

import one.rewind.xforce.geo.POI;
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
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TicketDomainTest {

    @Test
    void estimateDurationUsesTicketTypeAndRoundedWeight() {
        Ticket delivery = ticket("delivery", Ticket.Type.Delv);
        delivery.setWeight(2.1F);
        Ticket install = ticket("install", Ticket.Type.Inst);
        install.setWeight(2.1F);

        assertEquals(Duration.ofMinutes(20), delivery.estimateDuration());
        assertEquals(Duration.ofMinutes(35), install.estimateDuration());
    }

    @Test
    void departureTimeStartsNoEarlierThanMinStartTimeAndAddsDuration() {
        Ticket ticket = ticket("ticket-1", Ticket.Type.Delv);
        ticket.setMinStartTime(LocalDateTime.of(2026, 1, 2, 10, 0));
        ticket.setArrivalTime(LocalDateTime.of(2026, 1, 2, 9, 0));
        ticket.setDuration(Duration.ofMinutes(45));

        assertEquals(LocalDateTime.of(2026, 1, 2, 10, 45), ticket.getDepartureTime());
    }

    @Test
    void virtualAgentDepartureTimeDoesNotAddServiceDuration() {
        AgentEachDay virtualAgent = agent("agent-virtual");
        virtualAgent.setVirtual(true);
        Ticket ticket = ticket("ticket-1", Ticket.Type.Delv);
        ticket.setAgent(virtualAgent);
        ticket.setMinStartTime(LocalDateTime.of(2026, 1, 2, 10, 0));
        ticket.setArrivalTime(LocalDateTime.of(2026, 1, 2, 11, 0));
        ticket.setDuration(Duration.ofHours(2));

        assertEquals(LocalDateTime.of(2026, 1, 2, 11, 0), ticket.getDepartureTime());
    }

    @Test
    void isMovedOnlyWhenOriginalNonVirtualAgentDiffersFromCurrentAgent() {
        AgentEachDay original = agent("agent-original");
        AgentEachDay current = agent("agent-current");
        Ticket unchanged = ticket("unchanged", Ticket.Type.Delv);
        unchanged.setOriginalAgent(original);
        unchanged.setAgent(original);
        Ticket moved = ticket("moved", Ticket.Type.Delv);
        moved.setOriginalAgent(original);
        moved.setAgent(current);

        assertFalse(unchanged.isMoved());
        assertTrue(moved.isMoved());
    }

    private static AgentEachDay agent(String id) {
        Agent base = new Agent(id, id, "depo-a", new POI("start-" + id), List.of("Delv"), 10, 10);
        return new AgentEachDay(base, LocalDate.of(2026, 1, 2), LocalTime.of(8, 0), LocalTime.of(18, 0));
    }

    private static Ticket ticket(String id, Ticket.Type type) {
        LocalDateTime createTime = LocalDateTime.of(2026, 1, 1, 9, 0);
        return new Ticket(
                id,
                "depo-a",
                false,
                type,
                List.of(type == Ticket.Type.Inst ? "Inst" : "Delv"),
                1,
                1,
                new POI("poi-" + id),
                createTime,
                LocalDateTime.of(2026, 1, 2, 8, 0),
                LocalDateTime.of(2026, 1, 2, 18, 0)
        );
    }
}
