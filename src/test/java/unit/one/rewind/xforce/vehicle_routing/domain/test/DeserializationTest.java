package one.rewind.xforce.vehicle_routing.domain.test;

import com.fasterxml.jackson.core.JsonProcessingException;
import one.rewind.xforce.geo.POI;
import one.rewind.xforce.json.OM;
import one.rewind.xforce.vehicle_routing.db.dto.Scenario;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

public class DeserializationTest {

    @Test
    public void test() throws IOException, JsonProcessingException {
        // POI 或在途矩阵不完整
        String json = Files.readString(Path.of("src/test/resources/fixtures/scenarios/scen-2-c.json"), StandardCharsets.UTF_8);

        Scenario scenario = OM.fromJson(json, Scenario.class);
        String serialized = OM.toJson(scenario);

        POI loc = scenario.getPlan().getDepos().get(2).getLoc();
        assertNotNull(serialized);
        assertNotNull(scenario.getPlan());
        assertFalse(loc.isNoWhere());
        assertEquals("天津市", loc.cityname);
        assertEquals("天津市和平区鞍山道70号", loc.address);
    }
}
