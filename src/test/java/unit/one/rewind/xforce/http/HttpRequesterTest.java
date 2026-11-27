package one.rewind.xforce.http;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

class HttpRequesterTest {

    private HttpServer server;
    private ExecutorService serverExecutor;
    private String baseUrl;
    private final Set<Integer> ports = ConcurrentHashMap.newKeySet();
    private final AtomicInteger echoCalls = new AtomicInteger();

    @BeforeEach
    void startServer() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        serverExecutor = Executors.newCachedThreadPool();
        server.setExecutor(serverExecutor);
        server.createContext("/echo", exchange -> {
            echoCalls.incrementAndGet();
            ports.add(exchange.getRemoteAddress().getPort());
            String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            String text = exchange.getRequestMethod() + '|' + exchange.getRequestHeaders().getFirst("X-Request-Id")
                    + '|' + exchange.getRequestHeaders().getFirst("Authorization") + '|' + body;
            byte[] response = text.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, response.length);
            try (var stream = exchange.getResponseBody()) {
                stream.write(response);
            }
        });
        server.createContext("/redirect", exchange -> {
            exchange.getResponseHeaders().set("Location", "/echo");
            exchange.sendResponseHeaders(303, -1);
            exchange.close();
        });
        server.start();
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
        serverExecutor.shutdownNow();
    }

    @Test
    void sharedFactoryReturnsOneRequesterAcrossThreads() throws Exception {
        CyclicBarrier start = new CyclicBarrier(8);
        try (ExecutorService workers = Executors.newFixedThreadPool(8)) {
            var results = new ArrayList<Future<HttpRequester>>();
            for (int i = 0; i < 8; i++) {
                results.add(workers.submit(() -> {
                    start.await(5, TimeUnit.SECONDS);
                    return HttpRequester.shared();
                }));
            }
            for (Future<HttpRequester> result : results) {
                assertSame(HttpRequester.shared(), result.get(5, TimeUnit.SECONDS));
            }
        }
    }

    @Test
    void sequentialRequestsReuseTheConnection() {
        assertEquals(200, HttpRequester.shared().req(baseUrl + "/echo").orElseThrow().statusCode);
        assertEquals(200, HttpRequester.shared().req(baseUrl + "/echo").orElseThrow().statusCode);
        assertEquals(2, echoCalls.get());
        assertEquals(1, ports.size(), "The local server must see one reused TCP connection");
    }

    @Test
    void concurrentGetAndPostKeepHeadersAndBodiesIsolated() throws Exception {
        CyclicBarrier start = new CyclicBarrier(16);
        try (ExecutorService workers = Executors.newFixedThreadPool(16)) {
            var results = new ArrayList<Future<String>>();
            for (int i = 0; i < 16; i++) {
                int id = i;
                results.add(workers.submit(() -> {
                    start.await(5, TimeUnit.SECONDS);
                    String method = id % 2 == 0 ? "GET" : "POST";
                    byte[] body = method.equals("GET") ? null : ("body-" + id).getBytes(StandardCharsets.UTF_8);
                    return HttpRequester.shared().req(baseUrl + "/echo", method,
                            Map.of("X-Request-Id", "id-" + id, "Authorization", "fixture-" + id), body)
                            .orElseThrow().getText();
                }));
            }
            for (int i = 0; i < results.size(); i++) {
                String method = i % 2 == 0 ? "GET" : "POST";
                assertEquals(method + "|id-" + i + "|fixture-" + i + '|' + (i % 2 == 0 ? "" : "body-" + i),
                        results.get(i).get(5, TimeUnit.SECONDS));
            }
        }
        assertEquals("GET|null|null|", HttpRequester.shared().req(baseUrl + "/echo").orElseThrow().getText());
    }

    @Test
    void redirectsRemainExplicit() {
        HttpResponsePayload response = HttpRequester.shared().req(baseUrl + "/redirect").orElseThrow();
        assertEquals(303, response.statusCode);
        assertEquals("/echo", response.firstHeader("location"));
        assertEquals(0, echoCalls.get());
    }
}
