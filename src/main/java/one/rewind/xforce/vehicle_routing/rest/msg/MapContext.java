package one.rewind.xforce.vehicle_routing.rest.msg;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.quarkus.runtime.annotations.RegisterForReflection;
import one.rewind.xforce.geo.map.MapProvider;
import org.eclipse.microprofile.openapi.annotations.media.Schema;

/** Browser-safe map bootstrap information for the provider selected by this pod. */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@RegisterForReflection(serialization = true)
@Schema(description = "当前地图 SDK 上下文")
public record MapContext(
        String provider,
        boolean enabled,
        String browserKey,
        String jsUrl,
        String cssUrl,
        String coordinateSystem,
        String locale
) {
    public static MapContext disabled(MapProvider provider) {
        boolean here = provider == MapProvider.HERE;
        return new MapContext(here ? "here" : "amap", false, "", "", "",
                here ? "wgs84" : "gcj02", "zh-CN");
    }
}
