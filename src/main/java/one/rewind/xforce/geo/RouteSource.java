package one.rewind.xforce.geo;

import io.quarkus.runtime.annotations.RegisterForReflection;
import org.eclipse.microprofile.openapi.annotations.media.Schema;

/**
 * The provider/result used for a route segment.
 */
@Schema(
        title = "路线来源",
        description = "可选值：AMAP_TRUCK（高德货车路线）、AMAP_DRIVING（高德驾车路线）、AMAP_BICYCLE（高德骑行路线）、HERE_TRUCK（HERE 货车路线）、HERE_DRIVING（HERE 驾车路线）、HERE_BICYCLE（HERE 骑行路线）、CAR_FALLBACK（货车失败后的普通驾车降级路线）、ESTIMATED（无真实道路轨迹的估算路线）、ZERO_DISTANCE（起终点相同的零距离路线）。"
)
@RegisterForReflection(serialization = true)
public enum RouteSource {
    AMAP_TRUCK,
    AMAP_DRIVING,
    AMAP_BICYCLE,
    HERE_TRUCK,
    HERE_DRIVING,
    HERE_BICYCLE,
    CAR_FALLBACK,
    ESTIMATED,
    ZERO_DISTANCE
}
