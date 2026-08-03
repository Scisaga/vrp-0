package one.rewind.xforce.geo.test;

import one.rewind.xforce.geo.POI;
import one.rewind.xforce.geo.transit.Transit;
import one.rewind.xforce.geo.transit.TransitMatrix;
import org.apache.commons.lang3.tuple.Pair;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TransitMatrixTest {

    @Test
    void getReturnsZeroForSamePoiAndMaxForMissingPair() {
        TransitMatrix matrix = new TransitMatrix();

        assertSame(Transit.ZERO, matrix.get("poi-a", "poi-a"));
        assertSame(Transit.MAX, matrix.get("poi-a", "poi-b"));
    }

    @Test
    void initCreatesEstimatedTransitForEveryPoiPair() {
        POI first = poi("first", "116.100000,39.100000");
        POI second = poi("second", "116.200000,39.200000");

        TransitMatrix matrix = TransitMatrix.init(List.of(first, second));

        assertSame(Transit.ZERO, matrix.get(first.id, first.id));
        assertNotEquals(Transit.MAX, matrix.get(first.id, second.id));
        assertNotEquals(Transit.MAX, matrix.get(second.id, first.id));
    }

    @Test
    void roughEstimateSortsReferencePoisByDistance() {
        POI origin = poi("origin", "116.000000,39.000000");
        POI near = poi("near", "116.001000,39.001000");
        POI far = poi("far", "116.500000,39.500000");

        List<Pair<POI, Transit>> estimates = TransitMatrix.roughEstimate(origin, List.of(far, near, origin));

        assertEquals(origin, estimates.get(0).getKey());
        assertEquals(near, estimates.get(1).getKey());
        assertEquals(far, estimates.get(2).getKey());
        assertEquals(0L, estimates.get(0).getValue().distance());
    }

    @Test
    void linearAndToStringExposeMatrixCalculations() {
        TransitMatrix matrix = new TransitMatrix()
                .put("a", "b", new Transit(1000, 60))
                .put("b", "a", new Transit(2000, 120));

        assertEquals(50L, TransitMatrix.linear(10, 20, 100));
        assertTrue(matrix.toString().contains("1.0/1.0"));
        assertTrue(matrix.toString().contains("2.0/2.0"));
    }

    @Test
    void amapLinearTransformReturnsWhenNoReferencePoiIsAvailable() {
        POI target = poi("target", "116.000000,39.000000");
        TransitMatrix matrix = new TransitMatrix();

        matrix.amapLinearTransform(target, List.of(), List.of(target), 2);

        assertSame(Transit.MAX, matrix.get(target.id, "missing"));
    }

    private static POI poi(String id, String location) {
        POI poi = new POI(id);
        poi.location = location;
        return poi;
    }
}
