package one.rewind.xforce.vehicle_routing.rest.test;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.response.Response;
import jakarta.inject.Inject;
import jakarta.ws.rs.core.MediaType;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

@QuarkusTest
@Tag("app")
class OpenApiLocationContractTest {

    @Inject
    ObjectMapper objectMapper;

    @Test
    void runtimeAndPublishedOpenApiExposeTheLocationContract() throws IOException {
        Response response = given()
                .accept(MediaType.APPLICATION_JSON)
                .when()
                .get("/q/openapi");
        assertEquals(200, response.statusCode());

        JsonNode runtime = objectMapper.readTree(response.asString());
        JsonNode published = new ObjectMapper(new YAMLFactory())
                .readTree(Path.of("docs/openapi.yaml").toFile());

        assertLocationContract(runtime);
        assertLocationContract(published);

        for (String pointer : new String[] {
                "/components/schemas/RoutePlan/required",
                "/components/schemas/RoutePlan/description",
                "/components/schemas/RoutePlan/example",
                "/components/schemas/RoutePlan/properties/pois/description",
                "/components/schemas/Depo/required",
                "/components/schemas/Depo/properties/loc",
                "/components/schemas/AgentEachDay/required",
                "/components/schemas/AgentEachDay/properties/start_loc",
                "/components/schemas/Ticket/required",
                "/components/schemas/Ticket/properties/loc"
        }) {
            assertEquals(runtime.at(pointer), published.at(pointer), "Published OpenAPI drift at " + pointer);
        }
    }

    private void assertLocationContract(JsonNode openApi) {
        assertEquals("1.1.1-alpha-SNAPSHOT", openApi.at("/info/version").asText());

        JsonNode schemas = openApi.at("/components/schemas");
        assertEquals(Set.of("depos", "agents", "tickets"), textSet(schemas.path("RoutePlan").path("required")));
        assertFalse(textSet(schemas.path("RoutePlan").path("required")).contains("pois"));
        assertEquals(Set.of("id", "loc"), textSet(schemas.path("Depo").path("required")));
        assertEquals(Set.of("id", "start_loc"), textSet(schemas.path("AgentEachDay").path("required")));
        assertEquals(Set.of("id", "type", "loc"), textSet(schemas.path("Ticket").path("required")));

        JsonNode routePlan = schemas.path("RoutePlan");
        assertEncodingDescription(routePlan.path("description"));
        assertEncodingDescription(routePlan.path("properties").path("pois").path("description"));
        assertPoiCompletenessDescription(routePlan.path("properties").path("pois").path("description"));

        JsonNode depoLocation = schemas.path("Depo").path("properties").path("loc");
        JsonNode agentLocation = schemas.path("AgentEachDay").path("properties").path("start_loc");
        JsonNode ticketLocation = schemas.path("Ticket").path("properties").path("loc");
        for (JsonNode location : new JsonNode[] {depoLocation, agentLocation, ticketLocation}) {
            assertPoiReference(location);
            assertEncodingDescription(location.path("description"));
            assertPoiCompletenessDescription(location.path("description"));
        }

        JsonNode example = routePlan.path("example");
        assertTrue(example.isObject(), "RoutePlan example must be an object");
        Set<String> poiIds = new HashSet<>();
        example.path("pois").forEach(poi -> poiIds.add(poi.path("id").asText()));
        Set<String> references = new HashSet<>();
        example.path("depos").forEach(depo -> references.add(depo.path("loc").asText()));
        example.path("agents").forEach(agent -> references.add(agent.path("start_loc").asText()));
        example.path("tickets").forEach(ticket -> references.add(ticket.path("loc").asText()));
        assertFalse(references.isEmpty());
        assertTrue(poiIds.containsAll(references), "Every example POI reference must resolve in plan.pois");
    }

    private void assertEncodingDescription(JsonNode descriptionNode) {
        String description = descriptionNode.asText();
        assertTrue(description.contains("plan.pois"));
        assertTrue(description.contains("字符串"));
        assertTrue(description.contains("完整"));
        assertTrue(description.contains("不要混用"));
    }

    private void assertPoiCompletenessDescription(JsonNode descriptionNode) {
        String description = descriptionNode.asText();
        assertTrue(description.contains("唯一"));
        assertTrue(description.contains("坐标"));
    }

    private void assertPoiReference(JsonNode location) {
        JsonNode oneOf = location.path("oneOf");
        assertEquals(2, oneOf.size());
        boolean hasString = false;
        boolean hasPoi = false;
        for (JsonNode option : oneOf) {
            hasString |= "string".equals(option.path("type").asText());
            hasPoi |= "#/components/schemas/POI".equals(option.path("$ref").asText());
        }
        assertTrue(hasString, "Location must accept a POI ID string");
        assertTrue(hasPoi, "Location must accept an inline POI object");
    }

    private Set<String> textSet(JsonNode array) {
        Set<String> values = new HashSet<>();
        Iterator<JsonNode> iterator = array.elements();
        iterator.forEachRemaining(item -> values.add(item.asText()));
        return values;
    }
}
