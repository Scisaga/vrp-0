package one.rewind.xforce.vehicle_routing.rest.test;

import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import one.rewind.amap.AmapAdapter;
import one.rewind.here.HereAdapter;
import one.rewind.xforce.geo.map.MapAdapterSelector;
import one.rewind.xforce.geo.map.MapProvider;
import one.rewind.xforce.vehicle_routing.service.OfflineScenarioLocationEnricher;
import one.rewind.xforce.vehicle_routing.service.ScenarioLocationEnricher;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Stable application tests must not inherit real map access from the build host. */
@QuarkusTest
@Tag("app")
class StableMapConfigurationTest {

    @Inject
    MapAdapterSelector mapAdapterSelector;

    @Inject
    AmapAdapter amapAdapter;

    @Inject
    HereAdapter hereAdapter;

    @Inject
    ScenarioLocationEnricher locationEnricher;

    @Test
    void defaultScenarioImportsUseOfflineGeocodingAndSyntheticAmap() {
        assertEquals(MapProvider.AMAP, mapAdapterSelector.provider());
        assertTrue(amapAdapter.isEnabled(), "Synthetic AMap metadata must allow local matrix preparation");
        assertTrue("test-stable-amap-key".equals(amapAdapter.getConf().key()),
                "Stable tests must not inherit a real AMap key");
        assertTrue(locationEnricher instanceof OfflineScenarioLocationEnricher,
                "Stable scenario imports must not call real geocoding services");
        assertFalse(hereAdapter.isEnabled(), "Stable tests must not enable HERE network access");
        assertFalse(hereAdapter.isMatrixRoutingEnabled());
        assertEquals(AmapAdapter.GeocodeProvider.AMAP, amapAdapter.getConf().geocodeProvider());
        assertFalse(amapAdapter.getConf().addressResolverFallbackToAmap());
    }
}
