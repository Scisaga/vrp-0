package one.rewind.xforce.geo.map;

import com.sun.net.httpserver.HttpServer;
import one.rewind.amap.AmapAdapter;
import one.rewind.amap.RateLimitExecutor;
import one.rewind.here.HereAdapter;
import one.rewind.xforce.http.HttpResponsePayload;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.lang.reflect.Field;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

class MapTransportTest {

    @Test
    void bothAdaptersShareConnectionsAndStillEnforceTheirQuota(@TempDir Path tempDir) throws Exception {
        Field singleton = AmapAdapter.class.getDeclaredField("inst");
        singleton.setAccessible(true);
        Object previous = singleton.get(null);
        Set<Integer> ports = ConcurrentHashMap.newKeySet();
        Map<String, String> queries = new ConcurrentHashMap<>();
        AtomicInteger calls = new AtomicInteger();
        ExecutorService serverExecutor = Executors.newCachedThreadPool();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.setExecutor(serverExecutor);
        server.createContext("/", exchange -> {
            calls.incrementAndGet();
            ports.add(exchange.getRemoteAddress().getPort());
            queries.put(exchange.getRequestURI().getPath(), String.valueOf(exchange.getRequestURI().getRawQuery()));
            byte[] response = "ok".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, response.length);
            try (var stream = exchange.getResponseBody()) {
                stream.write(response);
            }
        });
        server.start();
        try {
            String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
            ExposedHereAdapter here = new ExposedHereAdapter();
            ExposedAmapAdapter amap = new ExposedAmapAdapter(tempDir.resolve("amap.json"));
            assertEquals("ok", here.fetch(baseUrl + "/here").getText());
            assertEquals("ok", amap.fetch(baseUrl + "/amap").getText());
            assertEquals(1, ports.size());
            assertTrue(queries.get("/here").contains("apiKey=fixture-key"));
            assertEquals("null", queries.get("/amap"));
            assertThrows(RateLimitExecutor.QuotaExhaustedException.class, () -> here.fetch(baseUrl + "/here"));
            assertThrows(RateLimitExecutor.QuotaExhaustedException.class, () -> amap.fetch(baseUrl + "/amap"));
            assertEquals(2, calls.get(), "Neither provider may bypass its existing quota executor");
        } finally {
            singleton.set(null, previous);
            server.stop(0);
            serverExecutor.shutdownNow();
        }
    }

    private static class ExposedHereAdapter extends HereAdapter {
        ExposedHereAdapter() {
            super("fixture-key", 100, 1, 86400, 5, false);
        }

        HttpResponsePayload fetch(String url) throws Exception {
            return get(url);
        }
    }

    private static class ExposedAmapAdapter extends AmapAdapter {
        ExposedAmapAdapter(Path configFile) {
            super(true, "fixture-key", 100, 1, 86400, 5, configFile.toString(),
                    GeocodeProvider.AMAP, "http://example.invalid", false);
        }

        HttpResponsePayload fetch(String url) throws Exception {
            return requestDirection(url);
        }
    }
}
