package one.rewind.xforce.vehicle_routing.service;

import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import org.junit.jupiter.api.Tag;
import org.optaplanner.core.api.score.buildin.hardmediumsoftlong.HardMediumSoftLongScore;
import org.optaplanner.core.api.solver.SolutionManager;

/** Same offline road regression with the application's real OptaPlanner configuration. */
@QuarkusTest
@Tag("app")
public class SolverServiceRoadTimeAppTest extends SolverServiceRoadTimeTest {
    @Inject
    SolutionManager<RoutePlan, HardMediumSoftLongScore> applicationSolutionManager;

    @Override
    protected SolutionManager<RoutePlan, HardMediumSoftLongScore> scoreManager() {
        return applicationSolutionManager;
    }
}
