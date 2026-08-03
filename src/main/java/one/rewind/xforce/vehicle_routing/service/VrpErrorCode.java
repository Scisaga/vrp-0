package one.rewind.xforce.vehicle_routing.service;

public enum VrpErrorCode {
    SCENARIO_NOT_FOUND("scenario_not_found"),
    SOLVER_JOB_NOT_FOUND("solver_job_not_found"),
    INVALID_ARGUMENT("invalid_argument"),
    INVALID_FILTER("invalid_filter"),
    INVALID_JSON("invalid_json"),
    INVALID_JSON_CONTENT("invalid_json_content"),
    INVALID_FORMAT("invalid_format"),
    SCENARIO_PLAN_MISSING("scenario_plan_missing"),
    SCENARIO_SCHEDULE_MISSING("scenario_schedule_missing"),
    SCENARIO_REQUIRED("scenario_required"),
    SCENARIO_MUTATION_BLOCKED("scenario_mutation_blocked"),
    SCENARIO_MAP_PROVIDER_MISMATCH("scenario_map_provider_mismatch"),
    SCENARIO_POI_NOT_BUILT("scenario_poi_not_built"),
    SCENARIO_TRANSIT_MATRIX_NOT_BUILT("scenario_transit_matrix_not_built"),
    SCENARIO_APPLY_INCOMPATIBLE("scenario_apply_incompatible"),
    SOLVER_JOB_ALREADY_RUNNING("solver_job_already_running"),
    SOLVER_NOT_RUNNING("solver_not_running"),
    SOLVER_JOB_MUST_TERMINATE("solver_job_must_terminate"),
    SOLVER_JOB_FAILED("solver_job_failed"),
    MAP_KEYWORDS_REQUIRED("map_keywords_required"),
    MAP_LOCATION_REQUIRED("map_location_required"),
    MAP_PAGE_INVALID("map_page_invalid"),
    MAP_PROVIDER_UNAVAILABLE("map_provider_unavailable"),
    MAP_PROVIDER_REQUEST_FAILED("map_provider_request_failed"),
    MATRIX_CACHE_PROVIDER_UNSUPPORTED("matrix_cache_provider_unsupported"),
    FAILED_PRECONDITION("failed_precondition"),
    CONFLICT("conflict"),
    PERMISSION_DENIED("permission_denied"),
    INTERNAL("internal_error");

    private final String code;

    VrpErrorCode(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }
}
