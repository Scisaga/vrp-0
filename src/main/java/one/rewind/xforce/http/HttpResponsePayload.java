package one.rewind.xforce.http;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

public class HttpResponsePayload {

    public final byte[] rBody;
    public final int statusCode;
    /** Response headers are needed by HERE Matrix's 303 result redirect. */
    public final Map<String, List<String>> headers;

    public HttpResponsePayload(byte[] rBody, int statusCode) {
        this(rBody, statusCode, Map.of());
    }

    public HttpResponsePayload(byte[] rBody, int statusCode, Map<String, List<String>> headers) {
        this.rBody = rBody;
        this.statusCode = statusCode;
        this.headers = headers == null ? Map.of() : Map.copyOf(headers);
    }

    public String getText() {
        return new String(rBody, StandardCharsets.UTF_8);
    }

    public String firstHeader(String name) {
        if (name == null) {
            return "";
        }
        return headers.entrySet().stream()
                .filter(entry -> name.equalsIgnoreCase(entry.getKey()))
                .flatMap(entry -> entry.getValue().stream())
                .findFirst()
                .orElse("");
    }
}
