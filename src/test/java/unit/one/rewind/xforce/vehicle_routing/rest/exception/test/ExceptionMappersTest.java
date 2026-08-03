package one.rewind.xforce.vehicle_routing.rest.exception.test;

import com.fasterxml.jackson.core.JsonParseException;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.JsonMappingException;
import com.fasterxml.jackson.databind.exc.InvalidFormatException;
import jakarta.ws.rs.WebApplicationException;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import one.rewind.xforce.vehicle_routing.rest.exception.ErrorInfo;
import one.rewind.xforce.vehicle_routing.rest.exception.ExceptionMappers;
import one.rewind.xforce.vehicle_routing.rest.exception.ExceptionWrapper;
import one.rewind.xforce.vehicle_routing.rest.exception.SolverJobException;
import one.rewind.xforce.vehicle_routing.service.VrpApplicationException;
import one.rewind.xforce.vehicle_routing.service.VrpErrorCode;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ExceptionMappersTest {

    private final ExceptionMappers mappers = new ExceptionMappers();

    @Test
    void handleExceptionWrapperPreservesStatusAndMessage() {
        Response response = mappers.handleExceptionWrapper(
                new ExceptionWrapper(Response.Status.CONFLICT, "scenario is locked", false)
        );

        assertError(response, Response.Status.CONFLICT, VrpErrorCode.INTERNAL, "scenario is locked");
    }

    @Test
    void handleSolverJobExceptionPreservesStatusAndMessage() {
        UUID id = UUID.randomUUID();
        Response response = mappers.handleSolverJobException(
                new SolverJobException(id, Response.Status.BAD_REQUEST, "Terminate SolverJob first", false)
        );

        assertError(response, Response.Status.BAD_REQUEST, VrpErrorCode.INVALID_ARGUMENT, "Terminate SolverJob first");
    }

    @Test
    void handleVrpApplicationExceptionPreservesStatusAndMessage() {
        Response response = mappers.handleVrpApplicationException(
                new VrpApplicationException(
                        Response.Status.PRECONDITION_FAILED,
                        VrpErrorCode.FAILED_PRECONDITION,
                        "AMap is disabled",
                        false
                )
        );

        assertError(response, Response.Status.PRECONDITION_FAILED, VrpErrorCode.FAILED_PRECONDITION, "AMap is disabled");
    }

    @Test
    void handleJsonExceptionsReturnBadRequestMessages() {
        Response parseResponse = mappers.handleJsonParseException(new JsonParseException(null, "unexpected token"));
        assertError(parseResponse, Response.Status.BAD_REQUEST, VrpErrorCode.INVALID_JSON,
                "Invalid JSON format: unexpected token");

        Response mappingResponse = mappers.handleJsonMappingException(JsonMappingException.from((JsonParser) null, "missing field"));
        assertError(mappingResponse, Response.Status.BAD_REQUEST, VrpErrorCode.INVALID_JSON_CONTENT,
                "Invalid JSON content: missing field");

        Response invalidFormatResponse = mappers.handleInvalidFormatException(
                InvalidFormatException.from(null, "bad enum", "bad", GeoMode.class)
        );
        assertError(invalidFormatResponse, Response.Status.BAD_REQUEST, VrpErrorCode.INVALID_FORMAT,
                "Invalid format: bad enum");
    }

    @Test
    void handleFrameworkBadRequestUsesStableInvalidArgumentCode() {
        Response response = mappers.handleBadRequestException(new BadRequestException("invalid query parameter"));

        assertError(response, Response.Status.BAD_REQUEST, VrpErrorCode.INVALID_ARGUMENT,
                "invalid query parameter");
    }

    @Test
    void handleAllExceptionsUnwrapsWebApplicationJsonCauses() {
        Response response = mappers.handleAllExceptions(
                new WebApplicationException(new JsonParseException(null, "body is not json"))
        );

        assertError(response, Response.Status.BAD_REQUEST, VrpErrorCode.INVALID_JSON,
                "Invalid JSON format: body is not json");
    }

    @Test
    void handleAllExceptionsFallsBackToInternalServerError() {
        Response response = mappers.handleAllExceptions(new IllegalStateException("broken state"));

        assertError(response, Response.Status.INTERNAL_SERVER_ERROR, VrpErrorCode.INTERNAL,
                IllegalStateException.class.getName() + ": broken state");
    }

    @Test
    void handleVrpApplicationExceptionPreservesSafeErrorParameters() {
        Response response = mappers.handleVrpApplicationException(
                new VrpApplicationException(
                        Response.Status.BAD_REQUEST,
                        VrpErrorCode.SCENARIO_MAP_PROVIDER_MISMATCH,
                        java.util.Map.of("expected_provider", "AMAP"),
                        "Scenario map_provider must match MAP_PROVIDER=AMAP"
                )
        );

        assertError(response, Response.Status.BAD_REQUEST, VrpErrorCode.SCENARIO_MAP_PROVIDER_MISMATCH,
                java.util.Map.of("expected_provider", "AMAP"),
                "Scenario map_provider must match MAP_PROVIDER=AMAP");
    }

    private static void assertError(Response response, Response.Status expectedStatus, VrpErrorCode expectedCode,
                                    String expectedMessage) {
        assertError(response, expectedStatus, expectedCode, java.util.Map.of(), expectedMessage);
    }

    private static void assertError(Response response, Response.Status expectedStatus, VrpErrorCode expectedCode,
                                    java.util.Map<String, String> expectedParams, String expectedMessage) {
        assertEquals(expectedStatus.getStatusCode(), response.getStatus());
        assertTrue(response.getMediaType().isCompatible(MediaType.APPLICATION_JSON_TYPE));
        ErrorInfo error = (ErrorInfo) response.getEntity();
        assertEquals(expectedCode.code(), error.errorCode());
        assertEquals(expectedParams, error.errorParams());
        assertEquals(expectedMessage, error.message());
    }

    private enum GeoMode {
        AMAP
    }
}
