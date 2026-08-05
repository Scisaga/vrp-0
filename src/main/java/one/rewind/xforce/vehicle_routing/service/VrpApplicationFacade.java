package one.rewind.xforce.vehicle_routing.service;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.ws.rs.core.Response;
import one.rewind.amap.AmapAdapter;
import one.rewind.amap.RateLimitExecutor;
import one.rewind.xforce.geo.POI;
import one.rewind.xforce.geo.map.MapAdapter;
import one.rewind.xforce.geo.map.MapAdapterSelector;
import one.rewind.xforce.geo.map.MapProvider;
import one.rewind.xforce.geo.transit.AmapTransitCalculator;
import one.rewind.xforce.geo.transit.TransitMatrix;
import one.rewind.xforce.vehicle_routing.bootstrap.GeoUtil;
import one.rewind.xforce.vehicle_routing.db.dto.Scenario;
import one.rewind.xforce.vehicle_routing.db.dto.SolverJob;
import one.rewind.xforce.vehicle_routing.db.dto.SolverJobListFilter;
import one.rewind.xforce.vehicle_routing.db.dto.SolverJobSummary;
import one.rewind.xforce.vehicle_routing.db.repository.ScenarioRepository;
import one.rewind.xforce.vehicle_routing.db.repository.SolverJobRepository;
import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.domain.ticket.Ticket;
import one.rewind.xforce.vehicle_routing.exception.AgentOrTicketNotCompatible;
import one.rewind.xforce.vehicle_routing.exception.POINoWhereException;
import one.rewind.xforce.vehicle_routing.exception.POINotBuild;
import one.rewind.xforce.vehicle_routing.exception.TransitMatrixNotBuild;
import one.rewind.xforce.vehicle_routing.rest.exception.SolverJobException;
import one.rewind.xforce.vehicle_routing.rest.msg.Msg;
import one.rewind.xforce.vehicle_routing.rest.msg.MapContext;
import one.rewind.here.HereAdapter;

import java.io.IOException;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.LinkedList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeoutException;

@ApplicationScoped
public class VrpApplicationFacade {

    private static final String RUNNING_JOB_ERROR = "Solver job is already running, queueing is not supported";
    private static final String RUNNING_MUTATION_ERROR = "Solver job is running, scenario mutations are rejected";
    private static final String AMAP_DISABLED_ERROR = AmapAdapter.DISABLED_MESSAGE;

    @Inject
    ScenarioRepository scenarioRepository;

    @Inject
    SolverJobRepository solverJobRepository;

    @Inject
    SolverService solverService;

    @Inject
    SingletonOperationCoordinator coordinator;

    @Inject
    AmapAdapter amapAdapter;

    @Inject
    MapAdapterSelector mapAdapterSelector;

    @Inject
    HereAdapter hereAdapter;

    @Inject
    ScenarioLocationEnricher scenarioLocationEnricher;

    public Scenario getCurrentScenario() {
        Scenario scenario = scenarioRepository.getCurrent();
        if (scenario == null) {
            throw new VrpApplicationException(Response.Status.NOT_FOUND, VrpErrorCode.SCENARIO_NOT_FOUND, "No Scenario found");
        }
        normalizeMapProvider(scenario);
        return scenario;
    }

    public Scenario findCurrentScenario() {
        Scenario scenario = scenarioRepository.getCurrent();
        if (scenario != null) {
            normalizeMapProvider(scenario);
        }
        return scenario;
    }

    public Scenario upsertCurrentScenario(Scenario scenario, boolean build, GeoUtil.MatrixMode matrixMode) {
        return upsertCurrentScenario(scenario, build, matrixMode, false);
    }

    public Scenario upsertCurrentScenario(Scenario scenario, boolean build, GeoUtil.MatrixMode matrixMode, boolean replace) {
        return coordinator.withLock(() -> {
            rejectScenarioMutationWhenSolverRunning();
            prepareScenarioForSave(scenario, build, matrixMode);

            Scenario current = scenarioRepository.getCurrent();
            if (current != null && scenario.getCreateTime() == null) {
                scenario.setCreateTime(current.getCreateTime());
            }
            if (!replace && current != null && scenario.getId() == null) {
                scenario.setId(current.getId());
            }
            scenario.setUpdateTime(LocalDateTime.now());
            scenario.addVirtualAgents();
            if (replace && current != null) {
                solverJobRepository.deleteAll();
            }
            return scenarioRepository.saveCurrent(scenario);
        });
    }

    public Msg deleteCurrentScenario() {
        return coordinator.withLock(() -> {
            rejectScenarioMutationWhenSolverRunning();
            if (!scenarioRepository.exists()) {
                throw new VrpApplicationException(Response.Status.NOT_FOUND, VrpErrorCode.SCENARIO_NOT_FOUND, "No Scenario found");
            }
            solverJobRepository.deleteAll();
            scenarioRepository.deleteCurrent();
            return Msg.Success();
        });
    }

    public List<RoutePlan.AvailableAgentWindow> getAvailableAgents() {
        Scenario scenario = getCurrentScenario();
        if (scenario.getPlan() == null) {
            throw new VrpApplicationException(
                    Response.Status.BAD_REQUEST,
                    VrpErrorCode.SCENARIO_PLAN_MISSING,
                    "Scenario has no plan"
            );
        }
        if (scenario.getStartTime() == null || scenario.getEndTime() == null) {
            throw new VrpApplicationException(
                    Response.Status.BAD_REQUEST,
                    VrpErrorCode.SCENARIO_SCHEDULE_MISSING,
                    "Scenario start_time or end_time is empty"
            );
        }

        return scenario.getPlan().getAvailableAgentsCount(
                scenario.getStartTime(),
                scenario.getEndTime(),
                Duration.ofHours(2)
        );
    }

    public List<POI> searchPois(String keywords, String city, String types, long page) {
        if (keywords == null || keywords.isBlank()) {
            throw new VrpApplicationException(
                    Response.Status.BAD_REQUEST,
                    VrpErrorCode.MAP_KEYWORDS_REQUIRED,
                    "Keywords should not blank"
            );
        }
        if (page < 1) {
            throw new VrpApplicationException(
                    Response.Status.BAD_REQUEST,
                    VrpErrorCode.MAP_PAGE_INVALID,
                    "Page should be greater than or equal to 1"
            );
        }

        List<POI> pois = new LinkedList<>();
        ensureMapEnabled();
        for (int i = 0; i < page; i++) {
            try {
                pois.addAll(mapAdapter().fetchPOI(keywords, types, city, 20, i + 1));
            } catch (IOException | RateLimitExecutor.QuotaExhaustedException | ExecutionException |
                     InterruptedException | TimeoutException e) {
                if (e instanceof InterruptedException) {
                    Thread.currentThread().interrupt();
                }
                throw new VrpApplicationException(
                        Response.Status.INTERNAL_SERVER_ERROR,
                        VrpErrorCode.MAP_PROVIDER_REQUEST_FAILED,
                        Map.of("provider", mapAdapterSelector.provider().name()),
                        "Query " + mapAdapterSelector.provider() + " interface error",
                        e
                );
            }
        }
        return pois;
    }

    public List<POI> geocodePois(String keywords, String city) {
        if (keywords == null || keywords.isBlank()) {
            throw new VrpApplicationException(
                    Response.Status.BAD_REQUEST,
                    VrpErrorCode.MAP_KEYWORDS_REQUIRED,
                    "Keywords should not blank"
            );
        }

        try {
            ensureMapEnabled();
            return mapAdapter().geocode(keywords, city == null ? "" : city);
        } catch (IllegalStateException e) {
            throw new VrpApplicationException(
                    Response.Status.PRECONDITION_FAILED,
                    VrpErrorCode.MAP_PROVIDER_UNAVAILABLE,
                    e.getMessage(),
                    e,
                    false
            );
        } catch (IOException | RateLimitExecutor.QuotaExhaustedException | ExecutionException |
                 InterruptedException | TimeoutException e) {
            if (e instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            throw new VrpApplicationException(
                    Response.Status.INTERNAL_SERVER_ERROR,
                    VrpErrorCode.MAP_PROVIDER_REQUEST_FAILED,
                    Map.of("provider", mapAdapterSelector.provider().name()),
                    e.getMessage() == null ? "Query geocode interface error" : e.getMessage(),
                    e
            );
        }
    }

    public POI reverseGeocodePoi(String location) {
        if (location == null || location.isBlank()) {
            throw new VrpApplicationException(
                    Response.Status.BAD_REQUEST,
                    VrpErrorCode.MAP_LOCATION_REQUIRED,
                    "Location should not blank"
            );
        }

        ensureMapEnabled();
        try {
            return mapAdapter().regeo(location);
        } catch (IOException | RateLimitExecutor.QuotaExhaustedException | ExecutionException |
                 InterruptedException | TimeoutException e) {
            if (e instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            throw new VrpApplicationException(
                    Response.Status.INTERNAL_SERVER_ERROR,
                    VrpErrorCode.MAP_PROVIDER_REQUEST_FAILED,
                    Map.of("provider", mapAdapterSelector.provider().name()),
                    "Query " + mapAdapterSelector.provider() + " reverse geocode interface error",
                    e
            );
        }
    }

    public SolverJob getCurrentSolverJob(boolean removeVirtual) {
        return getSolverJob(null, removeVirtual);
    }

    public SolverJob getSolverJob(UUID jobId, boolean removeVirtual) {
        SolverJob job = jobId == null
                ? withSolverJobMapping(solverService::getCurrentSolverJobAndCheckForExceptions)
                : withSolverJobMapping(() -> solverService.getSolverJobAndCheckForExceptions(jobId));
        if (removeVirtual) {
            job.removeVirtualAgents();
        }
        if (job.getPlan() != null) {
            job.getPlan().setMatrix(null);
        }
        return job;
    }

    public List<SolverJobSummary> listSolverJobs() {
        return listSolverJobs(SolverJobListFilter.all());
    }

    public List<SolverJobSummary> listSolverJobs(SolverJobListFilter filter) {
        return solverJobRepository.listAll(filter);
    }

    public SolverJob startSolverJob(
            String solveTime,
            GeoUtil.MatrixMode matrixMode,
            boolean buildTransitMatrix,
            boolean drawRoute,
            String callback
    ) {
        return coordinator.withLock(() -> {
            Scenario scenario = scenarioRepository.getCurrent();
            if (scenario == null) {
                throw new VrpApplicationException(Response.Status.NOT_FOUND, VrpErrorCode.SCENARIO_NOT_FOUND, "Scenario not found");
            }
            normalizeMapProvider(scenario);
            if (solverService.hasRunningJob()) {
                throw new VrpApplicationException(Response.Status.CONFLICT, VrpErrorCode.SOLVER_JOB_ALREADY_RUNNING, RUNNING_JOB_ERROR);
            }
            Duration parsedSolveTime = parseSolveTime(solveTime);
            validateRequiredTicketTypes(scenario);
            scenarioRepository.saveCurrent(scenario);

            SolverJob job;
            try {
                job = scenario.getSolverJob(solverJobRepository, parsedSolveTime);
            } catch (POINotBuild e) {
                throw new VrpApplicationException(
                        Response.Status.BAD_REQUEST,
                        VrpErrorCode.SCENARIO_POI_NOT_BUILT,
                        "Scenario POI not built (try PUT /scenario?build=true)"
                );
            } catch (TransitMatrixNotBuild e) {
                throw new VrpApplicationException(
                        Response.Status.BAD_REQUEST,
                        VrpErrorCode.SCENARIO_TRANSIT_MATRIX_NOT_BUILT,
                        "Scenario transit matrix not built (try PUT /scenario?build=true)"
                );
            }
            job.setSolveTime(parsedSolveTime);
            job.setMatrixMode(GeoUtil.MatrixMode.normalize(matrixMode == null ? GeoUtil.MatrixMode.ROUTING : matrixMode).name());
            job.setBuildTransitMatrix(buildTransitMatrix);
            job.setDrawRoute(drawRoute);
            return solverService.solve(job, drawRoute, callback);
        });
    }

    public SolverJob terminateCurrentSolverJob() {
        SolverJob job = withSolverJobMapping(solverService::getCurrentSolverJobAndCheckForExceptions);
        return withSolverJobMapping(() -> solverService.stop(job.getId()));
    }

    public Scenario applyCurrentSolverJob() {
        return applySolverJob(null);
    }

    public Scenario applySolverJob(UUID jobId) {
        return coordinator.withLock(() -> {
            SolverJob job = jobId == null
                    ? withSolverJobMapping(solverService::getCurrentSolverJobAndCheckForExceptions)
                    : withSolverJobMapping(() -> solverService.getSolverJobAndCheckForExceptions(jobId));
            Scenario scenario = scenarioRepository.getCurrent();
            if (scenario == null) {
                throw new VrpApplicationException(Response.Status.NOT_FOUND, VrpErrorCode.SCENARIO_NOT_FOUND, "Scenario not found");
            }

            try {
                scenario.applyRoutePlan(job.getPlan());
                scenarioRepository.saveCurrent(scenario);
                return scenario;
            } catch (AgentOrTicketNotCompatible e) {
                throw new VrpApplicationException(
                        Response.Status.BAD_REQUEST,
                        VrpErrorCode.SCENARIO_APPLY_INCOMPATIBLE,
                        e.getMessage(),
                        e
                );
            }
        });
    }

    public Msg deleteCurrentSolverJob() {
        return deleteSolverJob(null);
    }

    public Msg deleteSolverJob(UUID jobId) {
        SolverJob job = jobId == null
                ? withSolverJobMapping(solverService::getCurrentSolverJobAndCheckForExceptions)
                : withSolverJobMapping(() -> solverService.getSolverJobAndCheckForExceptions(jobId));
        withSolverJobMapping(() -> {
            solverService.delete(job.getId());
            return null;
        });
        return Msg.Success();
    }

    public AmapAdapter.Conf getAmapConf() {
        return amapAdapter.getConf();
    }

    public MapContext getMapContext() {
        MapProvider provider = mapAdapterSelector.provider();
        if (!mapAdapter().isEnabled()) {
            return MapContext.disabled(provider);
        }
        if (provider == MapProvider.HERE) {
            return new MapContext(
                    "here", true, hereAdapter.browserKey(),
                    "https://js.api.here.com/v3/3.2/mapsjs-core.js",
                    "https://js.api.here.com/v3/3.2/mapsjs-ui.css",
                    "wgs84", "zh-CN"
            );
        }
        return new MapContext(
                "amap", true, amapAdapter.getConf().key(),
                "https://webapi.amap.com/maps?v=1.4.15", "",
                "gcj02", "zh-CN"
        );
    }

    public AmapAdapter.Conf updateAmapConf(AmapAdapter.Conf conf) {
        try {
            return amapAdapter.updateConf(conf);
        } catch (IllegalArgumentException e) {
            throw new VrpApplicationException(
                    Response.Status.BAD_REQUEST,
                    VrpErrorCode.INVALID_ARGUMENT,
                    e.getMessage(),
                    e
            );
        } catch (RuntimeException e) {
            throw new VrpApplicationException(
                    Response.Status.INTERNAL_SERVER_ERROR,
                    VrpErrorCode.INTERNAL,
                    e.getMessage(),
                    e
            );
        }
    }

    public TransitMatrix getTransitMatrix() {
        requireAmapMatrixCache();
        return AmapTransitCalculator.inst().getCachedMatrix();
    }

    public Msg setTransitMatrix(TransitMatrix matrix) {
        requireAmapMatrixCache();
        AmapTransitCalculator.inst().setCachedMatrix(matrix);
        return Msg.Success();
    }

    private void rejectScenarioMutationWhenSolverRunning() {
        if (solverService.hasRunningJob()) {
            throw new VrpApplicationException(Response.Status.CONFLICT, VrpErrorCode.SCENARIO_MUTATION_BLOCKED, RUNNING_MUTATION_ERROR);
        }
    }

    private void prepareScenarioForSave(Scenario scenario, boolean build, GeoUtil.MatrixMode matrixMode) {
        if (scenario == null) {
            throw new VrpApplicationException(
                    Response.Status.BAD_REQUEST,
                    VrpErrorCode.SCENARIO_REQUIRED,
                    "Scenario should not be null"
            );
        }

        normalizeMapProvider(scenario);
        ScenarioReferenceNormalizer.normalize(scenario);
        validateRequiredTicketTypes(scenario);
        scenarioLocationEnricher.enrich(scenario);
        ScenarioReferenceNormalizer.normalize(scenario);

        if (!build) {
            return;
        }

        try {
            ensureMapEnabled();
            GeoUtil.buildPOI(scenario.getPlan(), mapAdapter());
            GeoUtil.buildMatrix(scenario.getPlan(), GeoUtil.MatrixMode.normalize(matrixMode), mapAdapter());
        } catch (IllegalStateException e) {
            throw new VrpApplicationException(
                    Response.Status.PRECONDITION_FAILED,
                    VrpErrorCode.MAP_PROVIDER_UNAVAILABLE,
                    e.getMessage(),
                    e,
                    false
            );
        } catch (POINoWhereException e) {
            throw new VrpApplicationException(
                    Response.Status.BAD_REQUEST,
                    VrpErrorCode.INVALID_ARGUMENT,
                    e.getMessage(),
                    e
            );
        } catch (IOException | RateLimitExecutor.QuotaExhaustedException | ExecutionException |
                 InterruptedException | TimeoutException e) {
            if (e instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            throw new VrpApplicationException(
                    Response.Status.INTERNAL_SERVER_ERROR,
                    VrpErrorCode.MAP_PROVIDER_REQUEST_FAILED,
                    Map.of("provider", mapAdapterSelector.provider().name()),
                    e.getMessage(),
                    e
            );
        }
    }

    /**
     * Ticket 类型直接参与服务时长和在途载荷计算，缺失时会在求解过程中触发空值错误。
     */
    private void validateRequiredTicketTypes(Scenario scenario) {
        RoutePlan plan = scenario.getPlan();
        if (plan == null || plan.getTickets() == null) {
            return;
        }

        List<Ticket> tickets = plan.getTickets();
        for (int index = 0; index < tickets.size(); index++) {
            Ticket ticket = tickets.get(index);
            if (ticket == null || ticket.getType() == null) {
                String field = "plan.tickets[" + index + "].type";
                String message = ticket == null || ticket.getId() == null
                        ? "Ticket type is required"
                        : "Ticket type is required: " + ticket.getId();
                throw new VrpApplicationException(
                        Response.Status.BAD_REQUEST,
                        VrpErrorCode.INVALID_ARGUMENT,
                        Map.of("field", field, "rule", "required"),
                        message,
                        false
                );
            }
        }
    }

    private Duration parseSolveTime(String solveTime) {
        try {
            return Duration.parse(solveTime);
        } catch (Exception e) {
            throw new VrpApplicationException(
                    Response.Status.BAD_REQUEST,
                    VrpErrorCode.INVALID_ARGUMENT,
                    Map.of("field", "solve_time"),
                    "Invalid solve_time, expected ISO-8601 duration, e.g. PT30S"
            );
        }
    }

    private MapAdapter mapAdapter() {
        return mapAdapterSelector.adapter();
    }

    private void normalizeMapProvider(Scenario scenario) {
        MapProvider current = mapAdapterSelector.provider();
        if (scenario.getMapProvider() == null) {
            scenario.setMapProvider(current);
            return;
        }
        if (scenario.getMapProvider() != current) {
            throw new VrpApplicationException(
                    Response.Status.BAD_REQUEST,
                    VrpErrorCode.SCENARIO_MAP_PROVIDER_MISMATCH,
                    Map.of("expected_provider", current.name()),
                    "Scenario map_provider must match MAP_PROVIDER=" + current
            );
        }
    }

    private void ensureMapEnabled() {
        try {
            mapAdapterSelector.requireEnabled();
        } catch (IllegalStateException e) {
            throw new VrpApplicationException(
                    Response.Status.PRECONDITION_FAILED,
                    VrpErrorCode.MAP_PROVIDER_UNAVAILABLE,
                    e.getMessage(),
                    e,
                    false
            );
        }
    }

    private <T> T withSolverJobMapping(ThrowingSupplier<T> supplier) {
        try {
            return supplier.get();
        } catch (SolverJobException e) {
            throw mapSolverJobException(e);
        }
    }

    private VrpApplicationException mapSolverJobException(SolverJobException exception) {
        return new VrpApplicationException(
                exception.getStatus(),
                exception.getErrorCode(),
                exception.getErrorParams(),
                exception.getMessage(),
                exception,
                exception.shouldLogStackTrace()
        );
    }

    @FunctionalInterface
    private interface ThrowingSupplier<T> {
        T get() throws SolverJobException;
    }

    private void requireAmapMatrixCache() {
        if (mapAdapterSelector.provider() != MapProvider.AMAP) {
            throw new VrpApplicationException(
                    Response.Status.PRECONDITION_FAILED,
                    VrpErrorCode.MATRIX_CACHE_PROVIDER_UNSUPPORTED,
                    Map.of("required_provider", MapProvider.AMAP.name()),
                    "The matrix cache endpoint is only available when MAP_PROVIDER=AMAP"
            );
        }
    }
}
