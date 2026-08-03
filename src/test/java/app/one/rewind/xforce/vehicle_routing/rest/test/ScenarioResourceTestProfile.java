package one.rewind.xforce.vehicle_routing.rest.test;

import io.quarkus.test.junit.QuarkusTestProfile;

import java.util.Map;

/** Keeps the AMap-specific scenario contract independent of local .env settings. */
public class ScenarioResourceTestProfile implements QuarkusTestProfile {

    @Override
    public Map<String, String> getConfigOverrides() {
        return Map.of("map.provider", "AMAP");
    }
}
