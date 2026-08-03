package one.rewind.xforce.vehicle_routing.rest.exception;

import jakarta.ws.rs.core.Response;
import one.rewind.xforce.vehicle_routing.service.VrpErrorCode;
import org.apache.commons.lang3.StringUtils;

import java.util.Map;

/**
 *
 */
public class ExceptionWrapper extends RuntimeException {

    private final Response.Status status;
    private final VrpErrorCode errorCode;
    private final Map<String, String> errorParams;
    private final boolean shouldLogStackTrace;

    public ExceptionWrapper(Response.Status status, String msg) {
        this(status, msg, true);
    }

    public ExceptionWrapper(Response.Status status, String msg, boolean shouldLogStackTrace) {
        this(status, VrpErrorCode.INTERNAL, Map.of(), msg, shouldLogStackTrace);
    }

    public ExceptionWrapper(Response.Status status, VrpErrorCode errorCode, Map<String, String> errorParams,
                            String msg, boolean shouldLogStackTrace) {
        super(msg);
        this.status = status;
        this.errorCode = errorCode == null ? VrpErrorCode.INTERNAL : errorCode;
        this.errorParams = errorParams == null ? Map.of() : Map.copyOf(errorParams);
        this.shouldLogStackTrace = shouldLogStackTrace;
    }

    public ExceptionWrapper(Response.Status status, Throwable cause) {
        this(status, cause, true);
    }

    public ExceptionWrapper(Response.Status status, Throwable cause, boolean shouldLogStackTrace) {
        super(StringUtils.isBlank(cause.getMessage()) ? cause.getClass().getSimpleName() : cause.getMessage(), cause);
        this.status = status;
        this.errorCode = VrpErrorCode.INTERNAL;
        this.errorParams = Map.of();
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
