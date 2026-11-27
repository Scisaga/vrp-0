package one.rewind.xforce.vehicle_routing.bootstrap;

import io.smallrye.config.EnvConfigSource;
import io.smallrye.config.SmallRyeConfigBuilder;
import one.rewind.amap.AmapAdapter;
import one.rewind.here.HereAdapter;
import one.rewind.xforce.geo.POI;
import one.rewind.xforce.geo.Route;
import one.rewind.xforce.geo.RouteSource;
import one.rewind.xforce.geo.map.MapAdapter;
import one.rewind.xforce.geo.map.MapProvider;
import one.rewind.xforce.geo.map.MatrixRoutingKey;
import one.rewind.xforce.geo.transit.AmapTransitCalculator;
import one.rewind.xforce.geo.transit.Transit;
import one.rewind.xforce.geo.transit.TransitMatrix;
import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.domain.agent.Agent;
import one.rewind.xforce.vehicle_routing.domain.agent.AgentEachDay;
import one.rewind.xforce.vehicle_routing.domain.agent.Depo;
import one.rewind.xforce.vehicle_routing.domain.ticket.Ticket;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.lang.reflect.Field;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BiFunction;

import static org.junit.jupiter.api.Assertions.*;

class GeoUtilRoutingTest {

    @TempDir Path tempDir;
    private Field amapSingleton;
    private Object previousAdapter;
    private TransitMatrix previousCache;

    @BeforeEach
    void isolateLegacyCache() throws Exception {
        amapSingleton = AmapAdapter.class.getDeclaredField("inst");
        amapSingleton.setAccessible(true);
        previousAdapter = amapSingleton.get(null);
        previousCache = AmapTransitCalculator.inst().getCachedMatrix();
        AmapTransitCalculator.inst().setCachedMatrix(new TransitMatrix());
    }

    @AfterEach
    void restoreLegacyCache() throws Exception {
        amapSingleton.set(null, previousAdapter);
        AmapTransitCalculator.inst().setCachedMatrix(previousCache);
    }

    @Test
    void defaultEnvironmentOverrideAndPositiveConcurrencyAreSupported() {
        assertEquals(16, GeoUtil.matrixConcurrency(new SmallRyeConfigBuilder().build()));
        assertEquals(8, GeoUtil.matrixConcurrency(new SmallRyeConfigBuilder()
                .withSources(new EnvConfigSource(Map.of("MAP_MATRIX_CONCURRENCY", "8"), 300)).build()));
        for (String invalid : List.of("0", "-1", "invalid")) {
            assertThrows(IllegalArgumentException.class, () -> GeoUtil.matrixConcurrency(new SmallRyeConfigBuilder()
                    .withDefaultValue("map.matrix-concurrency", invalid).build()));
        }
    }

    @Test
    void thirtyTicketsAtThirteenPointsLoadEachNonzeroHerePairAtMostOnce() throws Exception {
        RoutePlan plan = plan("budget", 30, 12);
        CountingHereAdapter adapter = new CountingHereAdapter((origin, destination) -> route(origin, destination, MapProvider.HERE));
        GeoUtil.buildMatrix(plan, GeoUtil.MatrixMode.ROUTING, adapter);

        assertEquals(30, plan.getTickets().size());
        assertEquals(8, plan.getAgents().size());
        assertEquals(13, plan.getPois().size());
        assertFalse(adapter.calls.isEmpty());
        assertTrue(adapter.calls.size() <= 156);
        adapter.calls.forEach((key, calls) -> {
            assertNotEquals(key.origin(), key.destination());
            assertEquals(1, calls.get());
        });
        for (POI origin : plan.getPois()) {
            for (POI destination : plan.getPois()) {
                assertNotEquals(Transit.MAX, plan.getMatrix().get(origin.id, destination.id));
            }
        }
        System.out.println("Synthetic HERE budget: tickets=30 agents=8 points=13 unique_nonzero_loads=" + adapter.calls.size());
    }

    @Test
    void routingWorkersRespectEightAndSixteenForBothProvidersAndTerminate() throws Exception {
        for (MapProvider provider : List.of(MapProvider.HERE, MapProvider.AMAP)) {
            for (int concurrency : List.of(8, 16)) {
                AmapTransitCalculator.inst().setCachedMatrix(new TransitMatrix());
                RoutePlan plan = plan(provider + "-" + concurrency, 24, 24);
                CountDownLatch entered = new CountDownLatch(concurrency);
                CountDownLatch release = new CountDownLatch(1);
                AtomicInteger active = new AtomicInteger();
                AtomicInteger maximum = new AtomicInteger();
                Set<Thread> workers = ConcurrentHashMap.newKeySet();
                BiFunction<POI, POI, Route> response = (origin, destination) -> {
                    workers.add(Thread.currentThread());
                    maximum.accumulateAndGet(active.incrementAndGet(), Math::max);
                    entered.countDown();
                    try {
                        await(release);
                        return route(origin, destination, provider);
                    } finally {
                        active.decrementAndGet();
                    }
                };
                MapAdapter adapter = provider == MapProvider.HERE ? new CountingHereAdapter(response)
                        : new CountingAmapAdapter(tempDir.resolve(provider + "-" + concurrency + ".json"), response);
                List<POI> points = points(plan);
                try (ExecutorService builder = Executors.newSingleThreadExecutor()) {
                    Future<?> result = builder.submit(() -> GeoUtil.buildMatrixByRouting(
                            plan, points, TransitMatrix.init(points), adapter, concurrency));
                    try {
                        assertTrue(entered.await(5, TimeUnit.SECONDS), provider + " must fill its configured worker slots");
                        assertEquals(concurrency, active.get());
                        assertEquals(concurrency, maximum.get());
                    } finally {
                        release.countDown();
                    }
                    result.get(10, TimeUnit.SECONDS);
                }
                assertTrue(maximum.get() <= concurrency);
                assertEquals(concurrency, workers.size());
                for (Thread worker : workers) {
                    worker.join(5000);
                    assertFalse(worker.isAlive(), "Matrix worker must terminate after the build");
                }
            }
        }
    }

    @Test
    void interruptedBuildPreservesFlagAndStopsItsWorkers() throws Exception {
        RoutePlan plan = plan("interrupt", 24, 24);
        CountDownLatch entered = new CountDownLatch(8);
        CountDownLatch release = new CountDownLatch(1);
        Set<Thread> workers = ConcurrentHashMap.newKeySet();
        CountingHereAdapter adapter = new CountingHereAdapter((origin, destination) -> {
            workers.add(Thread.currentThread());
            entered.countDown();
            await(release);
            return route(origin, destination, MapProvider.HERE);
        });
        AtomicBoolean flagPreserved = new AtomicBoolean();
        Thread builder = new Thread(() -> {
            try {
                List<POI> points = points(plan);
                GeoUtil.buildMatrixByRouting(plan, points, TransitMatrix.init(points), adapter, 8);
            } catch (RuntimeException error) {
                flagPreserved.set(Thread.currentThread().isInterrupted());
            }
        });
        builder.start();
        try {
            assertTrue(entered.await(5, TimeUnit.SECONDS));
            builder.interrupt();
            builder.join(5000);
            assertFalse(builder.isAlive());
            assertTrue(flagPreserved.get());
        } finally {
            release.countDown();
            builder.interrupt();
            builder.join(5000);
        }
        for (Thread worker : workers) {
            worker.join(5000);
            assertFalse(worker.isAlive());
        }
    }

    @Test
    void manhattanAndHereBatchBranchesDoNotUseOrdinaryRouting() throws Exception {
        AtomicInteger batches = new AtomicInteger();
        HereAdapter batch = new HereAdapter("fixture-key", 100, 10000, 86400, 2, true) {
            @Override
            public TransitMatrix matrixRouting(List<POI> points) {
                batches.incrementAndGet();
                return TransitMatrix.init(points);
            }

            @Override
            public Route routing(POI origin, POI destination) {
                throw new AssertionError("Ordinary routing must not run in these branches");
            }
        };
        GeoUtil.buildMatrix(plan("manhattan", 2, 2), GeoUtil.MatrixMode.MANHATTAN, batch);
        assertEquals(0, batches.get());
        GeoUtil.buildMatrix(plan("batch", 2, 2), GeoUtil.MatrixMode.ROUTING, batch);
        assertEquals(1, batches.get());
    }

    private static void await(CountDownLatch latch) {
        try {
            assertTrue(latch.await(5, TimeUnit.SECONDS));
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new CompletionException(error);
        }
    }

    private static List<POI> points(RoutePlan plan) {
        List<POI> points = new ArrayList<>();
        points.add(plan.getDepos().getFirst().getLoc());
        plan.getTickets().stream().map(Ticket::getLoc).distinct().forEach(points::add);
        return points;
    }

    private static RoutePlan plan(String prefix, int ticketCount, int ticketPointCount) {
        List<POI> points = new ArrayList<>();
        for (int i = 0; i <= ticketPointCount; i++) {
            POI point = new POI(prefix + "-point-" + i);
            point.location = (100 + (i % 5) * 0.05) + "," + (30 + (i / 5) * 0.05);
            points.add(point);
        }
        Depo depo = new Depo("depo", "depo", points.getFirst());
        List<AgentEachDay> agents = new ArrayList<>();
        for (int i = 0; i < 8; i++) {
            Agent base = new Agent("agent-" + i, "agent-" + i, "depo", points.getFirst(), List.of("Delv"), 100, 100);
            agents.add(new AgentEachDay(base, LocalDate.of(2026, 1, 2), LocalTime.of(8, 0), LocalTime.of(18, 0)));
        }
        List<Ticket> tickets = new ArrayList<>();
        LocalDateTime start = LocalDateTime.of(2026, 1, 2, 9, 0);
        for (int i = 0; i < ticketCount; i++) {
            tickets.add(new Ticket("ticket-" + i, "depo", false, Ticket.Type.Delv, List.of("Delv"), 1, 1,
                    points.get(1 + i % ticketPointCount), start.minusDays(1), start, start.withHour(18)));
        }
        RoutePlan plan = new RoutePlan();
        plan.setDepos(List.of(depo));
        plan.setAgents(agents);
        plan.setTickets(tickets);
        plan.setMatrix(new TransitMatrix());
        return plan;
    }

    private static Route route(POI origin, POI destination, MapProvider provider) {
        Route route = new Route(origin.getLoc(), destination.getLoc(), List.of(), new Transit(5000, 500), 0);
        route.routeSource = provider == MapProvider.HERE ? RouteSource.HERE_DRIVING : RouteSource.AMAP_DRIVING;
        return route;
    }

    private static class CountingHereAdapter extends HereAdapter {
        final Map<MatrixRoutingKey, AtomicInteger> calls = new ConcurrentHashMap<>();
        private final BiFunction<POI, POI, Route> response;

        CountingHereAdapter(BiFunction<POI, POI, Route> response) {
            super("fixture-key", 100, 10000, 86400, 2, false);
            this.response = response;
        }

        @Override
        public Route routing(POI origin, POI destination) {
            calls.computeIfAbsent(matrixRoutingKey(origin, destination), key -> new AtomicInteger()).incrementAndGet();
            return response.apply(origin, destination);
        }
    }

    private static class CountingAmapAdapter extends AmapAdapter {
        private final BiFunction<POI, POI, Route> response;

        CountingAmapAdapter(Path configFile, BiFunction<POI, POI, Route> response) {
            super(false, "change-me", 100, 10000, 86400, 2, configFile.toString(),
                    GeocodeProvider.AMAP, "http://example.invalid", false);
            this.response = response;
        }

        @Override
        public Route routing(POI origin, POI destination) {
            return response.apply(origin, destination);
        }
    }
}
