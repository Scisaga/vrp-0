package one.rewind.xforce.vehicle_routing.rest.exception;

import jakarta.ws.rs.core.Response;
import one.rewind.xforce.vehicle_routing.service.VrpErrorCode;

import java.util.Map;
import java.util.UUID;

public class SolverJobException extends ExceptionWrapper {

    private final UUID routePlanId;

    public SolverJobException(UUID routePlanId, Response.Status status, String message) {
        this(routePlanId, status, message, true);
    }

    public SolverJobException(UUID routePlanId, Response.Status status, String message, boolean shouldLogStackTrace) {
        this(routePlanId, status, legacyCode(status), Map.of(), message, shouldLogStackTrace);
    }

    public SolverJobException(UUID routePlanId, Response.Status status, VrpErrorCode errorCode,
                              Map<String, String> errorParams, String message, boolean shouldLogStackTrace) {
        super(status, errorCode, errorParams, message, shouldLogStackTrace);
        this.routePlanId = routePlanId;
    }

    public SolverJobException(UUID routePlanId, Throwable cause) {
        this(routePlanId, cause, true);
    }

    public SolverJobException(UUID routePlanId, Throwable cause, boolean shouldLogStackTrace) {
        super(Response.Status.INTERNAL_SERVER_ERROR, cause, shouldLogStackTrace);
        this.routePlanId = routePlanId;
    }

    public SolverJobException(UUID routePlanId, String message) {
        this(routePlanId, message, true);
    }

    public SolverJobException(UUID routePlanId, String message, boolean shouldLogStackTrace) {
        super(Response.Status.INTERNAL_SERVER_ERROR, message, shouldLogStackTrace);
        this.routePlanId = routePlanId;
    }

    public UUID getRoutePlanId() {
        return routePlanId;
    }

    private static VrpErrorCode legacyCode(Response.Status status) {
        if (status == Response.Status.NOT_FOUND) {
            return VrpErrorCode.SOLVER_JOB_NOT_FOUND;
        }
        if (status == Response.Status.BAD_REQUEST) {
            return VrpErrorCode.INVALID_ARGUMENT;
        }
        if (status == Response.Status.CONFLICT) {
            return VrpErrorCode.CONFLICT;
        }
        return VrpErrorCode.INTERNAL;
    }
}
