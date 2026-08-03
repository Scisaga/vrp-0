package one.rewind.xforce.vehicle_routing.rest.test;

import io.quarkus.test.junit.QuarkusTest;
import io.restassured.filter.log.LogDetail;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;

import static io.restassured.RestAssured.given;
import static org.hamcrest.CoreMatchers.is;

@QuarkusTest
@Tag("external")
public class PoiResourceTest {

    @BeforeAll
    static void requireExternalTestsEnabled() {
        one.rewind.xforce.test.support.ExternalTestSupport.requireExternalTestsEnabled();
    }

    @Test
    public void testQuery() {
        given()
                .param("keywords", "小区")
                .param("city", "110101")
                .param("types", "120000")
                .param("page", 2)
                .when().get("/pois")
                .then()
                .log()
                .ifValidationFails(LogDetail.ALL)
                .statusCode(200)
                .body("$.size()", is(40));
    }
}
