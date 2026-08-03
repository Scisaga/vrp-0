package one.rewind.xforce.vehicle_routing.solver.filter;

import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.domain.ticket.Ticket;
import org.optaplanner.core.api.score.director.ScoreDirector;
import org.optaplanner.core.impl.heuristic.selector.common.decorator.SelectionFilter;
import org.optaplanner.core.impl.heuristic.selector.move.generic.list.ListChangeMove;

public class TicketChangeMoveFilter implements SelectionFilter<RoutePlan, ListChangeMove<RoutePlan>> {

    @Override
    public boolean accept(ScoreDirector<RoutePlan> scoreDirector, ListChangeMove<RoutePlan> selection) {
        Ticket t = (Ticket) selection.getMovedValue();

        /*System.out.println("Change >>> " + t.getId() + "=" + t.isPinned());*/

        return !t.isPinned(); // 禁止移动固定票据
    }
}