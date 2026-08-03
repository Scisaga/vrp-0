package one.rewind.xforce.vehicle_routing.service;

import jakarta.ws.rs.core.Response;

import java.util.Map;

public class VrpApplicationException extends RuntimeException {

    private final Response.Status status;
    private final VrpErrorCode errorCode;
    private final Map<String, String> errorParams;
    private final boolean shouldLogStackTrace;

    public VrpApplicationException(Response.Status status, VrpErrorCode errorCode, String message) {
        this(status, errorCode, Map.of(), message, true);
    }

    public VrpApplicationException(Response.Status status, VrpErrorCode errorCode, String message, boolean shouldLogStackTrace) {
        this(status, errorCode, Map.of(), message, shouldLogStackTrace);
    }

    public VrpApplicationException(Response.Status status, VrpErrorCode errorCode, Map<String, String> errorParams, String message) {
        this(status, errorCode, errorParams, message, true);
    }

    public VrpApplicationException(Response.Status status, VrpErrorCode errorCode, Map<String, String> errorParams,
                                   String message, boolean shouldLogStackTrace) {
        super(message);
        this.status = status;
        this.errorCode = errorCode == null ? VrpErrorCode.INTERNAL : errorCode;
        this.errorParams = errorParams == null ? Map.of() : Map.copyOf(errorParams);
        this.shouldLogStackTrace = shouldLogStackTrace;
    }

    public VrpApplicationException(Response.Status status, VrpErrorCode errorCode, String message, Throwable cause) {
        this(status, errorCode, Map.of(), message, cause, true);
    }

    public VrpApplicationException(Response.Status status, VrpErrorCode errorCode, Map<String, String> errorParams,
                                   String message, Throwable cause) {
        this(status, errorCode, errorParams, message, cause, true);
    }

    public VrpApplicationException(Response.Status status, VrpErrorCode errorCode, String message, Throwable cause,
                                   boolean shouldLogStackTrace) {
        this(status, errorCode, Map.of(), message, cause, shouldLogStackTrace);
    }

    public VrpApplicationException(Response.Status status, VrpErrorCode errorCode, Map<String, String> errorParams,
                                   String message, Throwable cause, boolean shouldLogStackTrace) {
        super(message, cause);
        this.status = status;
        this.errorCode = errorCode == null ? VrpErrorCode.INTERNAL : errorCode;
        this.errorParams = errorParams == null ? Map.of() : Map.copyOf(errorParams);
        this.shouldLogStackTrace = shouldLogStackTrace;
    }

    public Response.Status getStatus() {
        return status;
    }

    public VrpErrorCode getErrorCode() {
        return errorCode;
    }

    public Map<String, String> getErrorParams() {
        return errorParams;
    }

    public boolean shouldLogStackTrace() {
        return shouldLogStackTrace;
    }
}
