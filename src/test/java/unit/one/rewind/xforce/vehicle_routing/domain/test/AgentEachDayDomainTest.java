package one.rewind.xforce.vehicle_routing.domain.test;

import one.rewind.xforce.geo.POI;
import one.rewind.xforce.geo.transit.Transit;
import one.rewind.xforce.geo.transit.TransitMatrix;
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

class AgentEachDayDomainTest {

    @Test
    void constructorCopiesOperationalFieldsFromBaseAgent() {
        Agent base = new Agent("agent-1", "Agent 1", "depo-a", new POI("start"), List.of("Delv"), 8, 12);
        base.setVirtual(true);
        base.setFixCostDaily(88);
        base.setVehicleType(Agent.VehicleType.TRUCK);

        AgentEachDay agent = new AgentEachDay(base, LocalDate.of(2026, 1, 2), LocalTime.of(8, 0), LocalTime.of(18, 0));

        assertEquals("depo-a", agent.getDepoId());
        assertEquals(true, agent.isVirtual());
        assertEquals(88, agent.getFixCostDaily());
        assertEquals(Agent.VehicleType.TRUCK, agent.getVehicleType());
    }

    @Test
    void transitLoadingReturnsMaximumLoadAcrossDeliveryAndReturnTickets() {
        AgentEachDay agent = agent();
        Ticket deliveryA = ticket("ticket-a", Ticket.Type.Delv, 4, 2);
        Ticket deliveryB = ticket("ticket-b", Ticket.Type.Delv, 2, 1);
        Ticket returnTicket = ticket("ticket-c", Ticket.Type.Delv_BH, 3, 1);
        agent.setTickets(List.of(deliveryA, deliveryB, returnTicket));

        Agent.Capacity loading = agent.getTransitLoading();

        assertEquals(6, loading.weight());
        assertEquals(3, loading.vol());
    }

    @Test
    void drivingMetricsAndDoneTimeUseTransitMatrixAndReturnToStart() {
        POI start = new POI("start");
        POI firstLoc = new POI("ticket-1-loc");
        POI secondLoc = new POI("ticket-2-loc");
        AgentEachDay agent = agent(start);
        Ticket first = ticket("ticket-1", Ticket.Type.Delv, firstLoc);
        Ticket second = ticket("ticket-2", Ticket.Type.Delv, secondLoc);
        second.setArrivalTime(LocalDateTime.of(2026, 1, 2, 9, 0));
        second.setDuration(Duration.ofMinutes(10));
        agent.setTickets(List.of(first, second));
        agent.matrix = new TransitMatrix()
                .put(start.id, firstLoc.id, new Transit(100, 10))
                .put(firstLoc.id, secondLoc.id, new Transit(200, 20))
                .put(secondLoc.id, start.id, new Transit(300, 30));

        assertEquals(60, agent.getTotalDrivingTimeSeconds());
        assertEquals(600, agent.getTotalDrivingDistanceMeters());
        assertEquals(LocalDateTime.of(2026, 1, 2, 9, 10, 30), agent.getTicketsDoneTime());
    }

    private static AgentEachDay agent() {
        return agent(new POI("start"));
    }

    private static AgentEachDay agent(POI start) {
        Agent base = new Agent("agent-1", "Agent 1", "depo-a", start, List.of("Delv"), 10, 10);
        return new AgentEachDay(base, LocalDate.of(2026, 1, 2), LocalTime.of(8, 0), LocalTime.of(18, 0));
    }

    private static Ticket ticket(String id, Ticket.Type type, float weight, float vol) {
        Ticket ticket = ticket(id, type, new POI("poi-" + id));
        ticket.setWeight(weight);
        ticket.setVol(vol);
        return ticket;
    }

    private static Ticket ticket(String id, Ticket.Type type, POI loc) {
        LocalDateTime createTime = LocalDateTime.of(2026, 1, 1, 9, 0);
        return new Ticket(
                id,
                "depo-a",
                false,
                type,
                List.of("Delv"),
                1,
                1,
                loc,
                createTime,
                LocalDateTime.of(2026, 1, 2, 8, 0),
                LocalDateTime.of(2026, 1, 2, 18, 0)
        );
    }
}
