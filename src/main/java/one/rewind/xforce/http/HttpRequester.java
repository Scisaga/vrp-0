package one.rewind.xforce.http;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Collections;
import java.util.Map;
import java.util.Optional;

public class HttpRequester {

    private static final Duration DEFAULT_TIMEOUT = Duration.ofSeconds(20);

    private final HttpClient client;

    public HttpRequester() {
        this.client = HttpClient.newBuilder()
                .connectTimeout(DEFAULT_TIMEOUT)
                .build();
    }

    public Optional<HttpResponsePayload> req(String url) {
        return req(url, "GET", Collections.emptyMap(), null);
    }

    public Optional<HttpResponsePayload> req(String url, String method, Map<String, String> headers, byte[] body) {
        try {
            HttpRequest.Builder builder = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .timeout(DEFAULT_TIMEOUT);

            if (headers != null) {
                headers.forEach(builder::header);
            }

            if (body != null && body.length > 0) {
                builder.method(method, HttpRequest.BodyPublishers.ofByteArray(body));
            } else {
                builder.method(method, HttpRequest.BodyPublishers.noBody());
            }

            HttpResponse<byte[]> response = client.send(builder.build(), HttpResponse.BodyHandlers.ofByteArray());
            return Optional.of(new HttpResponsePayload(response.body(), response.statusCode(), response.headers().map()));
        } catch (Exception e) {
            return Optional.empty();
        }
    }
}
