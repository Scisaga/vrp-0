package one.rewind.xforce.vehicle_routing.rest.test;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import one.rewind.amap.AmapAdapter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static io.restassured.RestAssured.given;
import static org.hamcrest.CoreMatchers.hasItems;
import static org.hamcrest.CoreMatchers.equalTo;
import static org.hamcrest.CoreMatchers.containsString;
import static org.hamcrest.CoreMatchers.notNullValue;
import static org.hamcrest.CoreMatchers.endsWith;
import static org.hamcrest.CoreMatchers.not;

@QuarkusTest
@Tag("app")
@TestProfile(NodeResourceTestProfile.class)
public class NodeResourceTest {

    private static final Path CONFIG_PATH = Path.of("build/test-amap-config.json");

    @Inject
    AmapAdapter amapAdapter;

    @BeforeEach
    public void resetPersistedConfig() throws IOException {
        Files.deleteIfExists(CONFIG_PATH);
        amapAdapter.updateConf(new AmapAdapter.Conf(
                "test-amap-key",
                100,
                10000,
                java.time.Duration.ofHours(24),
                java.time.Duration.ofSeconds(10),
                AmapAdapter.GeocodeProvider.AMAP,
                "http://127.0.0.1:5000/api/resolve",
                false
        ));
    }

    @Test
    public void getQuotaReturnsCurrentConfig() {
        given()
                .when()
                .get("/quota")
                .then()
                .statusCode(200)
                .body("key", equalTo("test-amap-key"))
                .body("qps", equalTo(100))
                .body("quota", equalTo(10000))
                .body("interval", notNullValue())
                .body("wait_timeout", notNullValue())
                .body("geocode_provider", equalTo("AMAP"))
                .body("address_resolver_url", equalTo("http://127.0.0.1:5000/api/resolve"))
                .body("address_resolver_fallback_to_amap", equalTo(false));
    }

    @Test
    public void getMapContextReturnsSelectedAmapProvider() {
        given()
                .when()
                .get("/map_context")
                .then()
                .statusCode(200)
                .body("provider", equalTo("amap"))
                .body("enabled", equalTo(true))
                .body("browser_key", equalTo("test-amap-key"))
                .body("coordinate_system", equalTo("gcj02"));
    }

    @Test
    public void getMcpMetaReturnsNonSensitiveSummary() {
        given()
                .when()
                .get("/mcp/meta")
                .then()
                .statusCode(200)
                .body("enabled", equalTo(true))
                .body("path", equalTo("/mcp"))
                .body("transport", equalTo("Streamable HTTP"))
                .body("auth_mode", equalTo("Bearer Token"))
                .body("allowed_origins", hasItems("https://allowed.example", "https://console.example"))
                .body("tools", hasItems(
                        "get_current_scenario",
                        "upsert_current_scenario",
                        "start_solver_job",
                        "get_amap_conf"
                ));
    }

    @Test
    public void getMcpDocReturnsReferenceMarkdown() {
        given()
                .when()
                .get("/mcp/doc")
                .then()
                .statusCode(200)
                .contentType(org.hamcrest.Matchers.containsString("text/markdown"))
                .body(org.hamcrest.Matchers.containsString("# MCP"));
    }

    @Test
    public void rootRedirectsToStaticIndex() {
        given()
                .redirects().follow(false)
                .when()
                .get("/")
                .then()
                .statusCode(303)
                .header("Location", endsWith("/static/index.html"));
    }

    @Test
    public void staticEngineUsesUnifiedVrpBrandMetadata() {
        given()
                .when()
                .get("/static/index.html")
                .then()
                .statusCode(200)
                .body(containsString("<title>VRP-0</title>"))
                .body(containsString("<link rel=\"icon\" href=\"assets/img/vrp-0-logo.png\" type=\"image/png\">"))
                .body(containsString("src=\"assets/img/vrp-0-logo.png\""))
                .body(containsString("alt=\"VRP-0\""))
                .body(containsString(">VRP-0</div>"))
                .body(not(containsString("dfst-logo.svg")))
                .body(not(containsString("x-force-logo.png")))
                .body(not(containsString("XForce Console")))
                .body(not(containsString("VRP Console")));

        given()
                .when()
                .get("/static/assets/img/vrp-0-logo.png")
                .then()
                .statusCode(200)
                .contentType("image/png");
    }

    @Test
    public void putQuotaPersistsAndReturnsUpdatedConfig() {
        String payload = """
                {
                  "key": "updated-key",
                  "qps": 6,
                  "quota": 800,
                  "interval": "PT12H",
                  "wait_timeout": "PT30S",
                  "geocode_provider": "ADDR_RESOLVER",
                  "address_resolver_url": "http://127.0.0.1:18080/api/resolve",
                  "address_resolver_fallback_to_amap": true
                }
                """;

        given()
                .body(payload)
                .header("Content-Type", "application/json")
                .when()
                .put("/quota")
                .then()
                .statusCode(200)
                .body("key", equalTo("updated-key"))
                .body("qps", equalTo(6))
                .body("quota", equalTo(800))
                .body("interval", notNullValue())
                .body("wait_timeout", notNullValue())
                .body("geocode_provider", equalTo("ADDR_RESOLVER"))
                .body("address_resolver_url", equalTo("http://127.0.0.1:18080/api/resolve"))
                .body("address_resolver_fallback_to_amap", equalTo(true));

        given()
                .when()
                .get("/quota")
                .then()
                .statusCode(200)
                .body("key", equalTo("updated-key"))
                .body("qps", equalTo(6))
                .body("quota", equalTo(800))
                .body("interval", notNullValue())
                .body("wait_timeout", notNullValue())
                .body("geocode_provider", equalTo("ADDR_RESOLVER"))
                .body("address_resolver_url", equalTo("http://127.0.0.1:18080/api/resolve"))
                .body("address_resolver_fallback_to_amap", equalTo(true));
    }

    @Test
    public void putQuotaRejectsInvalidValues() {
        String payload = """
                {
                  "key": "",
                  "qps": 0,
                  "quota": 0,
                  "interval": "PT0S",
                  "wait_timeout": "PT0S",
                  "geocode_provider": "AMAP",
                  "address_resolver_url": "",
                  "address_resolver_fallback_to_amap": false
                }
                """;

        given()
                .body(payload)
                .header("Content-Type", "application/json")
                .when()
                .put("/quota")
                .then()
                .statusCode(400)
                .body("message", equalTo("Amap key should not be blank"));
    }
}
