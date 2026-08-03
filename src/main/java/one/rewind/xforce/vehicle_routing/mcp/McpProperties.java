package one.rewind.xforce.vehicle_routing.mcp;

import jakarta.annotation.PostConstruct;
import jakarta.enterprise.context.ApplicationScoped;
import io.quarkus.arc.Unremovable;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;

@ApplicationScoped
@Unremovable
public class McpProperties {

    @ConfigProperty(name = "vrp.mcp.enabled", defaultValue = "true")
    boolean enabled;

    @ConfigProperty(name = "vrp.mcp.path", defaultValue = "/mcp")
    String path;

    @ConfigProperty(name = "vrp.mcp.auth.token", defaultValue = "change-me")
    String token;

    @ConfigProperty(name = "vrp.mcp.allowed-origins", defaultValue = "")
    Optional<String> allowedOrigins;

    @PostConstruct
    void validate() {
        if (enabled && token.isBlank()) {
            throw new IllegalStateException("vrp.mcp.auth.token should not be blank when MCP is enabled");
        }
    }

    public boolean enabled() {
        return enabled;
    }

    public String path() {
        if (path == null || path.isBlank()) {
            return "/mcp";
        }
        String normalized = path.startsWith("/") ? path : "/" + path;
        if (normalized.length() > 1 && normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        return normalized;
    }

    public String token() {
        return token;
    }

    public List<String> allowedOrigins() {
        return List.of(allowedOrigins.orElse("").split(","))
                .stream()
                .map(String::trim)
                .filter(value -> !value.isEmpty())
                .collect(Collectors.toList());
    }
}
