package one.rewind.xforce.vehicle_routing.service;

import one.rewind.here.HereAdapter;
import one.rewind.xforce.geo.POI;
import one.rewind.xforce.geo.Route;
import one.rewind.xforce.geo.RouteSource;
import one.rewind.xforce.geo.map.MapAdapterSelector;
import one.rewind.xforce.geo.transit.Transit;
import one.rewind.xforce.geo.transit.TransitMatrix;
import one.rewind.xforce.vehicle_routing.db.dto.SolverJob;
import one.rewind.xforce.vehicle_routing.db.repository.SolverJobRepository;
import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.domain.agent.Agent;
import one.rewind.xforce.vehicle_routing.domain.agent.AgentEachDay;
import one.rewind.xforce.vehicle_routing.domain.agent.Depo;
import one.rewind.xforce.vehicle_routing.domain.ticket.Ticket;
import one.rewind.xforce.vehicle_routing.io.DeployUtilBean;
import one.rewind.xforce.vehicle_routing.solver.RoutePlanConstraintProvider;
import one.rewind.xforce.vehicle_routing.solver.RouteScheduleInitializer;
import one.rewind.xforce.vehicle_routing.solver.Status;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.optaplanner.core.api.score.buildin.hardmediumsoftlong.HardMediumSoftLongScore;
import org.optaplanner.core.api.solver.SolutionManager;
import org.optaplanner.core.api.solver.SolverFactory;
import org.optaplanner.core.api.solver.SolverManager;
import org.optaplanner.core.config.solver.SolverConfig;

import java.lang.reflect.Proxy;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.function.Consumer;

import static org.junit.jupiter.api.Assertions.*;

/** Offline reproduction of search-time estimates being replaced by final road durations. */
public class SolverServiceRoadTimeTest {
    private SolverService service;
    private Consumer<RoutePlan> finalConsumer;

    protected SolutionManager<RoutePlan, HardMediumSoftLongScore> scoreManager() {
        return SolutionManager.create(SolverFactory.create(new SolverConfig()
                .withSolutionClass(RoutePlan.class)
                .withEntityClasses(AgentEachDay.class, Ticket.class)
                .withConstraintProviderClass(RoutePlanConstraintProvider.class)));
    }

    @AfterEach
    void shutdown() {
        if (service != null) {
            service.ses.shutdownNow();
        }
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void finalRoadTimesRefreshPinnedAndWaitingTicketsAndDoNotRestoreFeasibleSearchScore(boolean drawRoute) {
        RoutePlan plan = fixture();
        SolutionManager<RoutePlan, HardMediumSoftLongScore> manager = scoreManager();
        assertEquals(0, manager.update(plan).hardScore());
        HardMediumSoftLongScore searchScore = plan.getScore();
        CapturingRepository repository = start(plan, manager, drawRoute);
        AgentEachDay agent = plan.getAgents().getFirst();
        Ticket first = plan.getTickets().getFirst();
        Ticket second = plan.getTickets().getLast();

        // Simulate a final solution with stale transient handles after matrix replacement.
        // The unmoved/pinned first ticket must refresh even in draw_route=false mode.
        TransitMatrix replacement = matrix(plan);
        replacement.put("base", "first", new Transit(4000, 600));
        plan.setMatrix(replacement);
        AgentEachDay previousAgent = agent("previous-agent", agent.getStartLoc());
        second.setOriginalAgent(previousAgent);
        assertNotSame(plan.getMatrix(), first.matrix);

        finalConsumer.accept(plan);

        assertNull(repository.error);
        assertSame(plan, repository.finishedPlan);
        assertSame(plan.getMatrix(), agent.matrix);
        assertSame(plan.getMatrix(), first.matrix);
        assertSame(plan.getMatrix(), second.matrix);
        assertEquals(time(9, 10), first.getArrivalTime());
        assertEquals(time(9, 40), first.getDepartureTime());
        assertEquals(1200, second.getDrivingTimeSecondsFromPreviousStandstill());
        assertEquals(time(10, 0), second.getArrivalTime());
        assertEquals(time(10, 30), second.getStartServiceTime());
        assertEquals(time(10, 50), second.getDepartureTime());
        assertEquals(time(10, 57), agent.getTicketsDoneTime());
        assertEquals(2220, agent.getTotalDrivingTimeSeconds());
        assertTrue(first.isPinned());
        assertEquals(List.of(first, second), agent.getTickets());
        assertEquals(Duration.ofMinutes(30), first.getDuration());
        assertEquals(time(9, 35), first.getMaxEndTime());
        assertEquals(time(10, 30), second.getMinStartTime());
        assertSame(previousAgent, second.getOriginalAgent(), "Final timing refresh must not rewrite original assignment metadata");
        assertTrue(plan.getScore().hardScore() < 0, "The real late completion must not retain the old 0hard score");
        assertNotEquals(searchScore, plan.getScore());
        assertEquals(manager.explain(plan).getSummary(), repository.explanation);
        assertEquals(Status.SOLVING_FINISHED, repository.job.getStatus());
        if (drawRoute) {
            assertEquals(3, agent.getRoutes().size());
            assertEquals(RouteSource.HERE_DRIVING, agent.getRoutes().getFirst().routeSource);
        }
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void roadLookupFailureRemainsAnErrorAndNeverFinishesWithOldScore(boolean drawRoute) {
        RoutePlan plan = fixture();
        SolutionManager<RoutePlan, HardMediumSoftLongScore> manager = scoreManager();
        manager.update(plan);
        CapturingRepository repository = start(plan, manager, drawRoute);
        plan.getTickets().getLast().setOriginalAgent(agent("previous-agent", plan.getAgents().getFirst().getStartLoc()));
        service.mapAdapterSelector = new MapAdapterSelector(null, new OfflineHereAdapter() {
            @Override
            public Route routing(Agent agent, POI origin, POI destination) {
                throw new IllegalStateException("offline road lookup failed");
            }
        }, "HERE");

        finalConsumer.accept(plan);

        assertNotNull(repository.error);
        assertNull(repository.finishedPlan);
        assertEquals(Status.ERROR, repository.job.getStatus());
        assertTrue(service.progressSamplingFutures.isEmpty());
        assertTrue(service.scheduledFutures.isEmpty());
    }

    @SuppressWarnings("unchecked")
    private CapturingRepository start(RoutePlan plan, SolutionManager<RoutePlan, HardMediumSoftLongScore> manager, boolean drawRoute) {
        SolverManager<RoutePlan, UUID> solver = (SolverManager<RoutePlan, UUID>) Proxy.newProxyInstance(
                SolverManager.class.getClassLoader(), new Class<?>[]{SolverManager.class}, (proxy, method, args) -> {
                    if ("solveAndListen".equals(method.getName())) {
                        finalConsumer = (Consumer<RoutePlan>) args[3];
                    }
                    return null;
                });
        service = new SolverService(solver, manager);
        CapturingRepository repository = new CapturingRepository();
        service.solverJobRepository = repository;
        service.deployUtilBean = new DeployUtilBean();
        service.deployUtilBean.maxSolveTime = Duration.ofMinutes(10);
        service.mapAdapterSelector = new MapAdapterSelector(null, new OfflineHereAdapter(), "HERE");
        SolverJob job = new SolverJob();
        job.setPlan(plan);
        job.setSolveTime(Duration.ofMinutes(10));
        service.solve(job, drawRoute, null);
        return repository;
    }

    private static RoutePlan fixture() {
        POI base = poi("base", "-0.12,51.49");
        POI firstPoi = poi("first", "-0.13,51.50");
        POI secondPoi = poi("second", "-0.14,51.48");
        AgentEachDay agent = agent("agent-1", base);
        Ticket first = ticket("ticket-1", firstPoi, time(9, 0), time(9, 35), 30);
        first.setPinned(true);
        Ticket second = ticket("ticket-2", secondPoi, time(10, 30), time(11, 30), 20);
        agent.setTickets(new ArrayList<>(List.of(first, second)));
        RoutePlan plan = new RoutePlan();
        plan.setDepos(List.of(new Depo("depo-1", "Office", base)));
        plan.setAgents(List.of(agent));
        plan.setTickets(List.of(first, second));
        plan.getConstraintConfiguration().setServiceFinishedAfterMaxEndTime(HardMediumSoftLongScore.ONE_HARD);
        plan.setMatrix(matrix(plan));
        plan.init();
        RouteScheduleInitializer.initializePreassignedRoutes(plan);
        return plan;
    }

    private static TransitMatrix matrix(RoutePlan plan) {
        TransitMatrix matrix = new TransitMatrix();
        List<POI> points = List.of(plan.getAgents().getFirst().getStartLoc(), plan.getTickets().getFirst().getLoc(), plan.getTickets().getLast().getLoc());
        for (POI origin : points) {
            for (POI destination : points) {
                matrix.put(origin.id, destination.id, origin == destination ? Transit.ZERO : new Transit(100, 60));
            }
        }
        return matrix;
    }

    private static AgentEachDay agent(String id, POI start) {
        Agent base = new Agent(id, id, "depo-1", start, List.of("service"), 1, 1);
        return new AgentEachDay(base, LocalDate.of(2026, 11, 9), LocalTime.of(9, 0), LocalTime.of(18, 0));
    }

    private static Ticket ticket(String id, POI point, LocalDateTime min, LocalDateTime max, int minutes) {
        Ticket ticket = new Ticket(id, "depo-1", false, Ticket.Type.Inst, List.of("service"), 0, 0,
                point, time(8, 0), min, max);
        ticket.setDuration(Duration.ofMinutes(minutes));
        return ticket;
    }

    private static POI poi(String id, String location) {
        POI poi = new POI(id);
        poi.location = location;
        return poi;
    }

    private static LocalDateTime time(int hour, int minute) {
        return LocalDateTime.of(2026, 11, 9, hour, minute);
    }

    private static class OfflineHereAdapter extends HereAdapter {
        OfflineHereAdapter() {
            super("offline-test-only", 10, 100, 86400, 10, false);
        }

        @Override
        public Route routing(Agent agent, POI origin, POI destination) {
            long seconds = origin.id.equals("base") ? 600 : destination.id.equals("base") ? 420 : 1200;
            Route route = new Route(origin.getLoc(), destination.getLoc(), List.of(origin.getLoc(), destination.getLoc()),
                    new Transit(seconds * 5, seconds), 0);
            route.routeSource = RouteSource.HERE_DRIVING;
            return route;
        }
    }

    private static class CapturingRepository extends SolverJobRepository {
        private SolverJob job;
        private RoutePlan finishedPlan;
        private String explanation;
        private Throwable error;

        @Override
        public SolverJob saveCurrent(SolverJob job) {
            this.job = job;
            return job;
        }

        @Override
        public SolverJob findById(UUID id) {
            return job;
        }

        @Override
        public SolverJob finishJob(UUID id, RoutePlan plan, String explanation, long recordedAtMillis, long elapsedMillis) {
            assertEquals(job.getId(), id);
            this.finishedPlan = plan;
            this.explanation = explanation;
            job.setPlan(plan);
            job.setStatus(Status.SOLVING_FINISHED);
            return job;
        }

        @Override
        public void updateJob(UUID id, Throwable error) {
            this.error = error;
            job.setStatus(Status.ERROR);
        }
    }
}
