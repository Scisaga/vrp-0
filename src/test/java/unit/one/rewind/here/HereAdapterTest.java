package one.rewind.here;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import one.rewind.xforce.geo.LOC;
import one.rewind.xforce.geo.POI;
import one.rewind.xforce.geo.Route;
import one.rewind.xforce.geo.RouteSource;
import one.rewind.xforce.geo.transit.Transit;
import one.rewind.xforce.geo.transit.TransitMatrix;
import one.rewind.xforce.http.HttpResponsePayload;
import one.rewind.xforce.vehicle_routing.domain.agent.Agent;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class HereAdapterTest {

    @Test
    void parsesDiscoverAndMultiSectionRouteWithFlexiblePolyline() throws Exception {
        FixtureHereAdapter adapter = new FixtureHereAdapter();
        adapter.getResponses.add(json("""
                {"items":[{"position":{"lat":52.5,"lng":13.4}}]}
                """));
        adapter.getResponses.add(json("""
                {"items":[{"id":"here-poi","title":"Berlin","position":{"lat":52.5,"lng":13.4},
                "address":{"label":"Berlin, Germany","city":"Berlin","district":"Mitte"}}]}
                """));
        adapter.getResponses.add(json("""
                {"routes":[{"sections":[
                  {"summary":{"length":120,"duration":30},"polyline":"BFoz5xJ67i1B1B7PzIhaxL7Y"},
                  {"summary":{"length":80,"duration":20},"polyline":"BFoz5xJ67i1B1B7PzIhaxL7Y"}
                ]}]}
                """));

        POI poi = adapter.fetchPOI("Berlin", "", "Berlin", 1, 1).getFirst();
        Route route = adapter.routing(poi("from", 13.38, 52.51), poi("to", 13.40, 52.52));

        assertEquals("here-poi", poi.id);
        assertEquals("13.4,52.5", poi.location);
        assertEquals(200L, route.transit.distance());
        assertEquals(50L, route.transit.duration());
        assertEquals(RouteSource.HERE_DRIVING, route.routeSource);
        assertTrue(route.polyline.size() >= 4);
        assertTrue(adapter.requestedUrls.getFirst().contains("geocode.search.hereapi.com"));
        assertTrue(List.copyOf(adapter.requestedUrls).get(1).contains("discover.search.hereapi.com"));
        assertTrue(List.copyOf(adapter.requestedUrls).get(1).contains("at=52.5,13.4"));
        assertTrue(List.copyOf(adapter.requestedUrls).get(2).contains("departureTime=any"));
        assertTrue(List.copyOf(adapter.requestedUrls).get(2).contains("traffic%5Bmode%5D=disabled"));
    }

    @Test
    void matrixUsesRowMajorMappingAndMarksUnreachablePairs() {
        FixtureHereAdapter adapter = new FixtureHereAdapter();
        adapter.postResponses.add(json("""
                {"matrix":{"numOrigins":2,"numDestinations":3,
                "distances":[101,102,103,201,202,203],
                "travelTimes":[11,12,13,21,22,23],
                "errorCodes":[0,0,0,0,7,0]}}
                """));
        List<POI> origins = List.of(poi("o1", 13.1, 52.1), poi("o2", 13.2, 52.2));
        List<POI> destinations = List.of(poi("d1", 13.3, 52.3), poi("d2", 13.4, 52.4), poi("d3", 13.5, 52.5));

        TransitMatrix matrix = adapter.matrixRouting(origins, destinations);

        assertTransit(matrix.get("o1", "d1"), 101, 11);
        assertTransit(matrix.get("o1", "d3"), 103, 13);
        assertTransit(matrix.get("o2", "d1"), 201, 21);
        assertEquals(Transit.MAX, matrix.get("o2", "d2"));
        assertTransit(matrix.get("o2", "d3"), 203, 23);
        assertTrue(adapter.postedBodies.getFirst().contains("\"departureTime\":\"any\""));
    }

    @Test
    void mapsForwardAndReverseGeocodingToExistingPoiShape() throws Exception {
        FixtureHereAdapter adapter = new FixtureHereAdapter();
        adapter.getResponses.add(json("""
                {"items":[{"id":"forward","title":"Forward address","position":{"lat":52.51,"lng":13.39},
                "address":{"label":"Forward label","city":"Berlin","postalCode":"10117"}}]}
                """));
        adapter.getResponses.add(json("""
                {"items":[{"id":"reverse","title":"Reverse address","position":{"lat":52.52,"lng":13.40},
                "address":{"label":"Reverse label","city":"Berlin","district":"Mitte"}}]}
                """));

        POI forward = adapter.geocode("Unter den Linden", "Berlin").getFirst();
        POI reverse = adapter.regeo("13.40,52.52");

        assertEquals("forward", forward.id);
        assertEquals("Forward label", forward.address);
        assertEquals("13.39,52.51", forward.location);
        assertEquals("reverse", reverse.id);
        assertEquals("Mitte", reverse.adname);
        assertTrue(adapter.requestedUrls.getFirst().contains("geocode.search.hereapi.com"));
        assertTrue(List.copyOf(adapter.requestedUrls).get(1).contains("revgeocode.search.hereapi.com"));
    }

    @Test
    void mapsTruckDimensionsToHereRoutingParameters() {
        FixtureHereAdapter adapter = new FixtureHereAdapter();
        adapter.getResponses.add(json("""
                {"routes":[{"sections":[{"summary":{"length":100,"duration":20},
                "polyline":"BFoz5xJ67i1B1B7PzIhaxL7Y"}]}]}
                """));
        Agent truck = new Agent();
        truck.setVehicleType(Agent.VehicleType.TRUCK);
        truck.setHeight(3.5);
        truck.setWidth(2.5);
        truck.setWeight(8.2);

        Route route = adapter.routing(truck, poi("from", 13.38, 52.51), poi("to", 13.40, 52.52));

        assertEquals(RouteSource.HERE_TRUCK, route.routeSource);
        String url = adapter.requestedUrls.getFirst();
        assertTrue(url.contains("transportMode=truck"));
        assertTrue(url.contains("vehicle%5Bheight%5D=350"));
        assertTrue(url.contains("vehicle%5Bwidth%5D=250"));
        assertTrue(url.contains("vehicle%5BgrossWeight%5D=8200"));
    }

    @Test
    void matrixAcceptsAsyncResultRedirectAndReassemblesBatches() {
        FixtureHereAdapter asyncAdapter = new FixtureHereAdapter();
        asyncAdapter.postResponses.add(json("{}", 400)); // async=false size rejection
        asyncAdapter.postResponses.add(json("{\"statusUrl\":\"https://matrix-status\"}", 202));
        asyncAdapter.getResponses.add(new HttpResponsePayload(new byte[0], 303,
                Map.of("Location", List.of("https://matrix-result"))));
        asyncAdapter.getResponses.add(json("""
                {"matrix":{"numOrigins":1,"numDestinations":3,
                "distances":[1,2,3],"travelTimes":[10,20,30],"errorCodes":[0,0,0]}}
                """));
        TransitMatrix asyncMatrix = asyncAdapter.matrixRouting(
                List.of(poi("o", 13.0, 52.0)),
                List.of(poi("d1", 13.1, 52.1), poi("d2", 13.2, 52.2), poi("d3", 13.3, 52.3))
        );
        assertTransit(asyncMatrix.get("o", "d3"), 3, 30);
        assertEquals(2, asyncAdapter.postedBodies.size());

        FixtureHereAdapter chunkedAdapter = new FixtureHereAdapter();
        List<POI> origins = java.util.stream.IntStream.range(0, 51)
                .mapToObj(index -> poi("o" + index, 13.0 + index / 1000D, 52.0))
                .toList();
        chunkedAdapter.dynamicMatrixResponse = true;
        TransitMatrix chunked = chunkedAdapter.matrixRouting(origins, List.of(poi("d", 14.0, 52.0)));
        assertEquals(2, chunkedAdapter.postedBodies.size());
        assertTransit(chunked.get("o0", "d"), 100, 10);
        assertTransit(chunked.get("o50", "d"), 100, 10);
    }

    @Test
    void disabledAdapterAndFailedRoutingDoNotFallBackToAmap() {
        HereAdapter disabled = new HereAdapter("change-me", 10, 1000, 86400, 1, false);
        assertThrows(HereAdapter.HereDisabledException.class,
                () -> disabled.fetchPOI("Berlin", "", "", 1, 1));

        FixtureHereAdapter adapter = new FixtureHereAdapter();
        adapter.getResponses.add(json("{}", 500));
        adapter.getResponses.add(json("{}", 500));
        adapter.getResponses.add(json("{}", 500));
        Route route = adapter.routing(poi("from", 13.38, 52.51), poi("to", 13.40, 52.52));
        assertEquals(RouteSource.ESTIMATED, route.routeSource);
        assertEquals("HTTP_500", route.routingFailures.getFirst().code);
    }

    private static void assertTransit(Transit transit, long distance, long duration) {
        assertEquals(distance, transit.distance());
        assertEquals(duration, transit.duration());
    }

    private static POI poi(String id, double longitude, double latitude) {
        POI poi = new POI(id);
        poi.location = longitude + "," + latitude;
        poi.loc = new LOC(longitude, latitude);
        return poi;
    }

    private static HttpResponsePayload json(String value) {
        return json(value, 200);
    }

    private static HttpResponsePayload json(String value, int status) {
        return new HttpResponsePayload(value.getBytes(StandardCharsets.UTF_8), status);
    }

    private static class FixtureHereAdapter extends HereAdapter {
        private final Deque<HttpResponsePayload> getResponses = new ArrayDeque<>();
        private final Deque<HttpResponsePayload> postResponses = new ArrayDeque<>();
        private final Deque<String> requestedUrls = new ArrayDeque<>();
        private final Deque<String> postedBodies = new ArrayDeque<>();
        private final ObjectMapper mapper = new ObjectMapper();
        private boolean dynamicMatrixResponse;

        private FixtureHereAdapter() {
            super("fixture-key", 100, 10000, 86400, 2, true);
        }

        @Override
        protected HttpResponsePayload get(String url) {
            requestedUrls.add(url);
            if (getResponses.isEmpty()) {
                throw new AssertionError("No HERE GET fixture for " + url);
            }
            return getResponses.removeFirst();
        }

        @Override
        protected HttpResponsePayload post(String url, byte[] body) {
            postedBodies.add(new String(body, StandardCharsets.UTF_8));
            if (dynamicMatrixResponse) {
                try {
                    JsonNode request = mapper.readTree(body);
                    int origins = request.path("origins").size();
                    int destinations = request.path("destinations").size();
                    int size = origins * destinations;
                    return json("{\"matrix\":{\"numOrigins\":" + origins + ",\"numDestinations\":" + destinations
                            + ",\"distances\":" + java.util.Collections.nCopies(size, 100)
                            + ",\"travelTimes\":" + java.util.Collections.nCopies(size, 10)
                            + ",\"errorCodes\":" + java.util.Collections.nCopies(size, 0) + "}}");
                } catch (Exception error) {
                    throw new AssertionError(error);
                }
            }
            if (postResponses.isEmpty()) {
                throw new AssertionError("No HERE POST fixture for " + url);
            }
            return postResponses.removeFirst();
        }
    }
}
