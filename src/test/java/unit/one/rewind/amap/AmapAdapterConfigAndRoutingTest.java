package one.rewind.amap;

import one.rewind.xforce.geo.POI;
import one.rewind.xforce.geo.Route;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AmapAdapterConfigAndRoutingTest {

    @Test
    void disabledAdapterRejectsNetworkBackedOperations(@TempDir Path tempDir) {
        AmapAdapter adapter = adapter(tempDir.resolve("amap.json"), false, "change-me");

        AmapAdapter.AmapDisabledException exception = assertThrows(
                AmapAdapter.AmapDisabledException.class,
                adapter::requireEnabled
        );
        assertEquals(AmapAdapter.DISABLED_MESSAGE, exception.getMessage());
        assertThrows(AmapAdapter.AmapDisabledException.class,
                () -> adapter.fetchPOI("keyword", "", "city", 20, 1));
        assertThrows(AmapAdapter.AmapDisabledException.class,
                () -> adapter.driving("116.100000,39.100000", "116.200000,39.200000"));
    }

    @Test
    void samePointRoutesReturnZeroTransitEvenWhenAdapterIsDisabled(@TempDir Path tempDir) {
        AmapAdapter adapter = adapter(tempDir.resolve("amap.json"), false, "change-me");

        Route route = adapter.driving("116.100000,39.100000", "116.100000,39.100000");

        assertEquals(0L, route.transit.distance());
        assertEquals(0L, route.transit.duration());
        assertEquals(0L, route.tolls);
        assertEquals(116.100000, route.origin.lat);
        assertEquals(39.100000, route.origin.lon);
    }

    @Test
    void updateConfValidatesRequiredFields(@TempDir Path tempDir) {
        AmapAdapter adapter = adapter(tempDir.resolve("amap.json"), true, "valid-key");

        List<AmapAdapter.Conf> invalidConfigs = Arrays.asList(
                null,
                conf("", 10, 100, Duration.ofHours(1), Duration.ofSeconds(1), AmapAdapter.GeocodeProvider.AMAP, "http://resolver"),
                conf("key", 0, 100, Duration.ofHours(1), Duration.ofSeconds(1), AmapAdapter.GeocodeProvider.AMAP, "http://resolver"),
                conf("key", 10, 0, Duration.ofHours(1), Duration.ofSeconds(1), AmapAdapter.GeocodeProvider.AMAP, "http://resolver"),
                conf("key", 10, 100, Duration.ZERO, Duration.ofSeconds(1), AmapAdapter.GeocodeProvider.AMAP, "http://resolver"),
                conf("key", 10, 100, Duration.ofHours(1), Duration.ZERO, AmapAdapter.GeocodeProvider.AMAP, "http://resolver"),
                conf("key", 10, 100, Duration.ofHours(1), Duration.ofSeconds(1), null, "http://resolver"),
                conf("key", 10, 100, Duration.ofHours(1), Duration.ofSeconds(1), AmapAdapter.GeocodeProvider.AMAP, "")
        );

        for (AmapAdapter.Conf invalid : invalidConfigs) {
            assertThrows(IllegalArgumentException.class, () -> adapter.updateConf(invalid));
        }
    }

    @Test
    void updateConfPersistsAndReturnsNormalizedConfig(@TempDir Path tempDir) {
        Path configPath = tempDir.resolve("nested").resolve("amap.json");
        AmapAdapter adapter = adapter(configPath, true, "valid-key");

        AmapAdapter.Conf updated = adapter.updateConf(conf(
                "new-key",
                6,
                800,
                Duration.ofHours(12),
                Duration.ofSeconds(30),
                AmapAdapter.GeocodeProvider.ADDR_RESOLVER,
                "http://127.0.0.1:18080/api/resolve",
                true
        ));

        assertEquals("new-key", updated.key());
        assertEquals(6, updated.qps());
        assertEquals(800, updated.quota());
        assertEquals(Duration.ofHours(12), updated.interval());
        assertEquals(Duration.ofSeconds(30), updated.waitTimeout());
        assertEquals(AmapAdapter.GeocodeProvider.ADDR_RESOLVER, updated.geocodeProvider());
        assertTrue(updated.addressResolverFallbackToAmap());
        assertTrue(Files.exists(configPath));
    }

    @Test
    void queryReturnsNoWhereWhenAddressResolverFindsNothing(@TempDir Path tempDir) throws Exception {
        EmptyResolverAmapAdapter adapter = new EmptyResolverAmapAdapter(tempDir.resolve("amap.json"));
        adapter.updateConf(conf(
                "valid-key",
                10,
                100,
                Duration.ofHours(1),
                Duration.ofSeconds(1),
                AmapAdapter.GeocodeProvider.ADDR_RESOLVER,
                "http://127.0.0.1:18080/api/resolve",
                false
        ));

        assertEquals(POI.NoWhere, adapter.query("city", "missing address"));
        assertEquals(POI.NoWhere, adapter.query("city", "type", "missing address"));
        assertFalse(adapter.isAddressResolverCalledWithType);
    }

    private static AmapAdapter adapter(Path configPath, boolean enabled, String key) {
        return new AmapAdapter(
                enabled,
                key,
                10,
                1000,
                86400,
                10,
                configPath.toString(),
                AmapAdapter.GeocodeProvider.AMAP,
                "http://127.0.0.1:18080/api/resolve",
                false
        );
    }

    private static AmapAdapter.Conf conf(
            String key,
            int qps,
            long quota,
            Duration interval,
            Duration waitTimeout,
            AmapAdapter.GeocodeProvider provider,
            String resolverUrl
    ) {
        return conf(key, qps, quota, interval, waitTimeout, provider, resolverUrl, false);
    }

    private static AmapAdapter.Conf conf(
            String key,
            int qps,
            long quota,
            Duration interval,
            Duration waitTimeout,
            AmapAdapter.GeocodeProvider provider,
            String resolverUrl,
            boolean fallback
    ) {
        return new AmapAdapter.Conf(key, qps, quota, interval, waitTimeout, provider, resolverUrl, fallback);
    }

    private static class EmptyResolverAmapAdapter extends AmapAdapter {
        private boolean isAddressResolverCalledWithType;

        EmptyResolverAmapAdapter(Path configPath) {
            super(
                    true,
                    "valid-key",
                    10,
                    100,
                    3600,
                    1,
                    configPath.toString(),
                    GeocodeProvider.ADDR_RESOLVER,
                    "http://127.0.0.1:18080/api/resolve",
                    false
            );
        }

        @Override
        List<POI> addressResolverGeocode(String address, String city) {
            isAddressResolverCalledWithType = "type".equals(address);
            return List.of();
        }
    }
}
