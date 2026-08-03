package one.rewind.xforce.vehicle_routing.rest.test;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.CoreMatchers.equalTo;

@QuarkusTest
@Tag("app")
@TestProfile(NodeHereResourceTestProfile.class)
class NodeHereResourceTest {

    @Test
    void getMapContextReturnsHereSdkAndWgs84() {
        given()
                .when()
                .get("/map_context")
                .then()
                .statusCode(200)
                .body("provider", equalTo("here"))
                .body("enabled", equalTo(true))
                .body("browser_key", equalTo("test-here-browser-key"))
                .body("js_url", equalTo("https://js.api.here.com/v3/3.2/mapsjs-core.js"))
                .body("coordinate_system", equalTo("wgs84"));
    }
}
