package one.rewind.xforce.vehicle_routing.solver;

import io.quarkus.runtime.annotations.RegisterForReflection;
import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.domain.agent.Agent;
import one.rewind.xforce.vehicle_routing.domain.ticket.Ticket;
import org.optaplanner.core.api.domain.variable.VariableListener;
import org.optaplanner.core.api.score.director.ScoreDirector;

import java.time.LocalDateTime;
import java.util.Objects;

import static one.rewind.xforce.vehicle_routing.domain.RoutePlan.logger;

@RegisterForReflection(serialization = true)
public class ArrivalTimeUpdatingVariableListener implements VariableListener<RoutePlan, Ticket> {

    private static final String ARRIVAL_TIME_FIELD = "arrivalTime";

    @Override
    public void beforeVariableChanged(ScoreDirector<RoutePlan> scoreDirector, Ticket ticket) {

    }

    /**
     * Agent的工单 增加/删除/顺序更改时 触发
     * @param scoreDirector never null
     * @param ticket never null
     */
    @Override
    public void afterVariableChanged(ScoreDirector<RoutePlan> scoreDirector, Ticket ticket) {

        if(ticket.getAgent() == null) {
            if(ticket.getArrivalTime() != null) {
                scoreDirector.beforeVariableChanged(ticket, ARRIVAL_TIME_FIELD);
                ticket.setArrivalTime(null);
                scoreDirector.afterVariableChanged(ticket, ARRIVAL_TIME_FIELD);
            }
            return;
        }

        Ticket previousTicket = ticket.getPreviousTicket();

        // 计算当前工单的出发时间
        LocalDateTime departureTime =
                previousTicket == null ? ticket.getAgent().getShiftStartTime() : previousTicket.getDepartureTime();

        // 级联更新后续所有Ticket的arrival_time
        Ticket nextTicket = ticket;

        while (nextTicket != null) {
            LocalDateTime arrivalTime = calculateArrivalTime(nextTicket, departureTime);

            if (!Objects.equals(nextTicket.getArrivalTime(), arrivalTime)) {
                scoreDirector.beforeVariableChanged(nextTicket, ARRIVAL_TIME_FIELD);
                nextTicket.setArrivalTime(arrivalTime);
                scoreDirector.afterVariableChanged(nextTicket, ARRIVAL_TIME_FIELD);
            }

            departureTime = nextTicket.getDepartureTime();
            nextTicket = nextTicket.getNextTicket();
        }
    }

    @Override
    public void beforeEntityAdded(ScoreDirector<RoutePlan> scoreDirector, Ticket ticket) {

    }

    @Override
    public void afterEntityAdded(ScoreDirector<RoutePlan> scoreDirector, Ticket ticket) {
        logger.info(ticket);
    }

    @Override
    public void beforeEntityRemoved(ScoreDirector<RoutePlan> scoreDirector, Ticket ticket) {

    }

    @Override
    public void afterEntityRemoved(ScoreDirector<RoutePlan> scoreDirector, Ticket ticket) {

    }

    /**
     *
     * @param ticket
     * @param previousDepartureTime
     * @return
     */
    private LocalDateTime calculateArrivalTime(Ticket ticket, LocalDateTime previousDepartureTime) {

        if (ticket == null || previousDepartureTime == null || ticket.getAgent() == null) {
            return null;
        }

        return RouteScheduleInitializer.calculateArrivalTime(ticket, previousDepartureTime);
    }
}
