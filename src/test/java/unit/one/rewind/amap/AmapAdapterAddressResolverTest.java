package one.rewind.amap;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import one.rewind.xforce.geo.POI;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeoutException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class AmapAdapterAddressResolverTest {

    @Test
    void mapsAddressResolverResponseToPoi() throws Exception {
        String payload = """
                {
                  "id": "B0FFJQXXXX",
                  "name": "云海村南3号",
                  "address": "浙江省宁波市慈溪市长河镇云海村陆家路南3号",
                  "location": "121.594637,29.725989",
                  "regeo": {
                    "country": "中国",
                    "province": "浙江省",
                    "city": "宁波市",
                    "district": "慈溪市",
                    "township": "长河镇"
                  }
                }
                """;

        POI poi = AmapAdapter.mapAddressResolverPoi(new ObjectMapper().readTree(payload), "", "云海村南3号");

        assertEquals("B0FFJQXXXX", poi.id);
        assertEquals("云海村南3号", poi.name);
        assertEquals("浙江省宁波市慈溪市长河镇云海村陆家路南3号", poi.address);
        assertEquals("121.594637,29.725989", poi.location);
        assertEquals("浙江省", poi.pname);
        assertEquals("宁波市", poi.cityname);
        assertEquals("慈溪市", poi.adname);
        assertEquals("ADDR_RESOLVER", poi.type);
    }

    @Test
    void mapAddressResolverPoiRejectsEmptyOrInvalidLocation() throws Exception {
        ObjectMapper mapper = new ObjectMapper();

        IOException empty = assertThrows(IOException.class,
                () -> AmapAdapter.mapAddressResolverPoi(mapper.readTree("null"), "", "fallback"));
        assertEquals("Address resolver returned empty response", empty.getMessage());

        IOException invalidLocation = assertThrows(IOException.class,
                () -> AmapAdapter.mapAddressResolverPoi(mapper.readTree("{\"location\":\"bad\"}"), "", "fallback"));
        assertEquals("Address resolver returned invalid location", invalidLocation.getMessage());
    }

    @Test
    void mapAddressResolverPoiUsesFallbacksForMissingOptionalFields() throws Exception {
        String payload = """
                {
                  "location": "121.594637,29.725989",
                  "regeo": {
                    "province": "浙江省"
                  }
                }
                """;

        POI poi = AmapAdapter.mapAddressResolverPoi(new ObjectMapper().readTree(payload), "", "云海村南3号");

        assertEquals("resolver_" + "云海村南3号".hashCode(), poi.id);
        assertEquals("云海村南3号", poi.name);
        assertEquals("云海村南3号", poi.address);
        assertEquals("浙江省", poi.cityname);
        assertEquals("浙江省", poi.pname);
        assertEquals("121.594637,29.725989", poi.entr_location);
    }

    @Test
    void geocodeUsesAddressResolverWhenConfigured() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/resolve", exchange -> {
            String query = exchange.getRequestURI().getRawQuery();
            assertEquals("addr=云海村南3号", URLDecoder.decode(query, StandardCharsets.UTF_8));
            byte[] body = """
                    {
                      "id": "resolver-poi-1",
                      "name": "云海村南3号",
                      "address": "浙江省宁波市慈溪市长河镇云海村陆家路南3号",
                      "location": "121.594637,29.725989",
                      "regeo": {
                        "province": "浙江省",
                        "city": "宁波市",
                        "district": "慈溪市"
                      }
                    }
                    """.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(body);
            }
        });
        server.start();

        Path configPath = Path.of("build/test-address-resolver-config-" + System.nanoTime() + ".json");
        try {
            AmapAdapter adapter = new AmapAdapter(
                    true,
                    "test-amap-key",
                    10,
                    10000,
                    86400,
                    10,
                    configPath.toString(),
                    AmapAdapter.GeocodeProvider.ADDR_RESOLVER,
                    "http://127.0.0.1:" + server.getAddress().getPort() + "/api/resolve",
                    false
            );

            List<POI> pois = adapter.geocode("云海村南3号", "慈溪市");
            assertEquals(1, pois.size());
            assertEquals("resolver-poi-1", pois.getFirst().id);
            assertEquals("宁波市", pois.getFirst().cityname);
        } finally {
            server.stop(0);
            Files.deleteIfExists(configPath);
        }
    }

    @Test
    void queryReturnsFirstResolvedPoiWhenAddressResolverEnabled() throws Exception {
        Path configPath = Path.of("build/test-address-resolver-query-" + System.nanoTime() + ".json");
        try {
            TestableAmapAdapter adapter = new TestableAmapAdapter(configPath);
            adapter.addressResolverResult = List.of(poi("resolver-poi-1", "121.1,29.1"));
            adapter.updateConf(new AmapAdapter.Conf(
                    "test-amap-key",
                    10,
                    10000,
                    Duration.ofHours(24),
                    Duration.ofSeconds(10),
                    AmapAdapter.GeocodeProvider.ADDR_RESOLVER,
                    "http://127.0.0.1:18080/api/resolve",
                    false
            ));

            POI result = adapter.query("宁波市", "云海村南3号");
            assertEquals("resolver-poi-1", result.id);
        } finally {
            Files.deleteIfExists(configPath);
        }
    }

    @Test
    void geocodeFallsBackToAmapWhenConfigured() throws Exception {
        Path configPath = Path.of("build/test-address-resolver-fallback-" + System.nanoTime() + ".json");
        try {
            TestableAmapAdapter adapter = new TestableAmapAdapter(configPath);
            adapter.addressResolverFailure = new IOException("resolver down");
            adapter.amapResult = List.of(poi("fallback-poi-1", "120.1,30.1"));
            adapter.updateConf(new AmapAdapter.Conf(
                    "test-amap-key",
                    10,
                    10000,
                    Duration.ofHours(24),
                    Duration.ofSeconds(10),
                    AmapAdapter.GeocodeProvider.ADDR_RESOLVER,
                    "http://127.0.0.1:18080/api/resolve",
                    true
            ));

            List<POI> result = adapter.geocode("云海村南3号", "");
            assertEquals(1, result.size());
            assertEquals("fallback-poi-1", result.getFirst().id);
        } finally {
            Files.deleteIfExists(configPath);
        }
    }

    @Test
    void geocodePropagatesResolverFailureWhenFallbackDisabled() throws Exception {
        Path configPath = Path.of("build/test-address-resolver-no-fallback-" + System.nanoTime() + ".json");
        try {
            TestableAmapAdapter adapter = new TestableAmapAdapter(configPath);
            adapter.addressResolverFailure = new IOException("resolver down");
            adapter.updateConf(new AmapAdapter.Conf(
                    "test-amap-key",
                    10,
                    10000,
                    Duration.ofHours(24),
                    Duration.ofSeconds(10),
                    AmapAdapter.GeocodeProvider.ADDR_RESOLVER,
                    "http://127.0.0.1:18080/api/resolve",
                    false
            ));

            IOException error = assertThrows(IOException.class, () -> adapter.geocode("云海村南3号", ""));
            assertEquals("resolver down", error.getMessage());
        } finally {
            Files.deleteIfExists(configPath);
        }
    }

    private static POI poi(String id, String location) {
        POI poi = new POI();
        poi.id = id;
        poi.name = id;
        poi.address = id;
        poi.location = location;
        return poi;
    }

    static class TestableAmapAdapter extends AmapAdapter {

        List<POI> addressResolverResult = List.of();
        List<POI> amapResult = List.of();
        IOException addressResolverFailure;

        TestableAmapAdapter(Path configPath) {
            super(
                    true,
                    "test-amap-key",
                    10,
                    10000,
                    86400,
                    10,
                    configPath.toString(),
                    GeocodeProvider.AMAP,
                    DEFAULT_ADDRESS_RESOLVER_URL,
                    false
            );
        }

        @Override
        List<POI> addressResolverGeocode(String address, String city) throws IOException {
            if (addressResolverFailure != null) {
                throw addressResolverFailure;
            }
            return addressResolverResult;
        }

        @Override
        List<POI> amapGeocode(String address, String city) throws IOException, RateLimitExecutor.QuotaExhaustedException, ExecutionException, InterruptedException, TimeoutException {
            return amapResult;
        }
    }
}
