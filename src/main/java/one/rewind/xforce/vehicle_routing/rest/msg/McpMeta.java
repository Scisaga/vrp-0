package one.rewind.xforce.vehicle_routing.rest.msg;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.quarkus.runtime.annotations.RegisterForReflection;

import java.util.List;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@RegisterForReflection(serialization = true)
public record McpMeta(
        boolean enabled,
        String path,
        List<String> allowedOrigins,
        List<String> tools,
        String transport,
        String authMode
) {}
