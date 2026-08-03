package one.rewind.xforce.vehicle_routing.rest;

import jakarta.inject.Inject;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import one.rewind.xforce.geo.POI;
import one.rewind.xforce.vehicle_routing.rest.exception.ErrorInfo;
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

/**
 * author: scisaga@qq.com
 */
@Tag(
        name = "地址查询生成",
        description = "根据关键词、城市/adcode、类型批量生成真实地址"
)
@Path("pois")
public class PoiResource {

    @Inject
    VrpApplicationFacade facade;

    @Operation(
            summary = "按关键词查询 POI")
    @APIResponses(value = {
            @APIResponse(
                    responseCode = "200",
                    description = "真实地址列表",
                    content = @Content(
                            mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(type = SchemaType.ARRAY, implementation = POI.class))),
            @APIResponse(responseCode = "400", description = "参数错误",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(implementation = ErrorInfo.class))),
            @APIResponse(responseCode = "412", description = "当前地图提供方不可用",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(implementation = ErrorInfo.class))),
            @APIResponse(responseCode = "500", description = "请求当前地图提供方接口异常",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(implementation = ErrorInfo.class)))
    })
    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public List<POI> list(
            @Parameter(description = "关键词", required = true) @QueryParam("keywords") String keywords,
            @Parameter(description = "城市/adcode") @QueryParam("city") String city,
            @Parameter(description = "类型") @QueryParam("types") String types,
            @Parameter(description = "累计查询页数", schema = @Schema(type = SchemaType.INTEGER, format = "int64", minimum = "1", defaultValue = "1")) @QueryParam("page") @DefaultValue("1") long page
    ) {
        return facade.searchPois(keywords, city, types, page);
    }

    @Operation(summary = "按地址文本执行地理编码")
    @APIResponses(value = {
            @APIResponse(
                    responseCode = "200",
                    description = "地理编码候选结果",
                    content = @Content(
                            mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(type = SchemaType.ARRAY, implementation = POI.class))),
            @APIResponse(responseCode = "400", description = "参数错误",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(implementation = ErrorInfo.class))),
            @APIResponse(responseCode = "412", description = "当前地图提供方不可用",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(implementation = ErrorInfo.class))),
            @APIResponse(responseCode = "500", description = "请求当前地图提供方接口异常",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(implementation = ErrorInfo.class)))
    })
    @GET
    @Path("geocode")
    @Produces(MediaType.APPLICATION_JSON)
    public List<POI> geocode(
            @Parameter(description = "关键词", required = true) @QueryParam("keywords") String keywords,
            @Parameter(description = "城市/adcode") @QueryParam("city") String city
    ) {
        return facade.geocodePois(keywords, city);
    }

    @Operation(summary = "按经纬度执行逆地理编码")
    @APIResponses(value = {
            @APIResponse(
                    responseCode = "200",
                    description = "逆地理编码结果",
                    content = @Content(
                            mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(implementation = POI.class))),
            @APIResponse(responseCode = "400", description = "参数错误",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(implementation = ErrorInfo.class))),
            @APIResponse(responseCode = "412", description = "当前地图提供方不可用",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(implementation = ErrorInfo.class))),
            @APIResponse(responseCode = "500", description = "请求当前地图提供方接口异常",
                    content = @Content(mediaType = MediaType.APPLICATION_JSON,
                            schema = @Schema(implementation = ErrorInfo.class)))
    })
    @GET
    @Path("regeocode")
    @Produces(MediaType.APPLICATION_JSON)
    public POI reverseGeocode(
            @Parameter(description = "经纬度，格式：lng,lat", required = true) @QueryParam("location") String location
    ) {
        return facade.reverseGeocodePoi(location);
    }
}
