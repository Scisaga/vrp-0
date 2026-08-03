package one.rewind.xforce.geo;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.quarkus.runtime.annotations.RegisterForReflection;
import org.eclipse.microprofile.openapi.annotations.media.Schema;
import one.rewind.xforce.geo.transit.Transit;

import java.io.Serializable;
import java.util.LinkedList;
import java.util.List;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@RegisterForReflection(serialization = true)
public class Route implements Serializable {

    @Schema(description = "路线起点")
    public LOC origin;

    @Schema(description = "路线终点")
    public LOC destination;

    @Schema(description = "道路轨迹坐标；估算路线时为空")
    public List<LOC> polyline = new LinkedList<>();

    @Schema(description = "路线距离与时长")
    public Transit transit;

    @Schema(description = "通行费，单位元")
    public long tolls;

    @Schema(description = "本段路线的最终来源")
    public RouteSource routeSource;

    @Schema(description = "生成本段路线期间发生的路径服务失败记录")
    public List<RoutingFailure> routingFailures = new LinkedList<>();

    public Route(){};

    public Route(LOC origin, LOC destination, List<LOC> polyline, Transit transit, long tolls) {
        this.origin = origin;
        this.destination = destination;
        this.polyline = polyline;
        this.transit = transit;
        this.tolls = tolls;
    }
}
