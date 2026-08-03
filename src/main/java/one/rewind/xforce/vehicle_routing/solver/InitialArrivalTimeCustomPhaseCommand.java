package one.rewind.xforce.vehicle_routing.solver;

import io.quarkus.runtime.annotations.RegisterForReflection;
import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.domain.agent.AgentEachDay;
import one.rewind.xforce.vehicle_routing.domain.ticket.Ticket;
import org.optaplanner.core.api.score.director.ScoreDirector;
import org.optaplanner.core.impl.phase.custom.CustomPhaseCommand;

import java.util.List;

/**
 * Initializes the arrival-time shadow variable for routes that were assigned before solving.
 *
 * <p>The command runs after OptaPlanner has initialized the list-related shadow variables and
 * before the construction heuristic. Reusing the variable listener keeps warm-start routes and
 * move-driven routes on the same arrival-time calculation path.</p>
 */
@RegisterForReflection(serialization = true)
public class InitialArrivalTimeCustomPhaseCommand implements CustomPhaseCommand<RoutePlan> {

    private final ArrivalTimeUpdatingVariableListener arrivalTimeListener =
            new ArrivalTimeUpdatingVariableListener();

    @Override
    public void changeWorkingSolution(ScoreDirector<RoutePlan> scoreDirector) {
        RoutePlan routePlan = scoreDirector.getWorkingSolution();

        for (AgentEachDay agent : routePlan.getAgents()) {
            List<Ticket> tickets = agent.getTickets();
            if (tickets == null || tickets.isEmpty()) {
                continue;
            }

            arrivalTimeListener.afterVariableChanged(scoreDirector, tickets.getFirst());
        }
    }
}
