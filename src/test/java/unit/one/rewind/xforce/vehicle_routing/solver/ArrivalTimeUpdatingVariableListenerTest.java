package one.rewind.xforce.vehicle_routing.solver;

import one.rewind.xforce.geo.POI;
import one.rewind.xforce.geo.transit.Transit;
import one.rewind.xforce.geo.transit.TransitMatrix;
import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.domain.agent.Agent;
import one.rewind.xforce.vehicle_routing.domain.agent.AgentEachDay;
import one.rewind.xforce.vehicle_routing.domain.ticket.Ticket;
import org.junit.jupiter.api.Test;
import org.optaplanner.core.api.score.director.ScoreDirector;

import java.lang.reflect.Proxy;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class ArrivalTimeUpdatingVariableListenerTest {

    private final ArrivalTimeUpdatingVariableListener listener = new ArrivalTimeUpdatingVariableListener();

    @Test
    void afterVariableChangedCascadesArrivalTimesThroughTicketChain() {
        POI start = new POI("start");
        POI firstLoc = new POI("ticket-1-loc");
        POI secondLoc = new POI("ticket-2-loc");
        TransitMatrix matrix = new TransitMatrix()
                .put(start.id, firstLoc.id, new Transit(1_000, 600))
                .put(firstLoc.id, secondLoc.id, new Transit(1_000, 900));

        AgentEachDay agent = agent(start);
        Ticket first = ticket("ticket-1", firstLoc, matrix);
        Ticket second = ticket("ticket-2", secondLoc, matrix);
        first.setAgent(agent);
        second.setAgent(agent);
        first.setNextTicket(second);
        second.setPreviousTicket(first);

        TrackingScoreDirector scoreDirector = new TrackingScoreDirector();

        listener.afterVariableChanged(scoreDirector.proxy(), first);

        assertEquals(LocalDateTime.of(2026, 1, 2, 8, 10), first.getArrivalTime());
        assertEquals(LocalDateTime.of(2026, 1, 2, 8, 35), second.getArrivalTime());
        assertEquals(List.of("before:ticket-1:arrivalTime", "after:ticket-1:arrivalTime",
                "before:ticket-2:arrivalTime", "after:ticket-2:arrivalTime"), scoreDirector.events);
    }

    @Test
    void afterVariableChangedClearsArrivalTimeWhenTicketBecomesUnassigned() {
        Ticket ticket = ticket("ticket-1", new POI("ticket-1-loc"), new TransitMatrix());
        ticket.setArrivalTime(LocalDateTime.of(2026, 1, 2, 9, 0));

        TrackingScoreDirector scoreDirector = new TrackingScoreDirector();

        listener.afterVariableChanged(scoreDirector.proxy(), ticket);

        assertNull(ticket.getArrivalTime());
        assertEquals(List.of("before:ticket-1:arrivalTime", "after:ticket-1:arrivalTime"), scoreDirector.events);
    }

    @Test
    void afterVariableChangedContinuesWhenCurrentArrivalTimeIsAlreadyCorrect() {
        POI start = new POI("start");
        POI firstLoc = new POI("ticket-1-loc");
        POI secondLoc = new POI("ticket-2-loc");
        TransitMatrix matrix = new TransitMatrix()
                .put(start.id, firstLoc.id, new Transit(1_000, 600))
                .put(firstLoc.id, secondLoc.id, new Transit(1_000, 900));

        AgentEachDay agent = agent(start);
        Ticket first = ticket("ticket-1", firstLoc, matrix);
        Ticket second = ticket("ticket-2", secondLoc, matrix);
        first.setAgent(agent);
        second.setAgent(agent);
        first.setNextTicket(second);
        second.setPreviousTicket(first);
        first.setArrivalTime(LocalDateTime.of(2026, 1, 2, 8, 10));

        TrackingScoreDirector scoreDirector = new TrackingScoreDirector();

        listener.afterVariableChanged(scoreDirector.proxy(), first);

        assertEquals(LocalDateTime.of(2026, 1, 2, 8, 10), first.getArrivalTime());
        assertEquals(LocalDateTime.of(2026, 1, 2, 8, 35), second.getArrivalTime());
        assertEquals(List.of("before:ticket-2:arrivalTime", "after:ticket-2:arrivalTime"), scoreDirector.events);
    }

    @SuppressWarnings("unchecked")
    private static final class TrackingScoreDirector {
        private final List<String> events = new ArrayList<>();

        ScoreDirector<RoutePlan> proxy() {
            return (ScoreDirector<RoutePlan>) Proxy.newProxyInstance(
                    ScoreDirector.class.getClassLoader(),
                    new Class<?>[]{ScoreDirector.class},
                    (proxy, method, args) -> {
                        if ("beforeVariableChanged".equals(method.getName()) || "afterVariableChanged".equals(method.getName())) {
                            Ticket ticket = (Ticket) args[0];
                            events.add(method.getName().replace("VariableChanged", "") + ":" + ticket.getId() + ":" + args[1]);
                            return null;
                        }
                        if ("getWorkingSolution".equals(method.getName())) {
                            return null;
                        }
                        throw new UnsupportedOperationException(method.getName());
                    });
        }
    }

    private static AgentEachDay agent(POI start) {
        Agent agent = new Agent("agent-1", "Agent 1", "depo-a", start, List.of("Delv"), 10, 10);
        return new AgentEachDay(agent, LocalDate.of(2026, 1, 2), LocalTime.of(8, 0), LocalTime.of(18, 0));
    }

    private static Ticket ticket(String id, POI loc, TransitMatrix matrix) {
        LocalDateTime createTime = LocalDateTime.of(2026, 1, 1, 9, 0);
        Ticket ticket = new Ticket(
                id,
                "depo-a",
                false,
                Ticket.Type.Delv,
                List.of("Delv"),
                1,
                1,
                loc,
                createTime,
                LocalDateTime.of(2026, 1, 2, 8, 0),
                LocalDateTime.of(2026, 1, 2, 18, 0)
        );
        ticket.setDuration(Duration.ofMinutes(10));
        ticket.matrix = matrix;
        return ticket;
    }
}
