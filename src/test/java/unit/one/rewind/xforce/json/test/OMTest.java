package one.rewind.xforce.json.test;

import com.fasterxml.jackson.core.Base64Variants;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.util.DefaultIndenter;
import com.fasterxml.jackson.core.util.DefaultPrettyPrinter;
import com.fasterxml.jackson.core.util.Separators;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.json.JsonMapper;
import one.rewind.xforce.geo.POI;
import one.rewind.xforce.geo.POIStore;
import one.rewind.xforce.json.OM;
import one.rewind.xforce.vehicle_routing.db.dto.Scenario;
import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.domain.agent.Depo;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.apache.logging.log4j.core.impl.ThrowableProxy;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;

public class OMTest {

    public final static Logger logger = LogManager.getLogger(OMTest.class.getName());
    private static final String POI_FIXTURE = "src/test/resources/fixtures/pois_ticket.json";

    @Test
    public void getOMPlugins() {
        assertFalse(OM.prettyMapper().getRegisteredModuleIds().isEmpty());
    }

    @Test
    public void testSerialize0() throws JsonProcessingException {
        POIStore poiStore = new POIStore(POI_FIXTURE);

        ObjectMapper mapper = OM.prettyMapper();

        for (POI poi : poiStore.select(1)) {
            String json = mapper.writeValueAsString(poi);
            POI poi1 = mapper.readValue(json, POI.class);

            assertEquals(poi.id, poi1.id);
            assertNotNull(poi1.getLoc());
            assertNotNull(poi1.getEntrLoc());
        }
    }

    @Test
    public void testSerialize1() throws JsonProcessingException {
        POIStore poiStore = new POIStore(POI_FIXTURE);

        String json = prettyMapper().writeValueAsString(poiStore.select(2));

        assertNotNull(json);
        assertFalse(json.isBlank());
        assertEquals(2, OM.fromJson(json, new com.fasterxml.jackson.core.type.TypeReference<java.util.List<POI>>() {}).size());
    }

    @Test
    public void testPOI() throws JsonProcessingException {
        POI poi = new POI("北京市", "北京市朝阳区阜通东大街6号院3方恒国际中心B座");

        String json = OM.toJson(poi);

        poi = OM.fromJson(json, POI.class);
        assertEquals("北京市朝阳区阜通东大街6号院3方恒国际中心B座", poi.address);

        Depo depo = new Depo("1", "1", poi);
        assertNotNull(OM.toJson(depo));
    }

    @Test
    public void testDeserializeIncompleteScenario() throws IOException, JsonProcessingException {
        // POI对象并不是完整解析的
        Scenario scenario = OM.fromJson(Files.readString(Path.of("src/test/resources/fixtures/scenarios/scen-1-1.json"), StandardCharsets.UTF_8), Scenario.class);
        assertNotNull(scenario);
        assertNotNull(OM.toJson(scenario));
    }

    @Test
    public void testSerializeException() throws JsonProcessingException {

        try {
            Integer.parseInt("String");
        }
        catch (NumberFormatException e) {
            RuntimeException runtimeException = new RuntimeException(e);

            ThrowableProxy tp = new ThrowableProxy(runtimeException);
            String json = OM.toJson(tp);

            ThrowableProxy t = OM.fromJson(json, ThrowableProxy.class);
            assertEquals(RuntimeException.class.getName(), t.getName());
        }
    }

    /**
     *
     * @return
     */
    private static ObjectMapper prettyMapper() {

        ObjectMapper om = JsonMapper.builder()
                .findAndAddModules()
                .configure(SerializationFeature.INDENT_OUTPUT, true)
                .build();

        om.setBase64Variant(Base64Variants.MODIFIED_FOR_URL);

        DefaultPrettyPrinter.Indenter indenter = new DefaultIndenter("  ", "\n");

        /*DefaultPrettyPrinter printer = new DefaultPrettyPrinter(Separators.createDefaultInstance().withObjectFieldValueSpacing(Separators.Spacing.AFTER));*/

        DefaultPrettyPrinter printer = new DefaultPrettyPrinter().withSeparators(
                Separators.createDefaultInstance()
                        .withObjectFieldValueSeparator(':')
        );

        printer.indentObjectsWith(indenter);
        printer.indentArraysWith(indenter);

        om.setDefaultPrettyPrinter(printer);

        return om;
    }
}
