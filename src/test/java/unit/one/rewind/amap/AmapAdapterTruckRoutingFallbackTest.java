package one.rewind.amap;

import one.rewind.xforce.geo.Route;
import one.rewind.xforce.geo.RouteSource;
import one.rewind.xforce.http.HttpResponsePayload;
import one.rewind.xforce.vehicle_routing.domain.agent.Agent;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Queue;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AmapAdapterTruckRoutingFallbackTest {

    @Test
    void parsesSuccessfulV4TruckResponseWithoutCallingV5(@TempDir Path tempDir) {
        FixtureAmapAdapter adapter = adapter(tempDir, truckSuccess());

        Route route = adapter.truckroute(truck(), "116.100000,39.100000", "116.200000,39.200000", "origin-poi", "destination-poi");

        assertEquals(RouteSource.AMAP_TRUCK, route.routeSource);
        assertEquals(3, route.polyline.size());
        assertEquals(1200L, route.transit.distance());
        assertEquals(180L, route.transit.duration());
        assertEquals(3L, route.tolls);
        assertTrue(route.routingFailures.isEmpty());
        assertEquals(1, adapter.requestUrls.size());
        assertTrue(adapter.requestUrls.getFirst().contains("/v4/direction/truck?"));
    }

    @Test
    void fallsBackToV5DrivingWhenTruckPermissionIsDenied(@TempDir Path tempDir) {
        FixtureAmapAdapter adapter = adapter(tempDir, truckFailure("10012", "INSUFFICIENT_PRIVILEGES"), drivingSuccess());

        Route route = adapter.truckroute(truck(), "116.100000,39.100000", "116.200000,39.200000", "origin-poi", "destination-poi");

        assertEquals(RouteSource.CAR_FALLBACK, route.routeSource);
        assertEquals(3, route.polyline.size());
        assertEquals(1, route.routingFailures.size());
        assertEquals("TRUCK", route.routingFailures.getFirst().vehicleType);
        assertEquals("v4/direction/truck", route.routingFailures.getFirst().endpoint);
        assertEquals("10012", route.routingFailures.getFirst().code);
        assertEquals("INSUFFICIENT_PRIVILEGES", route.routingFailures.getFirst().message);
        assertEquals(2, adapter.requestUrls.size());
        assertTrue(adapter.requestUrls.get(0).contains("/v4/direction/truck?"));
        assertTrue(adapter.requestUrls.get(1).contains("/v5/direction/driving?"));
    }

    @Test
    void returnsEstimatedRouteWhenTruckAndDrivingBothFail(@TempDir Path tempDir) {
        FixtureAmapAdapter adapter = adapter(
                tempDir,
                truckFailure("10012", "INSUFFICIENT_PRIVILEGES"),
                drivingFailure("10012", "INSUFFICIENT_PRIVILEGES")
        );

        Route route = adapter.truckroute(truck(), "116.100000,39.100000", "116.200000,39.200000", "origin-poi", "destination-poi");

        assertEquals(RouteSource.ESTIMATED, route.routeSource);
        assertNull(route.polyline);
        assertEquals(2, route.routingFailures.size());
        assertEquals("v4/direction/truck", route.routingFailures.get(0).endpoint);
        assertEquals("v5/direction/driving", route.routingFailures.get(1).endpoint);
        assertEquals(2, adapter.requestUrls.size());
    }

    @Test
    void keepsV5DrivingAndBicyclingResponsesAvailable(@TempDir Path tempDir) {
        FixtureAmapAdapter drivingAdapter = adapter(tempDir, drivingSuccess());
        Route driving = drivingAdapter.driving("116.100000,39.100000", "116.200000,39.200000", "origin-poi", "destination-poi");

        assertEquals(RouteSource.AMAP_DRIVING, driving.routeSource);
        assertEquals(3, driving.polyline.size());
        assertTrue(driving.routingFailures.isEmpty());

        FixtureAmapAdapter bicyclingAdapter = adapter(tempDir, bicyclingSuccess());
        Route bicycling = bicyclingAdapter.bicycle("116.100000,39.100000", "116.200000,39.200000");

        assertEquals(RouteSource.AMAP_BICYCLE, bicycling.routeSource);
        assertEquals(3, bicycling.polyline.size());
        assertFalse(bicyclingAdapter.requestUrls.isEmpty());
        assertTrue(bicyclingAdapter.requestUrls.getFirst().contains("/v5/direction/bicycling?"));
    }

    private static FixtureAmapAdapter adapter(Path tempDir, String... responses) {
        Queue<HttpResponsePayload> fixtures = new ArrayDeque<>();
        for (String response : responses) {
            fixtures.add(new HttpResponsePayload(response.getBytes(StandardCharsets.UTF_8), 200));
        }
        return new FixtureAmapAdapter(tempDir.resolve("amap.json"), fixtures);
    }

    private static Agent truck() {
        Agent agent = new Agent();
        agent.setVehicleType(Agent.VehicleType.TRUCK);
        agent.setSize(4);
        agent.setHeight(3.5D);
        agent.setWidth(2.5D);
        agent.setWeight(12D);
        return agent;
    }

    private static String truckSuccess() {
        return """
                {
                  "errcode": "0",
                  "errmsg": "OK",
                  "data": {
                    "route": {
                      "origin": "116.100000,39.100000",
                      "destination": "116.200000,39.200000",
                      "paths": [{
                        "distance": "1200",
                        "duration": "180",
                        "tolls": "3",
                        "steps": [{"polyline": "116.100000,39.100000;116.150000,39.150000;116.200000,39.200000"}]
                      }]
                    }
                  }
                }
                """;
    }

    private static String truckFailure(String code, String message) {
        return """
                {"errcode": "%s", "errmsg": "%s"}
                """.formatted(code, message);
    }

    private static String drivingSuccess() {
        return """
                {
                  "status": "1",
                  "route": {
                    "origin": "116.100000,39.100000",
                    "destination": "116.200000,39.200000",
                    "paths": [{
                      "distance": "1300",
                      "cost": {"duration": "210", "tolls": "4"},
                      "steps": [{"polyline": "116.100000,39.100000;116.160000,39.160000;116.200000,39.200000"}]
                    }]
                  }
                }
                """;
    }

    private static String drivingFailure(String code, String message) {
        return """
                {"status": "0", "infocode": "%s", "info": "%s"}
                """.formatted(code, message);
    }

    private static String bicyclingSuccess() {
        return """
                {
                  "status": "1",
                  "route": {
                    "origin": "116.100000,39.100000",
                    "destination": "116.200000,39.200000",
                    "paths": [{
                      "distance": "1000",
                      "duration": "300",
                      "steps": [{"polyline": "116.100000,39.100000;116.140000,39.140000;116.200000,39.200000"}]
                    }]
                  }
                }
                """;
    }

    private static final class FixtureAmapAdapter extends AmapAdapter {

        private final Queue<HttpResponsePayload> responses;
        private final List<String> requestUrls = new ArrayList<>();

        private FixtureAmapAdapter(Path configPath, Queue<HttpResponsePayload> responses) {
            super(
                    true,
                    "test-amap-key",
                    10,
                    1000,
                    3600,
                    1,
                    configPath.toString(),
                    GeocodeProvider.AMAP,
                    "http://127.0.0.1:18080/api/resolve",
                    false
            );
            this.responses = responses;
        }

        @Override
        protected HttpResponsePayload requestDirection(String url) {
            requestUrls.add(url);
            return responses.remove();
        }
    }
}
