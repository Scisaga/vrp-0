package one.rewind.xforce.vehicle_routing.rest.test;

import io.quarkus.test.junit.QuarkusTestProfile;

import java.util.Map;

public class NodeHereResourceTestProfile implements QuarkusTestProfile {

    @Override
    public Map<String, String> getConfigOverrides() {
        return Map.of(
                "map.provider", "HERE",
                "here.api-key", "test-here-browser-key",
                "here.matrix-routing-enabled", "false"
        );
    }
}
