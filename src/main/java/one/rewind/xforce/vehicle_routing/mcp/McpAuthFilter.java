package one.rewind.xforce.vehicle_routing.mcp;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;

public class McpAuthFilter implements Filter {

    private static final String BEARER_PREFIX = "Bearer ";

    private final McpProperties properties;
    private final ObjectMapper objectMapper;

    public McpAuthFilter(McpProperties properties, ObjectMapper objectMapper) {
        this.properties = properties;
        this.objectMapper = objectMapper;
    }

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        HttpServletRequest httpRequest = (HttpServletRequest) request;
        HttpServletResponse httpResponse = (HttpServletResponse) response;

        // Browser MCP clients need an unauthenticated CORS preflight before the real bearer-authenticated request.
        if ("OPTIONS".equalsIgnoreCase(httpRequest.getMethod())) {
            chain.doFilter(request, response);
            return;
        }

        String authorization = httpRequest.getHeader("Authorization");
        if (authorization == null || authorization.isBlank()) {
            respond(httpResponse, HttpServletResponse.SC_UNAUTHORIZED, "Missing Authorization header");
            return;
        }
        if (!authorization.startsWith(BEARER_PREFIX)) {
            respond(httpResponse, HttpServletResponse.SC_UNAUTHORIZED, "Invalid Authorization header");
            return;
        }

        String token = authorization.substring(BEARER_PREFIX.length()).trim();
        if (!constantTimeEquals(token, properties.token())) {
            respond(httpResponse, HttpServletResponse.SC_FORBIDDEN, "Invalid bearer token");
            return;
        }

        chain.doFilter(request, response);
    }

    private boolean constantTimeEquals(String left, String right) {
        return MessageDigest.isEqual(
                left.getBytes(StandardCharsets.UTF_8),
                right.getBytes(StandardCharsets.UTF_8)
        );
    }

    private void respond(HttpServletResponse response, int status, String message) throws IOException {
        response.setStatus(status);
        response.setContentType("application/json");
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.getWriter().write(writeErrorPayload(message));
    }

    private String writeErrorPayload(String message) throws JsonProcessingException {
        return objectMapper.writeValueAsString(Map.of(
                "error_code", "permission_denied",
                "message", message
        ));
    }
}
