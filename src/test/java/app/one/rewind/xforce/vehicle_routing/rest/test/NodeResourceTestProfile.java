package one.rewind.xforce.vehicle_routing.rest.test;

import io.quarkus.test.junit.QuarkusTestProfile;

import java.util.Map;

public class NodeResourceTestProfile implements QuarkusTestProfile {

    @Override
    public Map<String, String> getConfigOverrides() {
        return Map.ofEntries(
                Map.entry("map.provider", "AMAP"),
                Map.entry("amap.enabled", "true"),
                Map.entry("amap.app-key", "test-amap-key"),
                Map.entry("amap.qps", "100"),
                Map.entry("amap.quota", "10000"),
                Map.entry("amap.interval", "86400"),
                Map.entry("amap.wait-timeout", "10"),
                Map.entry("amap.config-file", "build/test-amap-config.json"),
                Map.entry("amap.geocode-provider", "AMAP"),
                Map.entry("amap.address-resolver-url", "http://127.0.0.1:5000/api/resolve"),
                Map.entry("amap.address-resolver-fallback-to-amap", "false"),
                Map.entry("vrp.mcp.enabled", "true"),
                Map.entry("vrp.mcp.path", "/mcp"),
                Map.entry("vrp.mcp.auth.token", "test-mcp-token"),
                Map.entry("vrp.mcp.allowed-origins", "https://allowed.example,https://console.example")
        );
    }
}
