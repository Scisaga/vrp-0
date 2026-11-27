package one.rewind.xforce.vehicle_routing.bootstrap;

import one.rewind.xforce.geo.POI;
import one.rewind.xforce.geo.Route;
import one.rewind.xforce.geo.RouteSource;
import one.rewind.xforce.geo.map.MapAdapter;
import one.rewind.xforce.geo.map.MapProvider;
import one.rewind.xforce.geo.map.MatrixRoutingKey;
import one.rewind.xforce.geo.transit.AmapTransitCalculator;
import one.rewind.xforce.geo.transit.Transit;

import java.util.Objects;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.atomic.LongAdder;
import java.util.function.BiFunction;

/** One instance per matrix build; no requests are scheduled on a second executor. */
final class MatrixTransitLookup implements BiFunction<POI, POI, Transit> {

    private final MapAdapter adapter;
    private final AmapTransitCalculator amapCalculator;
    private final ConcurrentHashMap<MatrixRoutingKey, CompletableFuture<Transit>> cache = new ConcurrentHashMap<>();
    private final LongAdder requests = new LongAdder();
    private final LongAdder merged = new LongAdder();
    private final LongAdder loads = new LongAdder();

    MatrixTransitLookup(MapAdapter adapter) {
        this.adapter = Objects.requireNonNull(adapter);
        this.amapCalculator = adapter.provider() == MapProvider.AMAP ? AmapTransitCalculator.inst() : null;
    }

    @Override
    public Transit apply(POI origin, POI destination) {
        requests.increment();
        MatrixRoutingKey key = adapter.matrixRoutingKey(origin, destination);
        CompletableFuture<Transit> loading = new CompletableFuture<>();
        CompletableFuture<Transit> existing = cache.putIfAbsent(key, loading);
        if (existing != null) {
            merged.increment();
            return await(existing);
        }

        loads.increment();
        try {
            Transit transit;
            boolean reusable;
            if (adapter.provider() == MapProvider.AMAP) {
                // Preserve the historical ID-based cache, including its TTL and estimated results.
                transit = amapCalculator.calc(origin, destination);
                reusable = true;
            } else {
                Route route = adapter.routing(origin, destination);
                transit = route.transit;
                reusable = (route.routeSource == RouteSource.HERE_DRIVING || route.routeSource == RouteSource.ZERO_DISTANCE)
                        && (route.routingFailures == null || route.routingFailures.isEmpty());
            }
            Objects.requireNonNull(transit, "Matrix route returned no transit");
            loading.complete(transit);
            if (!reusable || Transit.MAX.equals(transit)) {
                cache.remove(key, loading);
            }
            return transit;
        } catch (RuntimeException | Error error) {
            loading.completeExceptionally(error);
            cache.remove(key, loading);
            throw error;
        }
    }

    private static Transit await(CompletableFuture<Transit> loading) {
        try {
            return loading.get();
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new CompletionException("Interrupted while waiting for a matrix route", error);
        } catch (ExecutionException error) {
            if (error.getCause() instanceof RuntimeException cause) {
                throw cause;
            }
            if (error.getCause() instanceof Error cause) {
                throw cause;
            }
            throw new CompletionException(error.getCause());
        }
    }

    Stats stats() {
        return new Stats(requests.sum(), merged.sum(), loads.sum());
    }

    record Stats(long requests, long merged, long loads) {}
}
