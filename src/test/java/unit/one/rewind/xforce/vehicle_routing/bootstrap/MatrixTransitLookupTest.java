package one.rewind.xforce.vehicle_routing.bootstrap;

import one.rewind.amap.AmapAdapter;
import one.rewind.here.HereAdapter;
import one.rewind.xforce.geo.LOC;
import one.rewind.xforce.geo.POI;
import one.rewind.xforce.geo.Route;
import one.rewind.xforce.geo.RouteSource;
import one.rewind.xforce.geo.transit.AmapTransitCalculator;
import one.rewind.xforce.geo.transit.Transit;
import one.rewind.xforce.geo.transit.TransitMatrix;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.lang.reflect.Field;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.locks.LockSupport;
import java.util.function.BiFunction;

import static org.junit.jupiter.api.Assertions.*;

class MatrixTransitLookupTest {

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
    void hereUsesNormalizedDirectedCoordinatesAndBuildLocalResults() {
        StubHereAdapter adapter = new StubHereAdapter();
        MatrixTransitLookup lookup = new MatrixTransitLookup(adapter);
        POI origin = poi("origin", "13.10,52.10");
        POI destination = poi("destination", "13.20,52.20");
        Transit first = lookup.apply(origin, destination);
        assertSame(first, lookup.apply(poi("different-id", "13.100, 52.100"), destination));
        assertEquals(1, adapter.calls.get());

        lookup.apply(destination, origin);
        assertEquals(2, adapter.calls.get(), "Reverse requests have their own key");
        origin.loc = origin.getLoc();
        origin.location = "13.30,52.30";
        lookup.apply(origin, destination);
        assertEquals(3, adapter.calls.get(), "Updated location takes precedence over a stale LOC");

        new MatrixTransitLookup(adapter).apply(origin, destination);
        assertEquals(4, adapter.calls.get(), "HERE results cannot leak to another build");
        assertEquals(4, lookup.stats().requests());
        assertEquals(1, lookup.stats().merged());
    }

    @Test
    void hereKeyUsesExistingLocFallbackAndCachesZeroWithoutHttp() {
        HereAdapter adapter = new HereAdapter("change-me", 100, 1000, 86400, 2, false);
        POI fallback = new POI("fallback");
        fallback.loc = new LOC(13.1, 52.1);
        POI explicit = poi("explicit", "13.1,52.1");
        assertEquals(adapter.matrixRoutingKey(fallback, explicit), adapter.matrixRoutingKey(explicit, fallback));
        MatrixTransitLookup lookup = new MatrixTransitLookup(adapter);
        assertEquals(Transit.ZERO, lookup.apply(fallback, explicit));
        assertEquals(Transit.ZERO, lookup.apply(explicit, fallback));
        assertEquals(1, lookup.stats().loads());
    }

    @Test
    void concurrentHereRequestsWaitForOneLoad() throws Exception {
        StubHereAdapter adapter = new StubHereAdapter();
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        adapter.response = (origin, destination) -> {
            entered.countDown();
            await(release);
            return route(origin, destination, RouteSource.HERE_DRIVING);
        };
        MatrixTransitLookup lookup = new MatrixTransitLookup(adapter);
        CyclicBarrier start = new CyclicBarrier(16);
        try (ExecutorService workers = Executors.newFixedThreadPool(16)) {
            List<Future<Transit>> results = new ArrayList<>();
            try {
                for (int i = 0; i < 16; i++) {
                    results.add(workers.submit(() -> {
                        start.await(5, TimeUnit.SECONDS);
                        return lookup.apply(poi("a", "13.1,52.1"), poi("b", "13.2,52.2"));
                    }));
                }
                assertTrue(entered.await(5, TimeUnit.SECONDS));
                awaitMerged(lookup, 15);
                assertEquals(1, adapter.calls.get());
            } finally {
                release.countDown();
            }
            Transit expected = results.getFirst().get(5, TimeUnit.SECONDS);
            for (Future<Transit> result : results) {
                assertSame(expected, result.get(5, TimeUnit.SECONDS));
            }
        }
        assertEquals(1, lookup.stats().loads());
    }

    @Test
    void failedLoadReleasesAllWaitersAndCanBeRetried() throws Exception {
        StubHereAdapter adapter = new StubHereAdapter();
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        adapter.response = (origin, destination) -> {
            if (adapter.calls.get() == 1) {
                entered.countDown();
                await(release);
                throw new IllegalStateException("fixture failure");
            }
            return route(origin, destination, RouteSource.HERE_DRIVING);
        };
        MatrixTransitLookup lookup = new MatrixTransitLookup(adapter);
        POI origin = poi("a", "13.1,52.1");
        POI destination = poi("b", "13.2,52.2");
        try (ExecutorService workers = Executors.newFixedThreadPool(2)) {
            Future<Transit> owner = workers.submit(() -> lookup.apply(origin, destination));
            assertTrue(entered.await(5, TimeUnit.SECONDS));
            Future<Transit> waiter = workers.submit(() -> lookup.apply(origin, destination));
            try {
                awaitMerged(lookup, 1);
            } finally {
                release.countDown();
            }
            assertInstanceOf(IllegalStateException.class,
                    assertThrows(ExecutionException.class, () -> owner.get(5, TimeUnit.SECONDS)).getCause());
            assertInstanceOf(IllegalStateException.class,
                    assertThrows(ExecutionException.class, () -> waiter.get(5, TimeUnit.SECONDS)).getCause());
        } finally {
            release.countDown();
        }
        Transit success = lookup.apply(origin, destination);
        assertSame(success, lookup.apply(origin, destination));
        assertEquals(2, adapter.calls.get());
    }

    @Test
    void estimatedAndUnreachableHereResultsDoNotPoisonTheCache() {
        for (boolean unreachable : List.of(false, true)) {
            StubHereAdapter adapter = new StubHereAdapter();
            adapter.response = (origin, destination) -> {
                Route result = route(origin, destination, RouteSource.HERE_DRIVING);
                if (adapter.calls.get() == 1) {
                    if (unreachable) {
                        result.transit = Transit.MAX;
                    } else {
                        result.routeSource = RouteSource.ESTIMATED;
                    }
                }
                return result;
            };
            MatrixTransitLookup lookup = new MatrixTransitLookup(adapter);
            POI origin = poi("a", "13.1,52.1");
            POI destination = poi("b", "13.2,52.2");
            lookup.apply(origin, destination);
            Transit success = lookup.apply(origin, destination);
            assertSame(success, lookup.apply(origin, destination));
            assertEquals(2, adapter.calls.get());
        }
    }

    @Test
    void interruptedWaiterDoesNotCancelTheSharedRequest() throws Exception {
        StubHereAdapter adapter = new StubHereAdapter();
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        adapter.response = (origin, destination) -> {
            entered.countDown();
            await(release);
            return route(origin, destination, RouteSource.HERE_DRIVING);
        };
        MatrixTransitLookup lookup = new MatrixTransitLookup(adapter);
        POI origin = poi("a", "13.1,52.1");
        POI destination = poi("b", "13.2,52.2");
        AtomicBoolean flagPreserved = new AtomicBoolean();
        CompletableFuture<Throwable> interrupted = new CompletableFuture<>();
        Thread waiter = new Thread(() -> {
            try {
                lookup.apply(origin, destination);
                interrupted.complete(new AssertionError("Waiter was not interrupted"));
            } catch (Throwable error) {
                flagPreserved.set(Thread.currentThread().isInterrupted());
                interrupted.complete(error);
            }
        });
        try (ExecutorService workers = Executors.newSingleThreadExecutor()) {
            Future<Transit> owner = workers.submit(() -> lookup.apply(origin, destination));
            try {
                assertTrue(entered.await(5, TimeUnit.SECONDS));
                waiter.start();
                awaitMerged(lookup, 1);
                waiter.interrupt();
                assertInstanceOf(CompletionException.class, interrupted.get(5, TimeUnit.SECONDS));
                assertTrue(flagPreserved.get());
                assertFalse(owner.isDone());
            } finally {
                release.countDown();
                waiter.interrupt();
                waiter.join(5000);
            }
            assertSame(owner.get(5, TimeUnit.SECONDS), lookup.apply(origin, destination));
        }
        assertFalse(waiter.isAlive());
        assertEquals(1, adapter.calls.get());
    }

    @Test
    void amapKeepsPoiIdsInItsKeyAndPreservesLegacyCacheAcrossBuilds() {
        StubAmapAdapter adapter = new StubAmapAdapter(tempDir.resolve("amap.json"));
        POI origin = poi("a", "13.1,52.1");
        POI alias = poi("alias", "13.1,52.1");
        POI destination = poi("b", "13.2,52.2");
        MatrixTransitLookup lookup = new MatrixTransitLookup(adapter);
        assertNotEquals(adapter.matrixRoutingKey(origin, destination), adapter.matrixRoutingKey(alias, destination));
        assertNotEquals(adapter.matrixRoutingKey(origin, destination), new StubHereAdapter().matrixRoutingKey(origin, destination));
        Transit first = lookup.apply(origin, destination);
        lookup.apply(alias, destination);
        assertEquals(2, adapter.calls.get());
        assertSame(first, new MatrixTransitLookup(adapter).apply(origin, destination));
        assertEquals(2, adapter.calls.get());

        POI moved = poi("a", "13.3,52.3");
        assertNotEquals(adapter.matrixRoutingKey(origin, destination), adapter.matrixRoutingKey(moved, destination));
        assertSame(first, lookup.apply(moved, destination), "The legacy AMap ID-only cache remains authoritative");
        assertEquals(2, adapter.calls.get());
    }

    @Test
    void amapStillExpiresOldEntriesAndReusesEstimatedResults() {
        StubAmapAdapter adapter = new StubAmapAdapter(tempDir.resolve("amap.json"));
        POI origin = poi("a", "13.1,52.1");
        POI destination = poi("b", "13.2,52.2");
        TransitMatrix legacy = AmapTransitCalculator.inst().getCachedMatrix();
        Transit warm = new Transit(90, 9);
        legacy.put(origin.id, destination.id, warm);
        assertSame(warm, new MatrixTransitLookup(adapter).apply(origin, destination));
        assertEquals(0, adapter.calls.get());

        legacy.put(origin.id, destination.id, new Transit(80, 8, LocalDateTime.now().minusDays(8)));
        adapter.source = RouteSource.ESTIMATED;
        Transit estimated = new MatrixTransitLookup(adapter).apply(origin, destination);
        assertEquals(1, adapter.calls.get());
        assertSame(estimated, new MatrixTransitLookup(adapter).apply(origin, destination));
        assertEquals(1, adapter.calls.get());
    }

    private static void awaitMerged(MatrixTransitLookup lookup, long expected) {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        while (lookup.stats().merged() < expected && System.nanoTime() < deadline) {
            LockSupport.parkNanos(TimeUnit.MICROSECONDS.toNanos(100));
        }
        assertEquals(expected, lookup.stats().merged());
    }

    private static void await(CountDownLatch latch) {
        try {
            assertTrue(latch.await(5, TimeUnit.SECONDS));
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new CompletionException(error);
        }
    }

    private static POI poi(String id, String location) {
        POI poi = new POI(id);
        poi.location = location;
        return poi;
    }

    private static Route route(POI origin, POI destination, RouteSource source) {
        Route route = new Route(origin.getLoc(), destination.getLoc(), List.of(), new Transit(100, 10), 0);
        route.routeSource = source;
        return route;
    }

    private static class StubHereAdapter extends HereAdapter {
        final AtomicInteger calls = new AtomicInteger();
        BiFunction<POI, POI, Route> response = (origin, destination) -> route(origin, destination, RouteSource.HERE_DRIVING);

        StubHereAdapter() {
            super("fixture-key", 100, 10000, 86400, 2, false);
        }

        @Override
        public Route routing(POI origin, POI destination) {
            calls.incrementAndGet();
            return response.apply(origin, destination);
        }
    }

    private static class StubAmapAdapter extends AmapAdapter {
        final AtomicInteger calls = new AtomicInteger();
        RouteSource source = RouteSource.AMAP_DRIVING;

        StubAmapAdapter(Path configFile) {
            super(false, "change-me", 100, 10000, 86400, 2, configFile.toString(),
                    GeocodeProvider.AMAP, "http://example.invalid", false);
        }

        @Override
        public Route routing(POI origin, POI destination) {
            calls.incrementAndGet();
            return route(origin, destination, source);
        }
    }
}
