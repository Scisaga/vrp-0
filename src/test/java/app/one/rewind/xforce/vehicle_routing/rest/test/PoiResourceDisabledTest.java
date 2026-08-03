package one.rewind.xforce.vehicle_routing.rest.test;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static io.restassured.RestAssured.given;
import static org.hamcrest.CoreMatchers.equalTo;

@QuarkusTest
@Tag("app")
@TestProfile(PoiResourceDisabledTestProfile.class)
public class PoiResourceDisabledTest {

    private static final Path CONFIG_PATH = Path.of("build/test-disabled-amap-config.json");

    @org.junit.jupiter.api.BeforeEach
    public void clearPersistedConfig() throws IOException {
        Files.deleteIfExists(CONFIG_PATH);
    }

    @Test
    public void listPoisRejectsWhenAmapDisabled() {
        given()
                .param("keywords", "demo")
                .param("city", "110101")
                .when()
                .get("/pois")
                .then()
                .statusCode(412)
                .body("message", equalTo("AMap is disabled. Configure a real amap.app-key and set amap.enabled=true before using AMap-backed features."));
    }

    @Test
    public void geocodeRejectsWhenAmapDisabled() {
        given()
                .param("keywords", "demo")
                .param("city", "110101")
                .when()
                .get("/pois/geocode")
                .then()
                .statusCode(412)
                .body("message", equalTo("AMap is disabled. Configure a real amap.app-key and set amap.enabled=true before using AMap-backed features."));
    }

    @Test
    public void reverseGeocodeRejectsWhenAmapDisabled() {
        given()
                .param("location", "116.421616,39.764968")
                .when()
                .get("/pois/regeocode")
                .then()
                .statusCode(412)
                .body("message", equalTo("AMap is disabled. Configure a real amap.app-key and set amap.enabled=true before using AMap-backed features."));
    }
}
