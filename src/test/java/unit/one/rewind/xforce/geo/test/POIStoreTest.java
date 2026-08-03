package one.rewind.xforce.geo.test;

import com.fasterxml.jackson.core.JsonProcessingException;
import one.rewind.xforce.geo.POIStore;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

public class POIStoreTest {

    private static final String POI_FIXTURE = "src/test/resources/fixtures/pois_ticket.json";

    @Test
    public void test() throws JsonProcessingException {
        POIStore poiStore = new POIStore(POI_FIXTURE);

        var selected = poiStore.select(10);

        assertEquals(2, selected.size());
        selected.forEach(poi -> assertNotNull(poi.getEntrLoc()));
    }
}
