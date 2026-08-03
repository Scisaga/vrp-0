package one.rewind.xforce.vehicle_routing.rest;

import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.DefaultValue;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.MediaType;
import one.rewind.xforce.vehicle_routing.bootstrap.GeoUtil;
import one.rewind.xforce.vehicle_routing.db.dto.Scenario;
import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.rest.exception.ErrorInfo;
import one.rewind.xforce.vehicle_routing.rest.msg.Msg;
import one.rewind.xforce.vehicle_routing.service.VrpApplicationFacade;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.enums.SchemaType;
import org.eclipse.microprofile.openapi.annotations.media.Content;
import org.eclipse.microprofile.openapi.annotations.media.Schema;
import org.eclipse.microprofile.openapi.annotations.parameters.Parameter;
import org.eclipse.microprofile.openapi.annotations.responses.APIResponse;
import org.eclipse.microprofile.openapi.annotations.responses.APIResponses;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

import java.util.List;

@Tag(name = "场景路由", description = "VRP单例场景的查询与更新")
@Path("scenario")
public class ScenarioResource {

    @Inject
    VrpApplicationFacade facade;

    @Operation(summary = "获取当前场景")
    @APIResponses(value = {
            @APIResponse(responseCode = "200", description = "当前场景",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(implementation = Scenario.class))),
            @APIResponse(responseCode = "404", description = "当前没有场景",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(implementation = ErrorInfo.class)))
    })
    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public Scenario getCurrent() {
        return facade.getCurrentScenario();
    }

    @Operation(summary = "获取当前场景，若不存在则返回 JSON null")
    @APIResponses(value = {
            @APIResponse(responseCode = "200", description = "当前场景；不存在时返回 JSON null",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(implementation = Scenario.class)))
    })
    @GET
    @Path("optional")
    @Produces(MediaType.APPLICATION_JSON)
    public Response getCurrentOptional() {
        Scenario scenario = facade.findCurrentScenario();
        if (scenario == null) {
            return Response.ok("null", MediaType.APPLICATION_JSON).build();
        }
        return Response.ok(scenario).build();
    }

    @Operation(
            operationId = "putScenario",
            summary = "创建或更新当前场景",
            description = "保存时，已有坐标的 POI 仅在地址或城市为空时执行逆地理解析，并且只补齐缺失的地址和城市；无坐标但有地址的 POI 保持既有正向解析行为。已填写字段不会被自动覆盖，解析失败不会阻断保存。"
    )
    @APIResponses(value = {
            @APIResponse(responseCode = "200", description = "已保存的当前场景",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(implementation = Scenario.class))),
            @APIResponse(responseCode = "409", description = "当前求解任务运行中，不允许修改场景",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(implementation = ErrorInfo.class)))
    })
    @PUT
    @Consumes({ MediaType.APPLICATION_JSON })
    @Produces(MediaType.APPLICATION_JSON)
    public Scenario upsert(
            @Parameter(description = "场景对象") Scenario scenario,
            @Parameter(description = "是否在普通的缺失位置补全之外，进一步完整构建 POI 和场景在途矩阵") @QueryParam("build") @DefaultValue("false") boolean build,
            @Parameter(description = "在途矩阵构建模式：ROUTING 使用当前 MAP_PROVIDER，MANHATTAN 使用离线估算；AMAP 仅兼容旧调用") @QueryParam("matrix_mode") @DefaultValue("ROUTING") GeoUtil.MatrixMode matrixMode,
            @Parameter(description = "是否按导入替换场景处理；为 true 时会清理历史求解任务") @QueryParam("replace") @DefaultValue("false") boolean replace
    ) {
        return facade.upsertCurrentScenario(scenario, build, matrixMode, replace);
    }

    @Operation(summary = "删除当前场景")
    @APIResponses(value = {
            @APIResponse(responseCode = "200", description = "处理结果信息",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(implementation = Msg.class))),
            @APIResponse(responseCode = "404", description = "当前没有场景",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(implementation = ErrorInfo.class))),
            @APIResponse(responseCode = "409", description = "当前求解任务运行中，不允许删除场景",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(implementation = ErrorInfo.class)))
    })
    @DELETE
    @Produces(MediaType.APPLICATION_JSON)
    public Msg deleteCurrent() {
        return facade.deleteCurrentScenario();
    }

    @Operation(summary = "按2小时颗粒度获取当前场景空闲工程师数量")
    @APIResponses(value = {
            @APIResponse(
                    responseCode = "200",
                    description = "规划时间范围内的可用工程师数量数组（2小时一段）",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(type = SchemaType.ARRAY, implementation = RoutePlan.AvailableAgentWindow.class)))
    })
    @GET
    @Produces(MediaType.APPLICATION_JSON)
    @Path("available_agents")
    public List<RoutePlan.AvailableAgentWindow> availableAgents() {
        return facade.getAvailableAgents();
    }
}
