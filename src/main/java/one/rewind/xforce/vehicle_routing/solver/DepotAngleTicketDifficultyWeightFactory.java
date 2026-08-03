package one.rewind.xforce.vehicle_routing.solver;

import one.rewind.xforce.geo.POI;
import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.domain.ticket.Ticket;
import org.optaplanner.core.impl.heuristic.selector.common.decorator.SelectionSorterWeightFactory;

import static java.util.Comparator.comparingDouble;
import static java.util.Comparator.comparingLong;

import java.time.ZoneOffset;
import java.util.Comparator;

/**
 * On large datasets, the constructed solution looks like pizza slices.
 */
public class DepotAngleTicketDifficultyWeightFactory
        implements SelectionSorterWeightFactory<RoutePlan, Ticket> {

    @Override
    public DepotAngleTicketDifficultyWeight createSorterWeight(RoutePlan plan, Ticket ticket) {
        POI depot = plan.getAgents().get(0).getStartLoc();
        return new DepotAngleTicketDifficultyWeight(ticket,
                ticket.getLoc().getAngle(depot),
                ticket.matrix.get(ticket.getLoc().id, depot.id).distance()
                        + ticket.matrix.get(depot.id, ticket.getLoc().id).distance());
    }

    public static class DepotAngleTicketDifficultyWeight
            implements Comparable<DepotAngleTicketDifficultyWeight> {

        private static final Comparator<DepotAngleTicketDifficultyWeight> COMPARATOR = comparingDouble(
                (DepotAngleTicketDifficultyWeight weight) -> weight.depotAngle)
                .thenComparingLong(weight -> weight.depotRoundTripDistance) // Ascending (further from the depot are more difficult)
                .thenComparing(weight -> weight.ticket, comparingLong(t -> t.getCreateTime().toEpochSecond(ZoneOffset.UTC)));

        private final Ticket ticket;
        private final double depotAngle;
        private final long depotRoundTripDistance;

        public DepotAngleTicketDifficultyWeight(Ticket ticket,
                                                double depotAngle, long depotRoundTripDistance) {
            this.ticket = ticket;
            this.depotAngle = depotAngle;
            this.depotRoundTripDistance = depotRoundTripDistance;
        }

        @Override
        public int compareTo(DepotAngleTicketDifficultyWeight other) {
            return COMPARATOR.compare(this, other);
        }
    }
}
