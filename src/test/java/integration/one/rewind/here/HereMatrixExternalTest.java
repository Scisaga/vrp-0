package one.rewind.here;

import one.rewind.xforce.geo.LOC;
import one.rewind.xforce.geo.POI;
import one.rewind.xforce.geo.transit.Transit;
import one.rewind.xforce.geo.transit.TransitMatrix;
import one.rewind.xforce.test.support.ExternalTestSupport;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Real HERE probe. Deliberately contains only one 1x3 request and one 2x3 request;
 * do not add a large production matrix request to this class.
 */
@Tag("external")
class HereMatrixExternalTest {

    @Test
    void requestsOnlyOneByThreeAndTwoByThreeMatrices() {
        ExternalTestSupport.requireExternalTestsEnabled();
        String key = System.getenv("HERE_API_KEY");
        Assumptions.assumeTrue(key != null && !key.isBlank() && !"change-me".equalsIgnoreCase(key),
                "HERE_API_KEY must be exported from .env before running external tests.");

        HereAdapter adapter = new HereAdapter(key, 5, 100, 86400, 30, true);
        List<POI> destinations = List.of(
                poi("berlin-gate", 13.377704, 52.516275),
                poi("berlin-museum", 13.397634, 52.518611),
                poi("berlin-station", 13.369402, 52.525084)
        );

        // Exactly 1 x 3.
        assertMatrix(adapter.matrixRouting(List.of(poi("berlin-origin-a", 13.388860, 52.517037)), destinations),
                List.of("berlin-origin-a"), destinations);
        // Exactly 2 x 3.
        assertMatrix(adapter.matrixRouting(List.of(
                        poi("berlin-origin-a", 13.388860, 52.517037),
                        poi("berlin-origin-b", 13.405000, 52.520000)
                ), destinations),
                List.of("berlin-origin-a", "berlin-origin-b"), destinations);
    }

    private static void assertMatrix(TransitMatrix matrix, List<String> origins, List<POI> destinations) {
        for (String origin : origins) {
            for (POI destination : destinations) {
                Transit transit = matrix.get(origin, destination.id);
                assertTrue(transit != Transit.MAX, () -> "Unreachable small HERE matrix pair " + origin + " -> " + destination.id);
                assertTrue(transit.distance() > 0, () -> "Missing HERE matrix distance " + origin + " -> " + destination.id);
                assertTrue(transit.duration() > 0, () -> "Missing HERE matrix duration " + origin + " -> " + destination.id);
            }
        }
        assertEquals(origins.size(), matrix.data.size());
    }

    private static POI poi(String id, double longitude, double latitude) {
        POI poi = new POI(id);
        poi.location = longitude + "," + latitude;
        poi.loc = new LOC(longitude, latitude);
        return poi;
    }
}
