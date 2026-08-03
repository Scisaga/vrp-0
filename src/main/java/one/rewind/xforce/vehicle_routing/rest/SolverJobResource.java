package one.rewind.xforce.vehicle_routing.rest;

import jakarta.inject.Inject;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.DefaultValue;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import one.rewind.xforce.vehicle_routing.bootstrap.GeoUtil;
import one.rewind.xforce.vehicle_routing.db.dto.Scenario;
import one.rewind.xforce.vehicle_routing.db.dto.SolverJob;
import one.rewind.xforce.vehicle_routing.db.dto.SolverJobListFilter;
import one.rewind.xforce.vehicle_routing.db.dto.SolverJobSummary;
import one.rewind.xforce.vehicle_routing.rest.exception.ErrorInfo;
import one.rewind.xforce.vehicle_routing.rest.msg.Msg;
import one.rewind.xforce.vehicle_routing.service.VrpApplicationFacade;
import one.rewind.xforce.vehicle_routing.service.VrpApplicationException;
import one.rewind.xforce.vehicle_routing.service.VrpErrorCode;
import one.rewind.xforce.vehicle_routing.solver.Status;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.enums.SchemaType;
import org.eclipse.microprofile.openapi.annotations.media.Content;
import org.eclipse.microprofile.openapi.annotations.media.Schema;
import org.eclipse.microprofile.openapi.annotations.parameters.Parameter;
import org.eclipse.microprofile.openapi.annotations.responses.APIResponse;
import org.eclipse.microprofile.openapi.annotations.responses.APIResponseSchema;
import org.eclipse.microprofile.openapi.annotations.responses.APIResponses;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

import java.time.LocalDateTime;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

@Tag(
        name = "VRP求解引擎",
        description = "维护单例当前场景、求解任务历史和最新任务指针的 VRP 求解引擎"
)
@Path("solver_job")
public class SolverJobResource {

    @Inject
    VrpApplicationFacade facade;

    @Operation(summary = "获取当前求解任务")
    @APIResponses(value = {
            @APIResponse(responseCode = "200", description = "当前求解任务",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(implementation = SolverJob.class))),
            @APIResponse(responseCode = "404", description = "当前没有求解任务",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(implementation = ErrorInfo.class)))
    })
    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public SolverJob getCurrent(
            @Parameter(description = "是否清除虚拟工程师指派") @QueryParam("remove_virtual") @DefaultValue("false") boolean removeVirtual
    ) {
        return facade.getCurrentSolverJob(removeVirtual);
    }

    @Operation(
            summary = "按条件获取求解任务历史列表",
            description = "未传筛选条件时返回全部任务，并按创建时间倒序排列。创建时间范围使用 ISO 本地日期时间，首尾均包含。"
    )
    @APIResponseSchema(
            responseCode = "200",
            responseDescription = "求解任务摘要列表",
            value = SolverJobSummary[].class
    )
    @APIResponses(value = {
            @APIResponse(responseCode = "400", description = "筛选参数非法",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(implementation = ErrorInfo.class)))
    })
    @GET
    @Path("list")
    @Produces(MediaType.APPLICATION_JSON)
    public List<SolverJobSummary> list(
            @Parameter(description = "任务状态", schema = @Schema(implementation = Status.class)) @QueryParam("status") String status,
            @Parameter(description = "创建时间起点（ISO 本地日期时间，包含）", schema = @Schema(type = SchemaType.STRING, pattern = "yyyy-MM-dd'T'HH:mm:ss")) @QueryParam("create_time_from") String createTimeFrom,
            @Parameter(description = "创建时间终点（ISO 本地日期时间，包含）", schema = @Schema(type = SchemaType.STRING, pattern = "yyyy-MM-dd'T'HH:mm:ss")) @QueryParam("create_time_to") String createTimeTo,
            @Parameter(description = "按任务记录中的矩阵构建选项筛选", schema = @Schema(type = SchemaType.BOOLEAN)) @QueryParam("build_transit_matrix") String buildTransitMatrix,
            @Parameter(description = "按任务记录中的矩阵方式筛选：ROUTING、MANHATTAN；AMAP 兼容旧记录", schema = @Schema(implementation = GeoUtil.MatrixMode.class)) @QueryParam("matrix_mode") String matrixMode,
            @Parameter(description = "是否生成完整路线规划", schema = @Schema(type = SchemaType.BOOLEAN)) @QueryParam("draw_route") String drawRoute
    ) {
        return facade.listSolverJobs(parseListFilter(status, createTimeFrom, createTimeTo, buildTransitMatrix, matrixMode, drawRoute));
    }

    private SolverJobListFilter parseListFilter(
            String status,
            String createTimeFrom,
            String createTimeTo,
            String buildTransitMatrix,
            String matrixMode,
            String drawRoute
    ) {
        Status parsedStatus = parseEnum("status", status, Status.class);
        LocalDateTime parsedCreateTimeFrom = parseLocalDateTime("create_time_from", createTimeFrom);
        LocalDateTime parsedCreateTimeTo = parseLocalDateTime("create_time_to", createTimeTo);
        if (parsedCreateTimeFrom != null && parsedCreateTimeTo != null && parsedCreateTimeFrom.isAfter(parsedCreateTimeTo)) {
            throw invalidArgument("create_time_from", "range", "create_time_from 不能晚于 create_time_to");
        }
        GeoUtil.MatrixMode parsedMatrixMode = parseEnum("matrix_mode", matrixMode, GeoUtil.MatrixMode.class);
        return new SolverJobListFilter(
                parsedStatus,
                parsedCreateTimeFrom,
                parsedCreateTimeTo,
                parseBoolean("build_transit_matrix", buildTransitMatrix),
                parsedMatrixMode == null ? null : parsedMatrixMode.name(),
                parseBoolean("draw_route", drawRoute)
        );
    }

    private <T extends Enum<T>> T parseEnum(String parameter, String value, Class<T> enumType) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return Enum.valueOf(enumType, value.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException error) {
            throw invalidArgument(parameter, "enum", parameter + " 参数非法");
        }
    }

    private LocalDateTime parseLocalDateTime(String parameter, String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return LocalDateTime.parse(value.trim());
        } catch (DateTimeParseException error) {
            throw invalidArgument(parameter, "date_time", parameter + " 必须是 ISO 本地日期时间");
        }
    }

    private Boolean parseBoolean(String parameter, String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        if ("true".equalsIgnoreCase(value.trim())) {
            return true;
        }
        if ("false".equalsIgnoreCase(value.trim())) {
            return false;
        }
        throw invalidArgument(parameter, "boolean", parameter + " 必须是 true 或 false");
    }

    private VrpApplicationException invalidArgument(String field, String rule, String message) {
        return new VrpApplicationException(
                Response.Status.BAD_REQUEST,
                VrpErrorCode.INVALID_FILTER,
                java.util.Map.of("field", field, "rule", rule),
                message,
                false
        );
    }

    @Operation(summary = "按任务ID获取求解任务")
    @GET
    @Path("{id}")
    @Produces(MediaType.APPLICATION_JSON)
    public SolverJob getById(
            @PathParam("id") UUID id,
            @Parameter(description = "是否清除虚拟工程师指派") @QueryParam("remove_virtual") @DefaultValue("false") boolean removeVirtual
    ) {
        return facade.getSolverJob(id, removeVirtual);
    }

    @Operation(summary = "基于当前场景提交求解")
    @APIResponses(value = {
            @APIResponse(responseCode = "200", description = "已提交的当前求解任务",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(implementation = SolverJob.class))),
            @APIResponse(responseCode = "404", description = "当前没有场景",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(implementation = ErrorInfo.class))),
            @APIResponse(responseCode = "409", description = "已有运行中的求解任务",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(implementation = ErrorInfo.class)))
    })
    @POST
    @Produces(MediaType.APPLICATION_JSON)
    public SolverJob solveCurrentScenario(
            @Parameter(description = "期望求解时间，ISO 8601 duration format") @QueryParam("solve_time") @DefaultValue("PT30S") String solveTime,
            @Parameter(description = "记录到任务的矩阵方式元数据：ROUTING、MANHATTAN；当前求解要求输入矩阵已预先构建，AMAP 仅兼容旧调用") @QueryParam("matrix_mode") @DefaultValue("ROUTING") GeoUtil.MatrixMode matrixMode,
            @Parameter(description = "记录到任务并用于列表筛选的矩阵构建选项；当前求解阶段不会重新构建输入矩阵") @QueryParam("build_transit_matrix") @DefaultValue("false") boolean buildTransitMatrix,
            @Parameter(description = "是否生成完整路线规划") @QueryParam("draw_route") boolean drawRoute,
            @Parameter(description = "求解完成回调URL") @QueryParam("callback") @DefaultValue("") String callback
    ) {
        return facade.startSolverJob(solveTime, matrixMode, buildTransitMatrix, drawRoute, callback);
    }

    @Operation(summary = "终止当前求解任务")
    @APIResponses(value = {
            @APIResponse(responseCode = "200", description = "当前求解任务",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(implementation = SolverJob.class))),
            @APIResponse(responseCode = "404", description = "当前没有求解任务",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(implementation = ErrorInfo.class)))
    })
    @POST
    @Produces(MediaType.APPLICATION_JSON)
    @Path("terminate")
    public SolverJob terminateCurrent() {
        return facade.terminateCurrentSolverJob();
    }

    @Operation(summary = "将当前求解结果应用到当前场景")
    @APIResponses(value = {
            @APIResponse(responseCode = "200", description = "应用后的当前场景",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(implementation = Scenario.class))),
            @APIResponse(responseCode = "404", description = "当前没有场景或求解任务",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(implementation = ErrorInfo.class)))
    })
    @POST
    @Produces(MediaType.APPLICATION_JSON)
    @Path("apply")
    public Scenario applyToCurrentScenario() {
        return facade.applyCurrentSolverJob();
    }

    @Operation(summary = "将指定求解结果应用到当前场景")
    @POST
    @Produces(MediaType.APPLICATION_JSON)
    @Path("{id}/apply")
    public Scenario applyToScenario(@PathParam("id") UUID id) {
        return facade.applySolverJob(id);
    }

    @Operation(summary = "删除当前求解任务")
    @APIResponses(value = {
            @APIResponse(responseCode = "200", description = "请求成功",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(implementation = Msg.class))),
            @APIResponse(responseCode = "404", description = "当前没有求解任务",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(implementation = ErrorInfo.class)))
    })
    @DELETE
    @Produces(MediaType.APPLICATION_JSON)
    public Msg deleteCurrent() {
        return facade.deleteCurrentSolverJob();
    }

    @Operation(summary = "删除指定求解任务")
    @DELETE
    @Path("{id}")
    @Produces(MediaType.APPLICATION_JSON)
    public Msg delete(@PathParam("id") UUID id) {
        return facade.deleteSolverJob(id);
    }

    // Test helper retained for existing non-REST callers.
    public SolverJob solve(Scenario scenario, String solveTime, boolean drawRoute, String callback, String responseMode)
            throws one.rewind.xforce.vehicle_routing.exception.TransitMatrixNotBuild,
            one.rewind.xforce.vehicle_routing.exception.POINotBuild {
        scenario.setUpdateTime(java.time.LocalDateTime.now());
        scenario.addVirtualAgents();
        facade.upsertCurrentScenario(scenario, false, one.rewind.xforce.vehicle_routing.bootstrap.GeoUtil.MatrixMode.ROUTING);
        return solveCurrentScenario(solveTime, GeoUtil.MatrixMode.ROUTING, false, drawRoute, callback);
    }

    // Test helper retained for existing non-REST callers.
    public SolverJob getSolverJob(UUID id, boolean removeVirtual) {
        return id == null ? getCurrent(removeVirtual) : getById(id, removeVirtual);
    }
}
