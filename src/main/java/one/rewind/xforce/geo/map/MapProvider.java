package one.rewind.xforce.geo.map;

import io.quarkus.runtime.annotations.RegisterForReflection;
import org.eclipse.microprofile.openapi.annotations.media.Schema;

import java.util.Locale;

/** The single map provider enabled for this engine process. */
@Schema(
        title = "地图服务提供商",
        description = "可选值：AMAP（高德地图），使用高德地图能力；HERE（HERE 地图），使用 HERE 地图能力。",
        enumeration = {"AMAP", "HERE"}
)
@RegisterForReflection(serialization = true)
public enum MapProvider {
    AMAP,
    HERE;

    public static MapProvider parse(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("MAP_PROVIDER must be AMAP or HERE");
        }
        try {
            return valueOf(value.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("MAP_PROVIDER must be AMAP or HERE", e);
        }
    }
}
