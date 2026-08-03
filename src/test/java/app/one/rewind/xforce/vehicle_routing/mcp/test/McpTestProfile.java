package one.rewind.xforce.vehicle_routing.mcp.test;

import io.quarkus.test.junit.QuarkusTestProfile;

import java.util.Map;

public class McpTestProfile implements QuarkusTestProfile {

    @Override
    public Map<String, String> getConfigOverrides() {
        return Map.of(
                "map.provider", "AMAP",
                "vrp.mcp.enabled", "true",
                "vrp.mcp.path", "/mcp",
                "vrp.mcp.auth.token", "test-mcp-token",
                "vrp.mcp.allowed-origins", "https://allowed.example"
        );
    }
}
