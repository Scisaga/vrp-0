package one.rewind.xforce.vehicle_routing.rest.test;

import io.quarkus.test.junit.QuarkusTestProfile;

import java.util.Map;

public class PoiResourceDisabledTestProfile implements QuarkusTestProfile {

    @Override
    public Map<String, String> getConfigOverrides() {
        return Map.ofEntries(
                Map.entry("map.provider", "AMAP"),
                Map.entry("amap.enabled", "true"),
                Map.entry("amap.app-key", "change-me"),
                Map.entry("amap.qps", "10"),
                Map.entry("amap.quota", "10000"),
                Map.entry("amap.interval", "86400"),
                Map.entry("amap.wait-timeout", "10"),
                Map.entry("amap.config-file", "build/test-disabled-amap-config.json"),
                Map.entry("amap.geocode-provider", "AMAP"),
                Map.entry("amap.address-resolver-url", "http://127.0.0.1:5000/api/resolve"),
                Map.entry("amap.address-resolver-fallback-to-amap", "false")
        );
    }
}
