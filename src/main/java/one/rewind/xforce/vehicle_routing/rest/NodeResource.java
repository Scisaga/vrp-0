package one.rewind.xforce.vehicle_routing.rest;

import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import one.rewind.xforce.geo.transit.TransitMatrix;
import one.rewind.xforce.vehicle_routing.mcp.McpProperties;
import one.rewind.xforce.vehicle_routing.mcp.McpServerRuntime;
import one.rewind.xforce.vehicle_routing.rest.exception.ErrorInfo;
import one.rewind.xforce.vehicle_routing.rest.msg.McpMeta;
import one.rewind.xforce.vehicle_routing.rest.msg.MapContext;
import one.rewind.xforce.vehicle_routing.rest.msg.Msg;
import one.rewind.xforce.vehicle_routing.service.VrpApplicationFacade;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.media.Content;
import org.eclipse.microprofile.openapi.annotations.media.Schema;
import org.eclipse.microprofile.openapi.annotations.responses.APIResponse;
import org.eclipse.microprofile.openapi.annotations.responses.APIResponses;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Optional;

/**
 * author: scisaga@qq.com
 */
@Tag(
        name = "节点信息查询配置",
        description = "查询/配置API私钥及限流策略"
)
@Path("")
public class NodeResource {

    private static final String STATIC_INDEX_PATH = "/static/index.html";
    private static final String MCP_DOC_RELATIVE_PATH = "docs/reference/mcp.md";

    @Inject
    VrpApplicationFacade facade;

    @Inject
    McpProperties mcpProperties;

    @Inject
    McpServerRuntime mcpServerRuntime;

    @Operation(summary = "跳转到静态控制台")
    @APIResponse(responseCode = "303", description = "重定向到静态控制台入口")
    @GET
    @Produces(MediaType.TEXT_HTML)
    public Response redirectRootToStaticIndex() {
        return Response.seeOther(java.net.URI.create(STATIC_INDEX_PATH)).build();
    }

    @Operation(
            summary = "查询API私钥及限流策略")
    @APIResponses(value = {
            @APIResponse(responseCode = "200", description = "API私钥及限流策略",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(implementation = one.rewind.amap.AmapAdapter.Conf.class)))
    })
    @GET
    @Produces(MediaType.APPLICATION_JSON)
    @Path("amap_conf")
    public one.rewind.amap.AmapAdapter.Conf getAmapConf() {
        return facade.getAmapConf();
    }

    @Operation(summary = "获取当前地图 SDK 上下文")
    @APIResponses(value = {
            @APIResponse(responseCode = "200", description = "当前图商的浏览器地图上下文",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(implementation = MapContext.class)))
    })
    @GET
    @Produces(MediaType.APPLICATION_JSON)
    @Path("map_context")
    public MapContext getMapContext() {
        return facade.getMapContext();
    }

    @Operation(
            summary = "查询API私钥及限流策略（前端配置页口径）")
    @APIResponses(value = {
            @APIResponse(responseCode = "200", description = "API私钥及限流策略",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(implementation = one.rewind.amap.AmapAdapter.Conf.class)))
    })
    @GET
    @Produces(MediaType.APPLICATION_JSON)
    @Path("quota")
    public one.rewind.amap.AmapAdapter.Conf getQuotaConf() {
        return facade.getAmapConf();
    }

    @Operation(summary = "查询 MCP 接入摘要")
    @APIResponses(value = {
            @APIResponse(responseCode = "200", description = "MCP 接入摘要",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(implementation = McpMeta.class)))
    })
    @GET
    @Produces(MediaType.APPLICATION_JSON)
    @Path("mcp/meta")
    public McpMeta getMcpMeta() {
        return new McpMeta(
                mcpProperties.enabled(),
                mcpProperties.path(),
                mcpProperties.allowedOrigins(),
                mcpServerRuntime.toolNames(),
                mcpServerRuntime.transportName(),
                mcpServerRuntime.authMode()
        );
    }

    @Operation(summary = "打开 MCP 参考文档")
    @APIResponses(value = {
            @APIResponse(responseCode = "200", description = "MCP Markdown 文档"),
            @APIResponse(responseCode = "404", description = "文档不存在")
    })
    @GET
    @Produces("text/markdown; charset=UTF-8")
    @Path("mcp/doc")
    public Response getMcpDoc() throws IOException {
        Optional<java.nio.file.Path> docPath = resolveMcpDocPath();
        if (docPath.isEmpty()) {
            return Response.status(Response.Status.NOT_FOUND)
                    .type(MediaType.TEXT_PLAIN_TYPE.withCharset(StandardCharsets.UTF_8.name()))
                    .entity("MCP 文档不存在: " + MCP_DOC_RELATIVE_PATH)
                    .build();
        }
        return Response.ok(Files.readString(docPath.get(), StandardCharsets.UTF_8))
                .type("text/markdown; charset=UTF-8")
                .build();
    }

    private Optional<java.nio.file.Path> resolveMcpDocPath() {
        java.nio.file.Path current = java.nio.file.Path.of("").toAbsolutePath().normalize();
        for (java.nio.file.Path cursor = current; cursor != null; cursor = cursor.getParent()) {
            java.nio.file.Path candidate = cursor.resolve(MCP_DOC_RELATIVE_PATH).normalize();
            if (Files.exists(candidate) && Files.isRegularFile(candidate)) {
                return Optional.of(candidate);
            }
        }
        return Optional.empty();
    }

    @Operation(summary = "更新API私钥及限流策略")
    @APIResponses(value = {
            @APIResponse(responseCode = "200", description = "已保存的API私钥及限流策略",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(implementation = one.rewind.amap.AmapAdapter.Conf.class)))
    })
    @PUT
    @Consumes({ MediaType.APPLICATION_JSON })
    @Produces(MediaType.APPLICATION_JSON)
    @Path("quota")
    public one.rewind.amap.AmapAdapter.Conf updateQuotaConf(one.rewind.amap.AmapAdapter.Conf conf) {
        return facade.updateAmapConf(conf);
    }

    @Operation(
            summary = "获取进程内 AMap 路由缓存矩阵",
            description = "只访问 AmapTransitCalculator 的进程内缓存，不读取当前场景或求解任务中的矩阵。仅 MAP_PROVIDER=AMAP 时可用。")
    @APIResponses(value = {
            @APIResponse(responseCode = "200", description = "进程内 AMap 路由缓存矩阵",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(implementation = TransitMatrix.class))),
            @APIResponse(responseCode = "412", description = "当前地图提供方不是 AMap",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(implementation = ErrorInfo.class)))
    })
    @GET
    @Produces(MediaType.APPLICATION_JSON)
    @Path("matrix")
    public TransitMatrix getTransitMatrix() {
        return facade.getTransitMatrix();
    }


    @Operation(
            summary = "替换进程内 AMap 路由缓存矩阵",
            description = "只更新 AmapTransitCalculator 的进程内缓存，不写入当前场景或求解任务中的矩阵。仅 MAP_PROVIDER=AMAP 时可用。")
    @APIResponses(value = {
            @APIResponse(responseCode = "200",
                    description = "执行结果信息",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON, schema = @Schema(implementation = Msg.class))),
            @APIResponse(responseCode = "412", description = "当前地图提供方不是 AMap",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(implementation = ErrorInfo.class))) })
    @POST
    @Consumes({ MediaType.APPLICATION_JSON })
    @Produces(MediaType.APPLICATION_JSON)
    @Path("matrix")
    public Msg setTransitMatrix(TransitMatrix matrix) {
        return facade.setTransitMatrix(matrix);
    }
}
