package one.rewind.xforce.vehicle_routing.solver.filter;

import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.domain.ticket.Ticket;
import org.optaplanner.core.api.score.director.ScoreDirector;
import org.optaplanner.core.impl.heuristic.selector.common.decorator.SelectionFilter;
import org.optaplanner.core.impl.heuristic.selector.move.generic.list.ListChangeMove;
import org.optaplanner.core.impl.heuristic.selector.move.generic.list.SubListChangeMove;

public class TicketSubChangeMoveFilter implements SelectionFilter<RoutePlan, SubListChangeMove<RoutePlan>> {

    @Override
    public boolean accept(ScoreDirector<RoutePlan> scoreDirector, SubListChangeMove<RoutePlan> selection) {

        for(Object value : selection.getPlanningEntities()) {
            if (value instanceof Ticket && ((Ticket) value).isPinned()) {
                return false; // 禁止移动固定票据
            }
        }
        return true;
    }
}