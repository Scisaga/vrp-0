package one.rewind.xforce.vehicle_routing.mcp;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.modelcontextprotocol.common.McpTransportContext;
import io.modelcontextprotocol.json.McpJsonMapper;
import io.modelcontextprotocol.json.jackson2.JacksonMcpJsonMapper;
import io.modelcontextprotocol.server.McpServer;
import io.modelcontextprotocol.server.McpStatelessServerFeatures;
import io.modelcontextprotocol.server.McpStatelessSyncServer;
import io.modelcontextprotocol.server.transport.DefaultServerTransportSecurityValidator;
import io.modelcontextprotocol.server.transport.HttpServletStatelessServerTransport;
import io.modelcontextprotocol.spec.McpSchema;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.servlet.http.HttpServlet;
import jakarta.ws.rs.core.Response;
import io.quarkus.arc.Unremovable;
import one.rewind.xforce.geo.transit.TransitMatrix;
import one.rewind.xforce.json.OM;
import one.rewind.xforce.vehicle_routing.bootstrap.GeoUtil;
import one.rewind.xforce.vehicle_routing.db.dto.Scenario;
import one.rewind.xforce.vehicle_routing.service.VrpApplicationException;
import one.rewind.xforce.vehicle_routing.service.VrpApplicationFacade;
import one.rewind.xforce.vehicle_routing.service.VrpErrorCode;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.function.BiFunction;

@ApplicationScoped
@Unremovable
public class McpServerRuntime {

    @Inject
    ObjectMapper objectMapper;

    @Inject
    McpProperties properties;

    @Inject
    VrpApplicationFacade facade;

    @ConfigProperty(name = "quarkus.application.name", defaultValue = "vrp-0")
    String applicationName;

    @ConfigProperty(name = "quarkus.application.version", defaultValue = "dev")
    String applicationVersion;

    private HttpServletStatelessServerTransport transport;
    private McpStatelessSyncServer server;
    private McpJsonMapper jsonMapper;

    @PostConstruct
    void init() {
        jsonMapper = new JacksonMcpJsonMapper(objectMapper.copy());

        HttpServletStatelessServerTransport.Builder transportBuilder =
                HttpServletStatelessServerTransport.builder()
                        .jsonMapper(jsonMapper)
                        .messageEndpoint(properties.path());

        if (!properties.allowedOrigins().isEmpty()) {
            transportBuilder.securityValidator(DefaultServerTransportSecurityValidator.builder()
                    .allowedOrigins(properties.allowedOrigins())
                    .build());
        }

        transport = transportBuilder.build();

        server = McpServer.sync(transport)
                .serverInfo(applicationName, applicationVersion)
                .instructions("VRP single-current scenario engine; MCP job tools operate on the latest solver job")
                .jsonMapper(jsonMapper)
                .requestTimeout(Duration.ofMinutes(5))
                .tools(toolSpecifications())
                .build();
    }

    @PreDestroy
    void close() {
        if (server != null) {
            server.closeGracefully().block();
        }
    }

    public HttpServlet httpServlet() {
        return transport;
    }

    public List<String> toolNames() {
        return toolDescriptors().stream()
                .map(ToolDescriptor::name)
                .toList();
    }

    public String transportName() {
        return "Streamable HTTP";
    }

    public String authMode() {
        return "Bearer Token";
    }

    private List<McpStatelessServerFeatures.SyncToolSpecification> toolSpecifications() {
        return toolDescriptors().stream()
                .map(descriptor -> new McpStatelessServerFeatures.SyncToolSpecification(
                        tool(descriptor.name(), descriptor.description(), descriptor.inputSchema()),
                        descriptor.callHandler()
                ))
                .toList();
    }

    private List<ToolDescriptor> toolDescriptors() {
        return List.of(
                new ToolDescriptor("get_current_scenario", "Get the current scenario.", """
                        {"type":"object","properties":{}}
                        """, (context, request) -> invoke(facade::getCurrentScenario)),
                new ToolDescriptor("upsert_current_scenario", "Create or update the current scenario without clearing solver job history.", """
                        {"type":"object","properties":{"scenario":{"type":"object"},"build":{"type":"boolean","default":false,"description":"Fully build POIs and the scenario matrix after best-effort location enrichment."},"matrix_mode":{"type":"string","enum":["ROUTING","MANHATTAN"],"default":"ROUTING"}},"required":["scenario"]}
                        """, (context, request) -> invoke(() -> facade.upsertCurrentScenario(
                        required(request.arguments(), "scenario", Scenario.class),
                        boolArg(request.arguments(), "build", false),
                        enumArg(request.arguments(), "matrix_mode", GeoUtil.MatrixMode.class, GeoUtil.MatrixMode.ROUTING)
                ))),
                new ToolDescriptor("delete_current_scenario", "Delete the current scenario.", """
                        {"type":"object","properties":{}}
                        """, (context, request) -> invoke(facade::deleteCurrentScenario)),
                new ToolDescriptor("get_available_agents", "Get the 2-hour available-agent windows for the current scenario.", """
                        {"type":"object","properties":{}}
                        """, (context, request) -> invoke(facade::getAvailableAgents)),
                new ToolDescriptor("search_pois", "Search POIs through the current map provider.", """
                        {"type":"object","properties":{"keywords":{"type":"string"},"city":{"type":"string"},"types":{"type":"string"},"page":{"type":"integer","minimum":1}},"required":["keywords"]}
                        """, (context, request) -> invoke(() -> facade.searchPois(
                        requiredString(request.arguments(), "keywords"),
                        stringArg(request.arguments(), "city", ""),
                        stringArg(request.arguments(), "types", ""),
                        longArg(request.arguments(), "page", 1L)
                ))),
                new ToolDescriptor("start_solver_job", "Submit solving for the current scenario asynchronously.", """
                        {"type":"object","properties":{"solve_time":{"type":"string","default":"PT30S"},"matrix_mode":{"type":"string","enum":["ROUTING","MANHATTAN"],"default":"ROUTING","description":"Recorded as job metadata; solving requires a prebuilt input matrix."},"build_transit_matrix":{"type":"boolean","default":false,"description":"Recorded as job metadata and does not rebuild the input matrix during solving."},"draw_route":{"type":"boolean","default":false,"description":"Selects final route or changed-ticket matrix post-processing."},"callback":{"type":"string","default":""}}}
                        """, (context, request) -> invoke(() -> facade.startSolverJob(
                        stringArg(request.arguments(), "solve_time", "PT30S"),
                        enumArg(request.arguments(), "matrix_mode", GeoUtil.MatrixMode.class, GeoUtil.MatrixMode.ROUTING),
                        boolArg(request.arguments(), "build_transit_matrix", false),
                        boolArg(request.arguments(), "draw_route", false),
                        stringArg(request.arguments(), "callback", "")
                ))),
                new ToolDescriptor("get_current_solver_job", "Get the current solver job.", """
                        {"type":"object","properties":{"remove_virtual":{"type":"boolean","default":false}}}
                        """, (context, request) -> invoke(() -> facade.getCurrentSolverJob(
                        boolArg(request.arguments(), "remove_virtual", false)
                ))),
                new ToolDescriptor("terminate_current_solver_job", "Terminate the current solver job.", """
                        {"type":"object","properties":{}}
                        """, (context, request) -> invoke(facade::terminateCurrentSolverJob)),
                new ToolDescriptor("apply_current_solver_job", "Apply the current solver job result to the current scenario.", """
                        {"type":"object","properties":{}}
                        """, (context, request) -> invoke(facade::applyCurrentSolverJob)),
                new ToolDescriptor("delete_current_solver_job", "Delete the current solver job.", """
                        {"type":"object","properties":{}}
                        """, (context, request) -> invoke(facade::deleteCurrentSolverJob)),
                new ToolDescriptor("get_matrix", "Get the in-process Amap routing cache; available only when MAP_PROVIDER=AMAP.", """
                        {"type":"object","properties":{}}
                        """, (context, request) -> invoke(facade::getTransitMatrix)),
                new ToolDescriptor("set_matrix", "Replace the in-process Amap routing cache; available only when MAP_PROVIDER=AMAP.", """
                        {"type":"object","properties":{"matrix":{"type":"object"}},"required":["matrix"]}
                        """, (context, request) -> invoke(() -> facade.setTransitMatrix(
                        required(request.arguments(), "matrix", TransitMatrix.class)
                ))),
                new ToolDescriptor("get_amap_conf", "Get the current Amap adapter configuration.", """
                        {"type":"object","properties":{}}
                        """, (context, request) -> invoke(facade::getAmapConf))
        );
    }

    private McpSchema.Tool tool(String name, String description, String inputSchema) {
        return McpSchema.Tool.builder()
                .name(name)
                .description(description)
                .inputSchema(jsonMapper, inputSchema)
                .build();
    }

    private McpSchema.CallToolResult invoke(ThrowingSupplier<?> supplier) {
        try {
            return success(supplier.get());
        } catch (VrpApplicationException e) {
            return error(e);
        } catch (Throwable t) {
            return error(new VrpApplicationException(
                    Response.Status.INTERNAL_SERVER_ERROR,
                    VrpErrorCode.INTERNAL,
                    t.getMessage() == null ? t.getClass().getName() : t.getMessage(),
                    t
            ));
        }
    }

    private McpSchema.CallToolResult success(Object data) {
        return new McpSchema.CallToolResult(
                List.of(new McpSchema.TextContent(writeJson(data))),
                false,
                data,
                Map.of()
        );
    }

    private McpSchema.CallToolResult error(VrpApplicationException exception) {
        Map<String, Object> payload = Map.of(
                "error_code", exception.getErrorCode().code(),
                "message", exception.getMessage(),
                "status", exception.getStatus().getStatusCode()
        );
        return new McpSchema.CallToolResult(
                List.of(new McpSchema.TextContent(writeJson(payload))),
                true,
                payload,
                Map.of()
        );
    }

    private <T> T required(Map<String, Object> arguments, String key, Class<T> type) {
        Object value = arguments == null ? null : arguments.get(key);
        if (value == null) {
            throw new VrpApplicationException(
                    Response.Status.BAD_REQUEST,
                    VrpErrorCode.INVALID_ARGUMENT,
                    "Missing required argument: " + key
            );
        }
        try {
            return objectMapper.convertValue(value, type);
        } catch (IllegalArgumentException e) {
            throw new VrpApplicationException(
                    Response.Status.BAD_REQUEST,
                    VrpErrorCode.INVALID_ARGUMENT,
                    "Invalid argument: " + key,
                    e
            );
        }
    }

    private String requiredString(Map<String, Object> arguments, String key) {
        String value = stringArg(arguments, key, "");
        if (value.isBlank()) {
            throw new VrpApplicationException(
                    Response.Status.BAD_REQUEST,
                    VrpErrorCode.INVALID_ARGUMENT,
                    "Missing required argument: " + key
            );
        }
        return value;
    }

    private String stringArg(Map<String, Object> arguments, String key, String defaultValue) {
        Object value = arguments == null ? null : arguments.get(key);
        return value == null ? defaultValue : String.valueOf(value);
    }

    private boolean boolArg(Map<String, Object> arguments, String key, boolean defaultValue) {
        Object value = arguments == null ? null : arguments.get(key);
        if (value == null) {
            return defaultValue;
        }
        try {
            return objectMapper.convertValue(value, Boolean.class);
        } catch (IllegalArgumentException e) {
            throw new VrpApplicationException(
                    Response.Status.BAD_REQUEST,
                    VrpErrorCode.INVALID_ARGUMENT,
                    "Invalid argument: " + key,
                    e
            );
        }
    }

    private long longArg(Map<String, Object> arguments, String key, long defaultValue) {
        Object value = arguments == null ? null : arguments.get(key);
        if (value == null) {
            return defaultValue;
        }
        try {
            return objectMapper.convertValue(value, Long.class);
        } catch (IllegalArgumentException e) {
            throw new VrpApplicationException(
                    Response.Status.BAD_REQUEST,
                    VrpErrorCode.INVALID_ARGUMENT,
                    "Invalid argument: " + key,
                    e
            );
        }
    }

    private <E extends Enum<E>> E enumArg(Map<String, Object> arguments, String key, Class<E> type, E defaultValue) {
        Object value = arguments == null ? null : arguments.get(key);
        if (value == null) {
            return defaultValue;
        }
        String raw = String.valueOf(value);
        try {
            return Enum.valueOf(type, raw);
        } catch (IllegalArgumentException e) {
            throw new VrpApplicationException(
                    Response.Status.BAD_REQUEST,
                    VrpErrorCode.INVALID_ARGUMENT,
                    "Invalid " + key + ", expected one of " + List.of(type.getEnumConstants())
            );
        }
    }

    private String writeJson(Object value) {
        try {
            return OM.toJson(value);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Failed to serialize MCP tool result", e);
        }
    }

    @FunctionalInterface
    private interface ThrowingSupplier<T> {
        T get() throws Exception;
    }

    private record ToolDescriptor(
            String name,
            String description,
            String inputSchema,
            BiFunction<McpTransportContext, McpSchema.CallToolRequest, McpSchema.CallToolResult> callHandler
    ) {}
}
