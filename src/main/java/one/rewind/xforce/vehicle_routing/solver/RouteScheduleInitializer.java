package one.rewind.xforce.vehicle_routing.solver;

import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.domain.agent.AgentEachDay;
import one.rewind.xforce.vehicle_routing.domain.ticket.Ticket;

import java.time.LocalDateTime;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Set;

/**
 * Builds the initial shadow relationships and arrival-time chain from preassigned route lists.
 */
public final class RouteScheduleInitializer {

    private RouteScheduleInitializer() {
    }

    /**
     * The initial solver score is calculated before custom phases run. Therefore preassigned
     * routes must have their shadow values populated before the plan is handed to the solver.
     */
    public static void initializePreassignedRoutes(RoutePlan routePlan) {
        Set<Ticket> assignedTickets = Collections.newSetFromMap(new IdentityHashMap<>());

        for (AgentEachDay agent : routePlan.getAgents()) {
            List<Ticket> tickets = agent.getTickets();
            if (tickets == null || tickets.isEmpty()) {
                continue;
            }

            Ticket previousTicket = null;
            for (Ticket ticket : tickets) {
                assignedTickets.add(ticket);
                ticket.setAgent(agent);
                ticket.setPreviousTicket(previousTicket);
                ticket.setNextTicket(null);

                if (previousTicket != null) {
                    previousTicket.setNextTicket(ticket);
                }

                LocalDateTime departureTime = previousTicket == null
                        ? agent.getShiftStartTime()
                        : previousTicket.getDepartureTime();
                ticket.setArrivalTime(calculateArrivalTime(ticket, departureTime));
                previousTicket = ticket;
            }
        }

        for (Ticket ticket : routePlan.getTickets()) {
            if (!assignedTickets.contains(ticket)) {
                ticket.setAgent(null);
                ticket.setPreviousTicket(null);
                ticket.setNextTicket(null);
                ticket.setArrivalTime(null);
            }
        }
    }

    public static LocalDateTime calculateArrivalTime(Ticket ticket, LocalDateTime previousDepartureTime) {
        if (ticket == null || previousDepartureTime == null || ticket.getAgent() == null) {
            return null;
        }

        long drivingTimeSeconds = ticket.getAgent().isVirtual()
                ? 0
                : ticket.getDrivingTimeSecondsFromPreviousStandstill();
        if (drivingTimeSeconds == Long.MAX_VALUE) {
            return null;
        }

        return previousDepartureTime.plusSeconds(drivingTimeSeconds);
    }
}
