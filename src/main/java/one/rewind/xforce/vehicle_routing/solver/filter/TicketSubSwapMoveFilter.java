package one.rewind.xforce.vehicle_routing.solver.filter;

import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.domain.agent.AgentEachDay;
import one.rewind.xforce.vehicle_routing.domain.ticket.Ticket;
import org.optaplanner.core.api.score.director.ScoreDirector;
import org.optaplanner.core.impl.heuristic.selector.common.decorator.SelectionFilter;
import org.optaplanner.core.impl.heuristic.selector.list.SubList;
import org.optaplanner.core.impl.heuristic.selector.move.generic.list.ListSwapMove;
import org.optaplanner.core.impl.heuristic.selector.move.generic.list.SubListSwapMove;

import java.util.List;

public class TicketSubSwapMoveFilter implements SelectionFilter<RoutePlan, SubListSwapMove<RoutePlan>> {

    @Override
    public boolean accept(ScoreDirector<RoutePlan> scoreDirector, SubListSwapMove<RoutePlan> selection) {

        var leftSubList = selection.getLeftSubList();
        var rightSubList = selection.getRightSubList();

        return check(leftSubList) && check(rightSubList);
    }

    /**
     *
     * @param subList
     * @return
     */
    private boolean check(SubList subList) {

        Object entity = subList.getEntity();
        if (!(entity instanceof AgentEachDay)) {
            return false;
        }

        List<Ticket> tickets = ((AgentEachDay) entity).getTickets();
        for (int i = subList.getFromIndex(); i < subList.getToIndex(); i++) {
            Ticket t = tickets.get(i);
            if(t.isPinned()) return false;
        }

        return true;
    }
}