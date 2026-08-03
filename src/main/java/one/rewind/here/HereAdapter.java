package one.rewind.here;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.quarkus.runtime.annotations.RegisterForReflection;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import one.rewind.amap.RateLimitExecutor;
import one.rewind.xforce.geo.LOC;
import one.rewind.xforce.geo.POI;
import one.rewind.xforce.geo.Route;
import one.rewind.xforce.geo.RouteSource;
import one.rewind.xforce.geo.RoutingFailure;
import one.rewind.xforce.geo.map.MapAdapter;
import one.rewind.xforce.geo.map.MapProvider;
import one.rewind.xforce.geo.transit.Transit;
import one.rewind.xforce.geo.transit.TransitCalculator;
import one.rewind.xforce.geo.transit.TransitMatrix;
import one.rewind.xforce.http.HttpRequester;
import one.rewind.xforce.http.HttpResponsePayload;
import one.rewind.xforce.vehicle_routing.domain.agent.Agent;
import org.apache.commons.lang3.StringUtils;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeoutException;

/** HERE Search, Geocoding, Routing and Matrix Routing implementation. */
@ApplicationScoped
public class HereAdapter implements MapAdapter {

    public static final String DISABLED_MESSAGE =
            "HERE is unavailable. Configure a real here.api-key before using HERE-backed features.";
    private static final Logger LOGGER = Logger.getLogger(HereAdapter.class);
    private static final String SEARCH_ENDPOINT = "https://discover.search.hereapi.com/v1/discover";
    private static final String GEOCODE_ENDPOINT = "https://geocode.search.hereapi.com/v1/geocode";
    private static final String REVERSE_GEOCODE_ENDPOINT = "https://revgeocode.search.hereapi.com/v1/revgeocode";
    private static final String ROUTING_ENDPOINT = "https://router.hereapi.com/v8/routes";
    private static final String MATRIX_ENDPOINT = "https://matrix.router.hereapi.com/v8/matrix";
    private static final int ROUTING_RETRY_COUNT = 3;
    private static final int MATRIX_BATCH_SIZE = 50;

    private final String apiKey;
    private final boolean matrixRoutingEnabled;
    private final Duration waitTimeout;
    private final RateLimitExecutor<HttpResponsePayload> rateLimitExecutor;
    private final ObjectMapper mapper = new ObjectMapper();
    private final TransitCalculator transitCalculator = new TransitCalculator();

    @Inject
    public HereAdapter(
            @ConfigProperty(name = "here.api-key", defaultValue = "change-me") String apiKey,
            @ConfigProperty(name = "here.qps", defaultValue = "10") int qps,
            @ConfigProperty(name = "here.quota", defaultValue = "10000") long quota,
            @ConfigProperty(name = "here.interval", defaultValue = "86400") long intervalSeconds,
            @ConfigProperty(name = "here.wait-timeout", defaultValue = "10") long waitTimeoutSeconds,
            @ConfigProperty(name = "here.matrix-routing-enabled", defaultValue = "false") boolean matrixRoutingEnabled
    ) {
        this.apiKey = apiKey;
        this.matrixRoutingEnabled = matrixRoutingEnabled;
        this.waitTimeout = Duration.ofSeconds(waitTimeoutSeconds);
        this.rateLimitExecutor = new RateLimitExecutor<>(
                HereAdapter.class.getSimpleName(), qps, quota,
                Duration.ofSeconds(intervalSeconds), this.waitTimeout
        );
    }

    @Override
    public MapProvider provider() {
        return MapProvider.HERE;
    }

    @Override
    public boolean isEnabled() {
        return StringUtils.isNotBlank(apiKey)
                && !"change-me".equalsIgnoreCase(apiKey)
                && !"xxx".equalsIgnoreCase(apiKey)
                && !"your-here-key".equalsIgnoreCase(apiKey);
    }

    @Override
    public void requireEnabled() {
        if (!isEnabled()) {
            throw new HereDisabledException(DISABLED_MESSAGE);
        }
    }

    public boolean isMatrixRoutingEnabled() {
        return matrixRoutingEnabled;
    }

    /** Used only for browser map context; never log this value. */
    public String browserKey() {
        return apiKey;
    }

    @Override
    public POI query(String city, String address) throws IOException, RateLimitExecutor.QuotaExhaustedException,
            ExecutionException, InterruptedException, TimeoutException {
        return fetchPOI(address, "", city, 1, 1).stream().findFirst().orElse(POI.NoWhere);
    }

    @Override
    public POI query(String city, String type, String address) throws IOException, RateLimitExecutor.QuotaExhaustedException,
            ExecutionException, InterruptedException, TimeoutException {
        return fetchPOI(address, type, city, 1, 1).stream().findFirst().orElse(POI.NoWhere);
    }

    @Override
    public List<POI> fetchPOI(String keywords, String types, String city, int offset, int page)
            throws IOException, RateLimitExecutor.QuotaExhaustedException, ExecutionException,
            InterruptedException, TimeoutException {
        requireEnabled();
        String query = String.join(" ", List.of(StringUtils.defaultString(keywords), StringUtils.defaultString(types), StringUtils.defaultString(city)))
                .trim();
        if (query.isEmpty()) {
            return List.of();
        }
        int limit = Math.max(1, Math.min(offset, 100));
        Coordinate center = discoverCenter(city);
        JsonNode root = readJson(get(SEARCH_ENDPOINT + "?q=" + encode(query)
                + "&at=" + center.latitude + ',' + center.longitude + "&limit=" + limit));
        return mapItems(root.path("items"), "HERE_DISCOVER");
    }

    @Override
    public List<POI> geocode(String address, String city) throws IOException, RateLimitExecutor.QuotaExhaustedException,
            ExecutionException, InterruptedException, TimeoutException {
        requireEnabled();
        String query = String.join(" ", List.of(StringUtils.defaultString(address), StringUtils.defaultString(city))).trim();
        if (query.isEmpty()) {
            return List.of();
        }
        JsonNode root = readJson(get(GEOCODE_ENDPOINT + "?q=" + encode(query) + "&limit=20"));
        return mapItems(root.path("items"), "HERE_GEOCODE");
    }

    @Override
    public POI regeo(String location) throws IOException, RateLimitExecutor.QuotaExhaustedException,
            ExecutionException, InterruptedException, TimeoutException {
        requireEnabled();
        Coordinate coordinate = Coordinate.fromLocation(location);
        JsonNode root = readJson(get(REVERSE_GEOCODE_ENDPOINT + "?at=" + coordinate.latitude + "," + coordinate.longitude + "&limit=1"));
        return mapItems(root.path("items"), "HERE_REVERSE_GEOCODE").stream().findFirst().orElse(POI.NoWhere);
    }

    @Override
    public Route routing(POI origin, POI destination) {
        return routingInternal(null, origin, destination);
    }

    @Override
    public Route routing(Agent agent, POI origin, POI destination) {
        return routingInternal(agent, origin, destination);
    }

    private Route routingInternal(Agent agent, POI origin, POI destination) {
        Coordinate from = Coordinate.fromPoi(origin);
        Coordinate to = Coordinate.fromPoi(destination);
        if (from.equals(to)) {
            return zeroRoute(from, to);
        }
        requireEnabled();
        String vehicleType = agent == null || agent.getVehicleType() == null ? "CAR" : agent.getVehicleType().name();
        String transportMode = agent != null && agent.getVehicleType() == Agent.VehicleType.TRUCK ? "truck"
                : agent != null && agent.getVehicleType() == Agent.VehicleType.E_BIKE ? "bicycle" : "car";
        StringBuilder url = new StringBuilder(ROUTING_ENDPOINT)
                .append("?transportMode=").append(transportMode)
                .append("&origin=").append(from.latitude).append(',').append(from.longitude)
                .append("&destination=").append(to.latitude).append(',').append(to.longitude)
                .append("&departureTime=any&traffic%5Bmode%5D=disabled&return=summary,polyline");
        addTruckParameters(url, agent, transportMode);

        RoutingFailure lastFailure = null;
        for (int attempt = 1; attempt <= ROUTING_RETRY_COUNT; attempt++) {
            try {
                HttpResponsePayload response = get(url.toString());
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    lastFailure = failure(vehicleType, "v8/routes", "HTTP_" + response.statusCode, "HERE routing request failed");
                    if (retryable(response.statusCode) && attempt < ROUTING_RETRY_COUNT) {
                        Thread.sleep(100L * attempt);
                        continue;
                    }
                    break;
                }
                Route route = parseRoute(readJson(response), from, to);
                route.routeSource = routeSource(transportMode);
                return route;
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                lastFailure = failure(vehicleType, "v8/routes", "REQUEST_INTERRUPTED", "HERE routing request interrupted");
                break;
            } catch (Throwable e) {
                lastFailure = failure(vehicleType, "v8/routes", "REQUEST_FAILED", "HERE routing request or response parsing failed");
                if (attempt < ROUTING_RETRY_COUNT) {
                    continue;
                }
            }
        }
        LOGGER.warnf("HERE route failed: vehicle_type=%s code=%s", vehicleType,
                lastFailure == null ? "REQUEST_FAILED" : lastFailure.code);
        return estimatedRoute(from, to, lastFailure == null
                ? failure(vehicleType, "v8/routes", "REQUEST_FAILED", "HERE routing request failed") : lastFailure);
    }

    /** Builds a complete matrix with synchronous requests first and async polling if HERE returns a job. */
    public TransitMatrix matrixRouting(List<POI> pois) {
        return matrixRouting(pois, pois);
    }

    /** Matrix entry point also used by small rectangular integration probes (for example 1x3 and 2x3). */
    public TransitMatrix matrixRouting(List<POI> originPois, List<POI> destinationPois) {
        requireEnabled();
        TransitMatrix matrix = new TransitMatrix();
        List<POI> originsAll = new ArrayList<>(new LinkedHashSet<>(originPois));
        List<POI> destinationsAll = new ArrayList<>(new LinkedHashSet<>(destinationPois));
        for (int originStart = 0; originStart < originsAll.size(); originStart += MATRIX_BATCH_SIZE) {
            List<POI> origins = originsAll.subList(originStart, Math.min(originStart + MATRIX_BATCH_SIZE, originsAll.size()));
            for (int destinationStart = 0; destinationStart < destinationsAll.size(); destinationStart += MATRIX_BATCH_SIZE) {
                List<POI> destinations = destinationsAll.subList(destinationStart, Math.min(destinationStart + MATRIX_BATCH_SIZE, destinationsAll.size()));
                mergeMatrixBatch(matrix, origins, destinations, requestMatrix(origins, destinations));
            }
        }
        return matrix;
    }

    private JsonNode requestMatrix(List<POI> origins, List<POI> destinations) {
        try {
            byte[] body = mapper.writeValueAsBytes(matrixRequest(origins, destinations));
            for (int attempt = 1; attempt <= ROUTING_RETRY_COUNT; attempt++) {
                HttpResponsePayload response = post(MATRIX_ENDPOINT + "?async=false", body);
                if (response.statusCode == 200) {
                    return readJson(response);
                }
                if (response.statusCode == 202) {
                    return awaitMatrix(readJson(response));
                }
                // HERE applies tighter size limits to async=false. Retry the same valid body as an async job.
                if ((response.statusCode == 400 || response.statusCode == 413) && attempt == 1) {
                    HttpResponsePayload asyncResponse = post(MATRIX_ENDPOINT, body);
                    if (asyncResponse.statusCode == 200) {
                        return readJson(asyncResponse);
                    }
                    if (asyncResponse.statusCode == 202) {
                        return awaitMatrix(readJson(asyncResponse));
                    }
                    throw new IllegalStateException("HERE async matrix request failed with HTTP " + asyncResponse.statusCode);
                }
                if (retryable(response.statusCode) && attempt < ROUTING_RETRY_COUNT) {
                    Thread.sleep(100L * attempt);
                    continue;
                }
                throw new IllegalStateException("HERE matrix request failed with HTTP " + response.statusCode);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("HERE matrix request interrupted", e);
        } catch (Exception e) {
            throw new IllegalStateException("HERE matrix request failed", e);
        }
        throw new IllegalStateException("HERE matrix request failed after retry");
    }

    private Map<String, Object> matrixRequest(List<POI> origins, List<POI> destinations) {
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("origins", matrixPoints(origins));
        request.put("destinations", matrixPoints(destinations));
        request.put("regionDefinition", Map.of("type", "autoCircle"));
        request.put("transportMode", "car");
        request.put("departureTime", "any");
        request.put("matrixAttributes", List.of("travelTimes", "distances"));
        return request;
    }

    private List<Map<String, Double>> matrixPoints(Collection<POI> pois) {
        List<Map<String, Double>> points = new ArrayList<>();
        for (POI poi : pois) {
            Coordinate coordinate = Coordinate.fromPoi(poi);
            points.add(Map.of("lat", coordinate.latitude, "lng", coordinate.longitude));
        }
        return points;
    }

    private JsonNode awaitMatrix(JsonNode submitted) throws Exception {
        String statusUrl = submitted.path("statusUrl").asText("");
        if (statusUrl.isBlank()) {
            throw new IllegalStateException("HERE matrix async response has no statusUrl");
        }
        long deadline = System.nanoTime() + waitTimeout.toNanos();
        while (System.nanoTime() < deadline) {
            Thread.sleep(250);
            HttpResponsePayload statusResponse = get(withApiKey(statusUrl));
            if (statusResponse.statusCode == 303) {
                String resultUrl = statusResponse.firstHeader("Location");
                if (resultUrl.isBlank()) {
                    throw new IllegalStateException("HERE matrix async response has no result location");
                }
                return readMatrixResult(resultUrl);
            }
            JsonNode status = readJson(statusResponse);
            String value = status.path("status").asText("").toLowerCase(Locale.ROOT);
            if ("completed".equals(value)) {
                String resultUrl = status.path("resultUrl").asText("");
                return resultUrl.isBlank() ? status : readMatrixResult(resultUrl);
            }
            if ("failed".equals(value) || "cancelled".equals(value)) {
                throw new IllegalStateException("HERE matrix async calculation " + value);
            }
        }
        throw new TimeoutException("HERE matrix async calculation timed out");
    }

    private JsonNode readMatrixResult(String resultUrl) throws Exception {
        HttpResponsePayload result = get(withApiKey(resultUrl));
        if (result.statusCode == 303) {
            String location = result.firstHeader("Location");
            if (location.isBlank()) {
                throw new IllegalStateException("HERE matrix result redirect has no location");
            }
            result = getWithoutApiKey(location);
        }
        if (result.statusCode < 200 || result.statusCode >= 300) {
            throw new IllegalStateException("HERE matrix result failed with HTTP " + result.statusCode);
        }
        return readJson(result);
    }

    private void mergeMatrixBatch(TransitMatrix target, List<POI> origins, List<POI> destinations, JsonNode root) {
        JsonNode matrix = root.path("matrix");
        int numOrigins = matrix.path("numOrigins").asInt(-1);
        int numDestinations = matrix.path("numDestinations").asInt(-1);
        if (numOrigins != origins.size() || numDestinations != destinations.size()) {
            throw new IllegalArgumentException("HERE matrix dimensions do not match request");
        }
        JsonNode distances = matrix.path("distances");
        JsonNode travelTimes = matrix.path("travelTimes");
        JsonNode errors = matrix.path("errorCodes");
        int expected = numOrigins * numDestinations;
        if (!distances.isArray() || !travelTimes.isArray() || distances.size() != expected || travelTimes.size() != expected) {
            throw new IllegalArgumentException("HERE matrix response is incomplete");
        }
        for (int originIndex = 0; originIndex < numOrigins; originIndex++) {
            for (int destinationIndex = 0; destinationIndex < numDestinations; destinationIndex++) {
                int index = originIndex * numDestinations + destinationIndex;
                POI origin = origins.get(originIndex);
                POI destination = destinations.get(destinationIndex);
                boolean failed = errors.isArray() && errors.size() > index && errors.get(index).asInt(0) != 0;
                target.put(origin.id, destination.id, origin.id.equals(destination.id) ? Transit.ZERO
                        : failed ? Transit.MAX : new Transit(distances.get(index).asLong(), travelTimes.get(index).asLong()));
            }
        }
    }

    protected HttpResponsePayload get(String url) throws RateLimitExecutor.QuotaExhaustedException,
            InterruptedException, ExecutionException, TimeoutException, IOException {
        return rateLimitExecutor.exec(() -> new HttpRequester().req(withApiKey(url)).orElseThrow(IOException::new));
    }

    protected HttpResponsePayload post(String url, byte[] body) throws RateLimitExecutor.QuotaExhaustedException,
            InterruptedException, ExecutionException, TimeoutException, IOException {
        return rateLimitExecutor.exec(() -> new HttpRequester().req(withApiKey(url), "POST",
                Map.of("Content-Type", "application/json", "Accept", "application/json"), body).orElseThrow(IOException::new));
    }

    /** Follows a signed object-storage matrix result URL without leaking the HERE API key to that origin. */
    protected HttpResponsePayload getWithoutApiKey(String url) throws RateLimitExecutor.QuotaExhaustedException,
            InterruptedException, ExecutionException, TimeoutException, IOException {
        return rateLimitExecutor.exec(() -> new HttpRequester().req(url).orElseThrow(IOException::new));
    }

    private String withApiKey(String url) {
        if (url.contains("apiKey=")) {
            return url;
        }
        return url + (url.contains("?") ? "&" : "?") + "apiKey=" + encode(apiKey);
    }

    private JsonNode readJson(HttpResponsePayload response) throws IOException {
        return mapper.readTree(response.rBody);
    }

    private List<POI> mapItems(JsonNode items, String type) {
        if (!items.isArray()) {
            return List.of();
        }
        List<POI> result = new ArrayList<>();
        for (JsonNode item : items) {
            JsonNode position = item.path("position");
            if (!position.has("lat") || !position.has("lng")) {
                continue;
            }
            double latitude = position.path("lat").asDouble();
            double longitude = position.path("lng").asDouble();
            JsonNode address = item.path("address");
            String label = text(address, "label");
            POI poi = new POI();
            poi.id = StringUtils.defaultIfBlank(text(item, "id"), stableId(type, longitude, latitude, label));
            poi.name = StringUtils.defaultIfBlank(text(item, "title"), label);
            poi.address = StringUtils.defaultIfBlank(label, poi.name);
            poi.location = longitude + "," + latitude;
            poi.entr_location = poi.location;
            poi.loc = new LOC(longitude, latitude);
            poi.entr_loc = new LOC(longitude, latitude);
            poi.cityname = text(address, "city");
            poi.adname = text(address, "district");
            poi.pname = text(address, "state");
            poi.adcode = text(address, "postalCode");
            poi.citycode = text(address, "countyCode");
            poi.type = type;
            result.add(poi);
        }
        return result;
    }

    /** HERE Discover requires an {@code at}, {@code in=circle}, or {@code in=bbox} search context. */
    private Coordinate discoverCenter(String city) throws IOException, RateLimitExecutor.QuotaExhaustedException,
            ExecutionException, InterruptedException, TimeoutException {
        if (StringUtils.isBlank(city)) {
            // A valid neutral context keeps free-text discover usable when the caller has no city hint.
            return new Coordinate(0, 0);
        }
        JsonNode root = readJson(get(GEOCODE_ENDPOINT + "?q=" + encode(city) + "&limit=1"));
        JsonNode position = root.path("items").path(0).path("position");
        if (position.has("lat") && position.has("lng")) {
            return new Coordinate(position.path("lng").asDouble(), position.path("lat").asDouble());
        }
        return new Coordinate(0, 0);
    }

    private Route parseRoute(JsonNode root, Coordinate origin, Coordinate destination) {
        JsonNode routes = root.path("routes");
        if (!routes.isArray() || routes.isEmpty()) {
            throw new IllegalArgumentException("HERE route response does not contain a route");
        }
        JsonNode sections = routes.get(0).path("sections");
        if (!sections.isArray() || sections.isEmpty()) {
            throw new IllegalArgumentException("HERE route response does not contain sections");
        }
        long distance = 0;
        long duration = 0;
        List<LOC> polyline = new ArrayList<>();
        for (JsonNode section : sections) {
            JsonNode summary = section.path("summary");
            if (!summary.has("length") || !summary.has("duration")) {
                throw new IllegalArgumentException("HERE route section does not contain summary");
            }
            distance += summary.path("length").asLong();
            duration += summary.path("duration").asLong();
            polyline.addAll(FlexiblePolyline.decode(section.path("polyline").asText("")));
        }
        if (polyline.size() < 2) {
            throw new IllegalArgumentException("HERE route response does not contain usable polyline");
        }
        return new Route(origin.toLoc(), destination.toLoc(), polyline, new Transit(distance, duration), 0L);
    }

    private Route zeroRoute(Coordinate origin, Coordinate destination) {
        Route route = new Route(origin.toLoc(), destination.toLoc(), null, Transit.ZERO, 0L);
        route.routeSource = RouteSource.ZERO_DISTANCE;
        return route;
    }

    private Route estimatedRoute(Coordinate origin, Coordinate destination, RoutingFailure routingFailure) {
        Route route = new Route(origin.toLoc(), destination.toLoc(), null,
                transitCalculator.calc(origin.toLoc(), destination.toLoc()), 0L);
        route.routeSource = RouteSource.ESTIMATED;
        route.routingFailures.add(routingFailure);
        return route;
    }

    private void addTruckParameters(StringBuilder url, Agent agent, String transportMode) {
        if (!"truck".equals(transportMode) || agent == null) {
            return;
        }
        if (agent.getHeight() > 0) {
            url.append("&vehicle%5Bheight%5D=").append(Math.round(agent.getHeight() * 100));
        }
        if (agent.getWidth() > 0) {
            url.append("&vehicle%5Bwidth%5D=").append(Math.round(agent.getWidth() * 100));
        }
        if (agent.getWeight() > 0) {
            url.append("&vehicle%5BgrossWeight%5D=").append(Math.round(agent.getWeight() * 1000));
        }
    }

    private RouteSource routeSource(String transportMode) {
        return switch (transportMode) {
            case "truck" -> RouteSource.HERE_TRUCK;
            case "bicycle" -> RouteSource.HERE_BICYCLE;
            default -> RouteSource.HERE_DRIVING;
        };
    }

    private static boolean retryable(int status) {
        return status == 429 || status >= 500;
    }

    private static RoutingFailure failure(String vehicleType, String endpoint, String code, String message) {
        return new RoutingFailure(vehicleType, endpoint, code, message);
    }

    private static String text(JsonNode node, String field) {
        return node == null ? "" : node.path(field).asText("");
    }

    private static String stableId(String type, double longitude, double latitude, String label) {
        return "here_" + UUID.nameUUIDFromBytes((type + '|' + longitude + '|' + latitude + '|' + label)
                .getBytes(StandardCharsets.UTF_8));
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    @RegisterForReflection(serialization = true)
    public static class HereDisabledException extends IllegalStateException {
        public HereDisabledException(String message) {
            super(message);
        }
    }

    private record Coordinate(double longitude, double latitude) {
        static Coordinate fromPoi(POI poi) {
            if (poi == null) {
                throw new IllegalArgumentException("HERE route point is null");
            }
            return fromLocation(poi.location, poi.loc);
        }

        static Coordinate fromLocation(String value) {
            return fromLocation(value, null);
        }

        static Coordinate fromLocation(String value, LOC fallback) {
            if (StringUtils.isNotBlank(value)) {
                String[] values = value.split(",");
                if (values.length == 2) {
                    try {
                        return new Coordinate(Double.parseDouble(values[0].trim()), Double.parseDouble(values[1].trim()));
                    } catch (NumberFormatException ignored) {
                        // continue to fallback
                    }
                }
            }
            if (fallback != null) {
                return new Coordinate(fallback.lat, fallback.lon);
            }
            throw new IllegalArgumentException("Invalid HERE coordinate, expected lng,lat");
        }

        LOC toLoc() {
            return new LOC(longitude, latitude);
        }
    }
}
