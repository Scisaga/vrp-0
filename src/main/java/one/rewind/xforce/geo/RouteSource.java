package one.rewind.xforce.geo;

import io.quarkus.runtime.annotations.RegisterForReflection;
import org.eclipse.microprofile.openapi.annotations.media.Schema;

/**
 * The provider/result used for a route segment.
 */
@Schema(description = "路线来源")
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
