package one.rewind.xforce.vehicle_routing.solver.filter;

import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.domain.ticket.Ticket;
import org.optaplanner.core.api.score.director.ScoreDirector;
import org.optaplanner.core.impl.heuristic.selector.common.decorator.SelectionFilter;
import org.optaplanner.core.impl.heuristic.selector.move.generic.list.ListChangeMove;
import org.optaplanner.core.impl.heuristic.selector.move.generic.list.ListSwapMove;

public class TicketSwapMoveFilter implements SelectionFilter<RoutePlan, ListSwapMove<RoutePlan>> {

    @Override
    public boolean accept(ScoreDirector<RoutePlan> scoreDirector, ListSwapMove<RoutePlan> selection) {

        Ticket t1 = (Ticket) selection.getLeftValue();
        Ticket t2 = (Ticket) selection.getRightValue();

        /*System.out.println("Swap >>> " + t1.getId() + "=" + t1.isPinned() + "\t" + t2.getId() + "=" + t2.isPinned());*/

        return !t1.isPinned() && !t2.isPinned(); // 禁止移动固定票据
    }
}