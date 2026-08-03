package one.rewind.xforce.vehicle_routing.rest.exception;

import com.fasterxml.jackson.databind.JsonMappingException;
import com.fasterxml.jackson.databind.exc.InvalidFormatException;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.BadRequestException;
import one.rewind.xforce.vehicle_routing.service.VrpApplicationException;
import one.rewind.xforce.vehicle_routing.service.VrpErrorCode;
import org.jboss.logging.Logger;
import org.jboss.resteasy.reactive.server.ServerExceptionMapper;
import com.fasterxml.jackson.core.JsonParseException;

/**
 * @author Yang Zhongwei
 * @date 2025/6/3
 * @description 全局异常处理器（RESTEasy Reactive 方式）
 */
public class ExceptionMappers {

    public final static Logger logger = Logger.getLogger(ExceptionMappers.class);

    @ServerExceptionMapper
    public Response handleExceptionWrapper(ExceptionWrapper exception) {
        logException("ExceptionWrapper", exception, exception.shouldLogStackTrace());
        return Response
                .status(exception.getStatus())
                .type(MediaType.APPLICATION_JSON)
                .entity(error(null, exception.getErrorCode(), exception.getErrorParams(), exception.getMessage()))
                .build();
    }

    @ServerExceptionMapper
    public Response handleJsonParseException(JsonParseException exception) {
        logger.error("JsonParseException: " + exception.getMessage(), exception);
        String errorMessage = "Invalid JSON format: " + exception.getOriginalMessage();
        return Response
                .status(Response.Status.BAD_REQUEST)
                .type(MediaType.APPLICATION_JSON)
                .entity(error(null, VrpErrorCode.INVALID_JSON, java.util.Map.of(), errorMessage))
                .build();
    }

    /**
     * Covers REST parameter conversion and other framework-level bad requests
     * that do not arrive as a Jackson exception.
     */
    @ServerExceptionMapper
    public Response handleBadRequestException(BadRequestException exception) {
        logException("BadRequestException", exception, false);
        return Response
                .status(Response.Status.BAD_REQUEST)
                .type(MediaType.APPLICATION_JSON)
                .entity(error(null, VrpErrorCode.INVALID_ARGUMENT, java.util.Map.of(), exception.getMessage()))
                .build();
    }

    @ServerExceptionMapper
    public Response handleJsonMappingException(JsonMappingException exception) {
        logger.error("JsonMappingException: " + exception.getMessage(), exception);
        String errorMessage = "Invalid JSON content: " + exception.getOriginalMessage();
        return Response
                .status(Response.Status.BAD_REQUEST)
                .type(MediaType.APPLICATION_JSON)
                .entity(error(null, VrpErrorCode.INVALID_JSON_CONTENT, java.util.Map.of(), errorMessage))
                .build();
    }

    @ServerExceptionMapper
    public Response handleSolverJobException(SolverJobException exception) {
        return Response
                .status(exception.getStatus())
                .type(MediaType.APPLICATION_JSON)
                .entity(error(exception.getRoutePlanId(), exception.getErrorCode(), exception.getErrorParams(), exception.getMessage()))
                .build();
    }

    @ServerExceptionMapper
    public Response handleVrpApplicationException(VrpApplicationException exception) {
        logException("VrpApplicationException", exception, exception.shouldLogStackTrace());
        return Response
                .status(exception.getStatus())
                .type(MediaType.APPLICATION_JSON)
                .entity(error(null, exception.getErrorCode(), exception.getErrorParams(), exception.getMessage()))
                .build();
    }

    @ServerExceptionMapper
    public Response handleInvalidFormatException(InvalidFormatException exception) {
        logger.error("InvalidFormatException: " + exception.getMessage(), exception);

        String errorMessage = "Invalid format: " + exception.getOriginalMessage();
        return Response
                .status(Response.Status.BAD_REQUEST)
                .type(MediaType.APPLICATION_JSON)
                .entity(error(null, VrpErrorCode.INVALID_FORMAT, java.util.Map.of(), errorMessage))
                .build();
    }

    @ServerExceptionMapper
    public Response handleAllExceptions(Throwable throwable) {
        logger.error("Throwable: " + throwable.getMessage(), throwable);
        // 解包WebApplicationException
        if (throwable instanceof jakarta.ws.rs.WebApplicationException) {
            Throwable cause = throwable.getCause();
            if (cause instanceof JsonParseException) {
                return handleJsonParseException((JsonParseException) cause);
            } else if (cause instanceof JsonMappingException) {
                return handleJsonMappingException((JsonMappingException) cause);
            }
        }

        // 直接处理JsonParseException, JsonMappingException的情况
        if (throwable instanceof JsonParseException) {
            return handleJsonParseException((JsonParseException) throwable);
        } else if (throwable instanceof JsonMappingException) {
            return handleJsonMappingException((JsonMappingException) throwable);
        }

        return Response
                .status(Response.Status.INTERNAL_SERVER_ERROR)
                .type(MediaType.APPLICATION_JSON)
                .entity(error(null, VrpErrorCode.INTERNAL, java.util.Map.of(), throwable.getClass().getName() + ": " + throwable.getMessage()))
                .build();
    }

    private ErrorInfo error(java.util.UUID id, VrpErrorCode errorCode, java.util.Map<String, String> errorParams,
                            String message) {
        return new ErrorInfo(id, errorCode.code(), errorParams, message);
    }

    private void logException(String prefix, Throwable throwable, boolean shouldLogStackTrace) {
        if (shouldLogStackTrace) {
            logger.error(prefix + ": " + throwable.getMessage(), throwable);
            return;
        }
        logger.warn(prefix + ": " + throwable.getMessage());
    }
}
