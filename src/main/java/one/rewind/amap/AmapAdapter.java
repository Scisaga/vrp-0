package one.rewind.amap;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.quarkus.arc.Arc;
import io.quarkus.arc.InstanceHandle;
import io.quarkus.runtime.annotations.RegisterForReflection;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import one.rewind.xforce.json.OM;
import one.rewind.xforce.http.HttpRequester;
import one.rewind.xforce.http.HttpResponsePayload;
import one.rewind.xforce.geo.LOC;
import one.rewind.xforce.geo.POI;
import one.rewind.xforce.geo.Route;
import one.rewind.xforce.geo.RouteSource;
import one.rewind.xforce.geo.RoutingFailure;
import one.rewind.xforce.geo.transit.Transit;
import one.rewind.xforce.geo.transit.TransitCalculator;
import one.rewind.xforce.geo.map.MapAdapter;
import one.rewind.xforce.geo.map.MapProvider;
import one.rewind.xforce.vehicle_routing.domain.agent.Agent;
import org.apache.commons.lang3.StringUtils;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.net.URLEncoder;
import java.util.*;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeoutException;

/**
 * AmapAdapter
 * 主要功能
 * - 支持多实例
 * - 地址查询
 * - 算路
 * 参考
 * - <a href="https://juejin.cn/post/7135727998716051469">如何批量生成虚拟快递地址？</a>
 * - <a href="https://lbs.amap.com/api/webservice/download">Web服务 API 相关下载</a>
 */
@ApplicationScoped
public class AmapAdapter implements MapAdapter {

    public final static Logger logger = Logger.getLogger(AmapAdapter.class);
    public static final String DISABLED_MESSAGE =
            "AMap is disabled. Configure a real amap.app-key and set amap.enabled=true before using AMap-backed features.";
    static final String DEFAULT_ADDRESS_RESOLVER_URL = "http://127.0.0.1:5000/api/resolve";
    private static final GeocodeProvider DEFAULT_GEOCODE_PROVIDER = GeocodeProvider.AMAP;

    private static AmapAdapter inst;

    /**
     * 接口重试次数
     */
    private static final int AMAP_INTERFACE_RETRY_COUNT = 3;
    private static final String AMAP_V4_TRUCK_ENDPOINT = "v4/direction/truck";
    private static final String AMAP_V5_DRIVING_ENDPOINT = "v5/direction/driving";
    private static final String AMAP_V5_BICYCLING_ENDPOINT = "v5/direction/bicycling";
    private static final String AMAP_V5_ELECTROBIKE_ENDPOINT = "v5/direction/electrobike";

    /**
     * 获取实例
     * @return 实例
     */
    public static AmapAdapter get() {

        if(inst != null) return inst;

        synchronized (AmapAdapter.class) {

            try {
                InstanceHandle<AmapAdapter> handle = Arc.container().instance(AmapAdapter.class);

                if (handle.isAvailable()) {
                    inst = handle.get();
                }
                else throw new IOException("Handle is not available");
            }
            catch (Throwable t) {

                logger.info("Inject Env not ready");
                inst = new AmapAdapter(
                        false,
                        "change-me",
                        10,
                        10000,
                        86400,
                        10,
                        "data/amap-config.json",
                        DEFAULT_GEOCODE_PROVIDER,
                        DEFAULT_ADDRESS_RESOLVER_URL,
                        false
                );
            }
        }

        return inst;
    }

    @Override
    public MapProvider provider() {
        return MapProvider.AMAP;
    }

    String app_key;

    boolean enabled;

    int qps;

    long quota;

    private Duration interval;

    private Duration waitTimeout;

    private GeocodeProvider geocodeProvider;

    private String addressResolverUrl;

    private boolean addressResolverFallbackToAmap;

    private final Path configFilePath;

    // 限流对象封装
    RateLimitExecutor<HttpResponsePayload> rle;

    TransitCalculator tc;

    /**
     * 构造方法
     */
    @Inject
    public AmapAdapter(
            @ConfigProperty(name = "amap.enabled", defaultValue = "false") boolean enabled,
            @ConfigProperty(name = "amap.app-key", defaultValue = "xxx") String app_key,
            @ConfigProperty(name = "amap.qps", defaultValue = "100") int qps,
            @ConfigProperty(name = "amap.quota", defaultValue = "10000") long quota,
            @ConfigProperty(name = "amap.interval", defaultValue = "86400") long interval,
            @ConfigProperty(name = "amap.wait-timeout", defaultValue = "10") long waitTimeout,
            @ConfigProperty(name = "amap.config-file", defaultValue = "data/amap-config.json") String configFile,
            @ConfigProperty(name = "amap.geocode-provider", defaultValue = "AMAP") GeocodeProvider geocodeProvider,
            @ConfigProperty(name = "amap.address-resolver-url", defaultValue = DEFAULT_ADDRESS_RESOLVER_URL) String addressResolverUrl,
            @ConfigProperty(name = "amap.address-resolver-fallback-to-amap", defaultValue = "false") boolean addressResolverFallbackToAmap
    ) {
        this.enabled = enabled;

        this.configFilePath = Path.of(configFile);

        Conf persistedConf = loadPersistedConf();
        if (persistedConf != null) {
            applyConf(persistedConf);
        } else {
            applyConf(new Conf(
                    app_key,
                    qps,
                    quota,
                    Duration.ofSeconds(interval),
                    Duration.ofSeconds(waitTimeout),
                    geocodeProvider,
                    addressResolverUrl,
                    addressResolverFallbackToAmap
            ));
        }

        inst = this;
        this.tc = new TransitCalculator();
    }

    @Override
    public boolean isEnabled() {
        return enabled && hasUsableKey();
    }

    @Override
    public void requireEnabled() {
        if (!isEnabled()) {
            throw new AmapDisabledException(DISABLED_MESSAGE);
        }
    }

    private boolean hasUsableKey() {
        return StringUtils.isNotBlank(app_key)
                && !"change-me".equalsIgnoreCase(app_key)
                && !"xxx".equalsIgnoreCase(app_key);
    }

    private synchronized void applyConf(Conf conf) {
        Conf normalized = normalizeConf(conf);
        this.app_key = normalized.key();
        this.qps = normalized.qps();
        this.quota = normalized.quota();
        this.interval = normalized.interval();
        this.waitTimeout = normalized.waitTimeout();
        this.geocodeProvider = normalized.geocodeProvider();
        this.addressResolverUrl = normalized.addressResolverUrl();
        this.addressResolverFallbackToAmap = normalized.addressResolverFallbackToAmap();
        rle = new RateLimitExecutor<>(
                AmapAdapter.class.getSimpleName(),
                this.qps,
                this.quota,
                this.interval ,
                this.waitTimeout
        );
    }

    private Conf normalizeConf(Conf conf) {
        return new Conf(
                conf.key(),
                conf.qps(),
                conf.quota(),
                conf.interval(),
                conf.waitTimeout(),
                conf.geocodeProvider() == null ? DEFAULT_GEOCODE_PROVIDER : conf.geocodeProvider(),
                StringUtils.defaultIfBlank(conf.addressResolverUrl(), DEFAULT_ADDRESS_RESOLVER_URL),
                conf.addressResolverFallbackToAmap()
        );
    }

    /**
     * 根据关键词搜索地点
     * @param city 城市
     * @param addr 关键词
     * @return POI对象
     * @throws IOException 返回格式问题
     * @throws RateLimitExecutor.QuotaExhaustedException 超限额
     * @throws ExecutionException 请求超时相关
     * @throws InterruptedException 请求超时相关
     * @throws TimeoutException 请求超时相关
     */
    @Override
    public POI query(String city, String addr) throws IOException, RateLimitExecutor.QuotaExhaustedException, ExecutionException, InterruptedException, TimeoutException {
        if (usesAddressResolver()) {
            return geocode(addr, city).stream().findFirst().orElse(POI.NoWhere);
        }
        return AddressUtil.guessBestPOI(city, addr, this::getSuggestion);
    }

    /**
     *
     * @param city
     * @param addr
     * @return
     * @throws IOException
     * @throws RateLimitExecutor.QuotaExhaustedException
     * @throws ExecutionException
     * @throws InterruptedException
     * @throws TimeoutException
     */
    public List<POI> getSuggestion(String city, String addr) throws IOException, RateLimitExecutor.QuotaExhaustedException, ExecutionException, InterruptedException, TimeoutException {
        return fetchPOI(addr, "", city, 20, 1);
    }

    /**
     * 根据关键词搜索地点
     * @param city 城市
     * @param type 地点类型
     * @param addr 关键词
     * @return POI对象
     * @throws IOException 返回格式问题
     * @throws RateLimitExecutor.QuotaExhaustedException 超限额
     * @throws ExecutionException 请求超时相关
     * @throws InterruptedException 请求超时相关
     * @throws TimeoutException 请求超时相关
     */
    @Override
    public POI query(String city, String type, String addr) throws IOException, RateLimitExecutor.QuotaExhaustedException, ExecutionException, InterruptedException, TimeoutException {
        if (usesAddressResolver()) {
            return geocode(addr, city).stream().findFirst().orElse(POI.NoWhere);
        }
        return fetchPOI(addr, type, city, 20, 1).stream().findFirst().orElse(POI.NoWhere);
    }

    /**
     * 搜索POI方法封装
     * <a href="https://lbs.amap.com/api/webservice/guide/api/search#text">Amap LBS 搜索API 文档</a>
     *
     * @param keywords 关键词
     * @param types POI类型
     * @param city 城市中文、citycode、adcode，如：北京/010/110000
     * @param offset 偏移量
     * @param page 页码
     */
    @Override
    public List<POI> fetchPOI(String keywords, String types, String city, int offset, int page) throws IOException, RateLimitExecutor.QuotaExhaustedException, ExecutionException, InterruptedException, TimeoutException {
        requireEnabled();

        List<POI> list = new LinkedList<>();

        // 只保留字母、数字、汉字、下划线和短横线
        keywords = keywords.replaceAll("[^\\w\\u4e00-\\u9fa5-]", "");

        String url = "https://restapi.amap.com/v3/place/text?" +
                "key=" + app_key +
                "&keywords=" + keywords +
                "&types=" + types +
                "&city=" + city +
                "&offset=" + offset +
                "&page=" + page +
                "&extensions=all";

        HttpResponsePayload r = rle.exec(() -> new HttpRequester().req(url).orElseThrow(IOException::new));

        ObjectMapper mapper = new ObjectMapper();

        for(JsonNode poiNode : mapper.readTree(r.rBody).get("pois")) {
            processJSON(poiNode).ifPresent(list::add);
        }

        return list;
    }

    /**
     * POI JSON 解析
     * @param poiNode JSON数据
     * @return Optional封装POI对象
     */
    private Optional<POI> processJSON(JsonNode poiNode) {

        String poiStr = poiNode.toString()
                // 照片没有title，替换成默认
                .replaceAll("\"title\":\\[]", "\"title\":\"默认\"")
                // 没有入口地址，替换成null
                .replaceAll("\"entr_location\":\\[]", "\"entr_location\":null");

        // 没有详细地址不采用
        if(poiStr.contains("\"address\":[]")) {
            // return Optional.empty();
            poiStr = poiStr.replaceAll("\"address\":\\[]", "\"address\":\"\"");
        }
        // 极少数地址，高德地图会返回大量空信息，但是地址能查询到，且有坐标。示例地址：天津滨海湾紫宸澜苑1幢
        // 以下字段为空时，高德地图会返回 [] 导致序列化失败，并需要手动添加 id 信息，原始 id 为 null
        boolean isBaseAddress = false;
        if(poiStr.contains("\"type\":[]")) {
            isBaseAddress = true;
            poiStr = poiStr.replaceAll("\"type\":\\[]", "\"type\":\"\"")
                    .replaceAll("\"typecode\":\\[]", "\"typecode\":\"\"")
                    .replaceAll("\"pcode\":\\[]", "\"pcode\":\"\"")
                    .replaceAll("\"pname\":\\[]", "\"pname\":\"\"")
                    .replaceAll("\"citycode\":\\[]", "\"citycode\":\"\"")
                    .replaceAll("\"cityname\":\\[]", "\"cityname\":\"\"")
                    .replaceAll("\"adcode\":\\[]", "\"adcode\":\"\"")
                    .replaceAll("\"adname\":\\[]", "\"adname\":\"\"")
                    .replaceAll("\"gridcode\":\\[]", "\"gridcode\":\"\"")
                    .replaceAll("\"entr_location\":\\[]", "\"entr_location\":[]");
        }

        POI poi;
        try {
            poi = OM.fromJson(poiStr, POI.class);
        } catch (JsonProcessingException e) {
            throw new RuntimeException("Error parse POI JSON", e);
        }

        if (isBaseAddress && poi.id == null) {
            poi.id = String.valueOf(poi.name.hashCode());
        }

        if(StringUtils.isEmpty(poi.address)) {
            poi.address = poi.cityname + poi.adname + poi.name;
        }

        return Optional.of(poi);
    }

    /**
     * 导航获取在途路线（结合载具属性）
     * @param agent 工程师/载具对象
     * @param ori 起始位置
     * @param des 到达位置
     * @return 在途路线
     */
    @Override
    public Route routing(Agent agent, POI ori, POI des) {

        return switch (agent.getVehicleType()) {
            case Agent.VehicleType.TRUCK    -> truckroute(agent, ori.location, des.location, ori.id, des.id);
            case Agent.VehicleType.E_BIKE   -> /*electrobike(ori.location, des.location)*/bicycle(ori.location, des.location); // FIX 暂时用骑行路径规划替代电动车路径规划（key 没有电动车路径规划的使用权限）
            default                         -> driving(ori.location, des.location, ori.id, des.id);
        };
    }

    /**
     * 导航获取在途路线（默认驾车）
     * @param ori 出发 POI
     * @param des 到达 POI
     * @return 在途路线
     */
    @Override
    public Route routing(POI ori, POI des) {
        return driving(ori.location, des.location, ori.id, des.id);
    }

    /**
     *
     * @param ori
     * @param des
     * @return
     */
    public Route driving(String ori, String des) {
        return driving(ori, des, "", "");
    }

    /**
     * <a href="https://lbs.amap.com/api/webservice/guide/api/newroute#t4">驾车路线规划</a>
     *
     * @param ori "116.421616,39.764968"
     * @param des "115.959201,40.433845"
     * @param ori_poi_id "B0GU4LU3Z3"
     * @param des_poi_id "B0JAF7F70H"
     * @return 在途路线
     */
    public Route driving(String ori, String des, String ori_poi_id, String des_poi_id) {
        // 如果起始点与目标点相同，则直接返回
        if (ori.equals(des)) {
            return zeroRoute(ori, des);
        }
        requireEnabled();

        RouteAttempt attempt = requestV5DrivingRoute(ori, des, ori_poi_id, des_poi_id);
        return attempt.route != null
                ? attempt.route
                : estimatedRoute(ori, des, List.of(attempt.failure));
    }

    private static Route zeroRoute(String ori, String des) {
        // 目标点与出发点为相同点，直接返回 0 距离 0 时间花费的 Route
        String ori_str[] = ori.split(",");
        String destination_str[] = des.split(",");
        LOC origin = new LOC(Double.parseDouble(ori_str[0]), Double.parseDouble(ori_str[1]));
        LOC destination = new LOC(Double.parseDouble(destination_str[0]), Double.parseDouble(destination_str[1]));
        Route route = new Route(origin, destination, null, Transit.ZERO, 0);
        route.routeSource = RouteSource.ZERO_DISTANCE;
        return route;
    }

    private Route estimatedRoute(String ori, String des, Collection<RoutingFailure> failures) {
        // 返回距离时间估算值。无 poyline 过路点位，无 tolls 通行费 数据
        String ori_str[] = ori.split(",");
        String destination_str[] = des.split(",");
        LOC origin = new LOC(Double.parseDouble(ori_str[0]), Double.parseDouble(ori_str[1]));
        LOC destination = new LOC(Double.parseDouble(destination_str[0]), Double.parseDouble(destination_str[1]));
        Transit t = tc.calc(origin, destination);
        Route route = new Route(origin, destination, null, t, 0L);
        route.routeSource = RouteSource.ESTIMATED;
        addFailures(route, failures);
        return route;
    }

    /**
     * <a href="https://lbs.amap.com/api/webservice/guide/api/newroute#t7">电动车路径规划</a>
     *
     * @param ori "116.421616,39.764968"
     * @param des "115.959201,40.433845"
     * @return 在途路线
     */
    public Route electrobike(String ori, String des) {

        // 如果起始点与目标点相同，则直接返回
        if (ori.equals(des)) {
            return zeroRoute(ori, des);
        }
        requireEnabled();

        String url = "https://restapi.amap.com/v5/direction/electrobike?" +
                "key=" + app_key +
                "&origin=" + ori +
                "&destination=" + des +
                "&show_fields=cost,polyline";

        RouteAttempt attempt = requestV5Route(
                ori, des, url, AMAP_V5_ELECTROBIKE_ENDPOINT, "E_BIKE", RouteSource.AMAP_BICYCLE,
                this::parseV5SimpleRoute
        );
        return attempt.route != null
                ? attempt.route
                : estimatedRoute(ori, des, List.of(attempt.failure));
    }

    /**
     * <a href="https://lbs.amap.com/api/webservice/guide/api/newroute#t6">骑行路径规划</a>
     *
     * @param ori "116.421616,39.764968"
     * @param des "115.959201,40.433845"
     * @return 在途路线
     */
    public Route bicycle(String ori, String des) {

        // 如果起始点与目标点相同，则直接返回
        if (ori.equals(des)) {
            return zeroRoute(ori, des);
        }
        requireEnabled();

        String url = "https://restapi.amap.com/v5/direction/bicycling?" +
                "key=" + app_key +
                "&origin=" + ori +
                "&destination=" + des +
                "&show_fields=cost,polyline";

        RouteAttempt attempt = requestV5Route(
                ori, des, url, AMAP_V5_BICYCLING_ENDPOINT, "E_BIKE", RouteSource.AMAP_BICYCLE,
                this::parseV5SimpleRoute
        );
        return attempt.route != null
                ? attempt.route
                : estimatedRoute(ori, des, List.of(attempt.failure));
    }

    /**
     * <a href="https://developer.amap.com/api/logistic-service/guide/wagon_path/truck-route-plan-basisnewroute">
     *     调用高德货车路径规划接口
     * </a>
     *
     * @param ori "116.421616,39.764968"
     * @param des "115.959201,40.433845"
     * @param ori_poi_id "B0GU4LU3Z3"
     * @param des_poi_id "B0JAF7F70H"
     * @return 在途距离时间
     */
    public Route truckroute(Agent agent, String ori, String des, String ori_poi_id, String des_poi_id) {

        // 如果起始点与目标点相同，则直接返回
        if (ori.equals(des)) {
            return zeroRoute(ori, des);
        }
        requireEnabled();

        // V4 货车规划优先；失败后降级至普通驾车，以保留可视道路轨迹。
        String url = "https://restapi.amap.com/v4/direction/truck?" +
                "key=" + app_key +
                "&origin=" + ori +
                "&destination=" + des +
                "&originid=" + ori_poi_id +
                "&destinationid=" + des_poi_id +
                "&showpolyline=1" +
                "&nosteps=0" +
                "&size=" + agent.getSize() + //1 微型车 2 轻型车 3中型车 4重型车
                "&height=" + agent.getHeight() +
                "&width=" + agent.getWidth() +
                "&weight=" + agent.getWeight() +
                "&strategy=3"; // 1 避免拥堵 2 不走高速 3 避免收费 11 高德推荐

        RouteAttempt truckAttempt = requestRoute(
                ori, des, url, AMAP_V4_TRUCK_ENDPOINT, "TRUCK", RouteSource.AMAP_TRUCK,
                DirectionApi.V4_TRUCK, this::parseV4TruckRoute
        );
        if (truckAttempt.route != null) {
            return truckAttempt.route;
        }

        RouteAttempt drivingAttempt = requestV5DrivingRoute(ori, des, ori_poi_id, des_poi_id);
        if (drivingAttempt.route != null) {
            drivingAttempt.route.routeSource = RouteSource.CAR_FALLBACK;
            addFailures(drivingAttempt.route, List.of(truckAttempt.failure));
            return drivingAttempt.route;
        }

        return estimatedRoute(ori, des, List.of(truckAttempt.failure, drivingAttempt.failure));
    }

    private RouteAttempt requestV5DrivingRoute(String ori, String des, String oriPoiId, String desPoiId) {
        String url = "https://restapi.amap.com/v5/direction/driving?" +
                "key=" + app_key +
                "&origin=" + ori +
                "&destination=" + des +
                "&origin_id=" + oriPoiId +
                "&destination_id=" + desPoiId +
                "&show_fields=cost,polyline" +
                "&strategy=32"; // 0 速度有限 32 高德默认 35 不走高速 36 少收费

        return requestRoute(
                ori, des, url, AMAP_V5_DRIVING_ENDPOINT, "CAR", RouteSource.AMAP_DRIVING,
                DirectionApi.V5, this::parseV5DrivingRoute
        );
    }

    private RouteAttempt requestV5Route(
            String ori,
            String des,
            String url,
            String endpoint,
            String vehicleType,
            RouteSource source,
            RouteResponseParser parser
    ) {
        return requestRoute(ori, des, url, endpoint, vehicleType, source, DirectionApi.V5, parser);
    }

    private RouteAttempt requestRoute(
            String ori,
            String des,
            String url,
            String endpoint,
            String vehicleType,
            RouteSource source,
            DirectionApi api,
            RouteResponseParser parser
    ) {
        RoutingFailure lastFailure = null;
        for (int attempt = 1; attempt <= AMAP_INTERFACE_RETRY_COUNT; attempt++) {
            try {
                JsonNode bodyJson = new ObjectMapper().readTree(requestDirection(url).rBody);
                RoutingFailure responseFailure = responseFailure(bodyJson, api, vehicleType, endpoint);
                if (responseFailure != null) {
                    lastFailure = responseFailure;
                    logRoutingFailure(responseFailure);
                    if (!isRetryable(responseFailure) || attempt == AMAP_INTERFACE_RETRY_COUNT) {
                        return RouteAttempt.failed(responseFailure);
                    }
                    pauseBeforeRetry(responseFailure);
                    continue;
                }

                Route route = parser.parse(bodyJson);
                route.routeSource = source;
                return RouteAttempt.succeeded(route);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return RouteAttempt.failed(requestFailure(vehicleType, endpoint, "REQUEST_INTERRUPTED", "路径服务请求被中断"));
            } catch (Throwable t) {
                lastFailure = requestFailure(vehicleType, endpoint, "REQUEST_FAILED", "路径服务请求或响应解析失败");
                logger.warnf("AMap route request failed: vehicle_type=%s endpoint=%s attempt=%d", vehicleType, endpoint, attempt);
                if (attempt == AMAP_INTERFACE_RETRY_COUNT) {
                    return RouteAttempt.failed(lastFailure);
                }
            }
        }
        return RouteAttempt.failed(lastFailure == null
                ? requestFailure(vehicleType, endpoint, "REQUEST_FAILED", "路径服务请求失败")
                : lastFailure);
    }

    /**
     * Isolated for fixture-backed routing tests. Do not log the URL because it contains the AMap key.
     */
    protected HttpResponsePayload requestDirection(String url) throws Exception {
        return rle.exec(() -> new HttpRequester().req(url).orElseThrow(IOException::new));
    }

    private RoutingFailure responseFailure(JsonNode bodyJson, DirectionApi api, String vehicleType, String endpoint) {
        if (api == DirectionApi.V4_TRUCK) {
            String code = bodyJson.path("errcode").asText("");
            if (!code.isBlank() && !"0".equals(code)) {
                return requestFailure(vehicleType, endpoint, code, bodyJson.path("errmsg").asText("AMap 货车路径服务失败"));
            }
            if (!bodyJson.path("data").path("route").isObject()) {
                return requestFailure(vehicleType, endpoint, "INVALID_RESPONSE", "AMap 货车路径服务返回无效响应");
            }
            return null;
        }

        if ("0".equals(bodyJson.path("status").asText())) {
            return requestFailure(
                    vehicleType,
                    endpoint,
                    bodyJson.path("infocode").asText("AMAP_ROUTE_ERROR"),
                    bodyJson.path("info").asText("AMap 路径服务失败")
            );
        }
        if (!bodyJson.path("route").isObject()) {
            return requestFailure(vehicleType, endpoint, "INVALID_RESPONSE", "AMap 路径服务返回无效响应");
        }
        return null;
    }

    private boolean isRetryable(RoutingFailure failure) {
        return "10021".equals(failure.code)
                || "REQUEST_FAILED".equals(failure.code)
                || "INVALID_RESPONSE".equals(failure.code);
    }

    private void pauseBeforeRetry(RoutingFailure failure) throws InterruptedException {
        if ("10021".equals(failure.code)) {
            Thread.sleep(50);
        }
    }

    private Route parseV4TruckRoute(JsonNode bodyJson) {
        JsonNode routeNode = bodyJson.path("data").path("route");
        JsonNode pathNode = firstPath(routeNode);
        return buildRoute(
                routeNode,
                pathNode,
                requiredLong(pathNode.path("distance"), "distance"),
                requiredLong(pathNode.path("duration"), "duration"),
                optionalTolls(pathNode.path("tolls"))
        );
    }

    private Route parseV5DrivingRoute(JsonNode bodyJson) {
        JsonNode routeNode = bodyJson.path("route");
        JsonNode pathNode = firstPath(routeNode);
        JsonNode cost = pathNode.path("cost");
        return buildRoute(
                routeNode,
                pathNode,
                requiredLong(pathNode.path("distance"), "distance"),
                requiredLong(cost.path("duration"), "cost.duration"),
                optionalTolls(cost.path("tolls"))
        );
    }

    private Route parseV5SimpleRoute(JsonNode bodyJson) {
        JsonNode routeNode = bodyJson.path("route");
        JsonNode pathNode = firstPath(routeNode);
        return buildRoute(
                routeNode,
                pathNode,
                requiredLong(pathNode.path("distance"), "distance"),
                requiredLong(pathNode.path("duration"), "duration"),
                0L
        );
    }

    private Route buildRoute(JsonNode routeNode, JsonNode pathNode, long distance, long duration, long tolls) {
        LOC origin = parseLocation(routeNode.path("origin").asText(), "origin");
        LOC destination = parseLocation(routeNode.path("destination").asText(), "destination");
        List<LOC> polyline = parsePolyline(pathNode.path("steps"));
        if (polyline.size() < 2) {
            throw new IllegalArgumentException("AMap route response does not contain a usable polyline");
        }
        return new Route(origin, destination, polyline, new Transit(distance, duration), tolls);
    }

    private JsonNode firstPath(JsonNode routeNode) {
        JsonNode paths = routeNode.path("paths");
        if (!paths.isArray() || paths.isEmpty()) {
            throw new IllegalArgumentException("AMap route response does not contain a path");
        }
        return paths.get(0);
    }

    private List<LOC> parsePolyline(JsonNode steps) {
        if (!steps.isArray()) {
            throw new IllegalArgumentException("AMap route response does not contain steps");
        }
        List<LOC> polyline = new LinkedList<>();
        steps.forEach(step -> {
            String encodedPolyline = step.path("polyline").asText("");
            if (encodedPolyline.isBlank()) {
                return;
            }
            for (String point : encodedPolyline.split(";")) {
                polyline.add(parseLocation(point, "polyline"));
            }
        });
        return polyline;
    }

    private LOC parseLocation(String value, String field) {
        String[] coordinates = value.split(",");
        if (coordinates.length != 2) {
            throw new IllegalArgumentException("Invalid AMap " + field + " coordinate");
        }
        return new LOC(Double.parseDouble(coordinates[0]), Double.parseDouble(coordinates[1]));
    }

    private long requiredLong(JsonNode value, String field) {
        String text = value.asText("");
        if (text.isBlank()) {
            throw new IllegalArgumentException("AMap route response does not contain " + field);
        }
        return Long.parseLong(text);
    }

    private long optionalTolls(JsonNode value) {
        String text = value.asText("");
        return text.isBlank() ? 0L : Math.round(Double.parseDouble(text));
    }

    private RoutingFailure requestFailure(String vehicleType, String endpoint, String code, String message) {
        return new RoutingFailure(vehicleType, endpoint, code, sanitizeFailureMessage(message));
    }

    private String sanitizeFailureMessage(String message) {
        String sanitized = StringUtils.defaultIfBlank(message, "AMap 路径服务失败").trim();
        return sanitized.length() <= 256 ? sanitized : sanitized.substring(0, 256);
    }

    private void addFailures(Route route, Collection<RoutingFailure> failures) {
        if (route.routingFailures == null) {
            route.routingFailures = new LinkedList<>();
        }
        failures.stream().filter(Objects::nonNull).forEach(route.routingFailures::add);
    }

    private void logRoutingFailure(RoutingFailure failure) {
        logger.warnf(
                "AMap route failed: vehicle_type=%s endpoint=%s code=%s message=%s",
                failure.vehicleType, failure.endpoint, failure.code, failure.message
        );
    }

    private enum DirectionApi {
        V4_TRUCK,
        V5
    }

    @FunctionalInterface
    private interface RouteResponseParser {
        Route parse(JsonNode bodyJson);
    }

    private static final class RouteAttempt {
        private final Route route;
        private final RoutingFailure failure;

        private RouteAttempt(Route route, RoutingFailure failure) {
            this.route = route;
            this.failure = failure;
        }

        private static RouteAttempt succeeded(Route route) {
            return new RouteAttempt(route, null);
        }

        private static RouteAttempt failed(RoutingFailure failure) {
            return new RouteAttempt(null, failure);
        }
    }

    /**
     *
     * @param address 地址
     * @param city 城市
     * @return 候选POI列表
     * @throws IOException HTTP请求失败
     */
    @Deprecated
    public List<POI> geo(String address, String city) throws IOException, RateLimitExecutor.QuotaExhaustedException, ExecutionException, InterruptedException, TimeoutException {
        requireEnabled();

        List<POI> list = new LinkedList<>();

        String url = "https://restapi.amap.com/v3/geocode/geo?" +
                "key=" + app_key +
                "&address=" + address +
                "&city=" + city;

        HttpResponsePayload r = rle.exec(() -> new HttpRequester().req(url).orElseThrow(IOException::new));

        ObjectMapper mapper = new ObjectMapper();

        for(JsonNode poiNode : mapper.readTree(r.rBody).get("geocodes")) {
            processJSON(poiNode).ifPresent(list::add);
        }

        return list;
    }

    @Override
    public List<POI> geocode(String address, String city) throws IOException, RateLimitExecutor.QuotaExhaustedException, ExecutionException, InterruptedException, TimeoutException {
        if (usesAddressResolver()) {
            try {
                return addressResolverGeocode(address, city);
            } catch (IOException e) {
                if (!addressResolverFallbackToAmap) {
                    throw e;
                }
                logger.warnf(e, "Address resolver geocode failed, fallback to AMap for address: %s", address);
                return amapGeocode(address, city);
            }
        }
        return amapGeocode(address, city);
    }

    List<POI> amapGeocode(String address, String city) throws IOException, RateLimitExecutor.QuotaExhaustedException, ExecutionException, InterruptedException, TimeoutException {
        requireEnabled();

        List<POI> list = new LinkedList<>();

        String url = "https://restapi.amap.com/v3/geocode/geo?" +
                "key=" + app_key +
                "&address=" + address +
                "&city=" + city;

        HttpResponsePayload r = rle.exec(() -> new HttpRequester().req(url).orElseThrow(IOException::new));

        ObjectMapper mapper = new ObjectMapper();
        JsonNode geocodes = mapper.readTree(r.rBody).get("geocodes");
        if (geocodes == null || !geocodes.isArray()) {
            return list;
        }

        for (JsonNode node : geocodes) {
            String location = readText(node.get("location"));
            if (StringUtils.isBlank(location)) {
                continue;
            }

            POI poi = new POI();
            poi.name = readText(node.get("formatted_address"));
            poi.address = poi.name;
            poi.location = location;
            poi.id = stableGeocodePoiId(location, poi.address);
            poi.cityname = readText(node.get("city"));
            poi.pname = readText(node.get("province"));
            poi.adname = readText(node.get("district"));
            poi.adcode = readText(node.get("adcode"));
            poi.citycode = readText(node.get("citycode"));
            poi.type = "GEOCODE";

            if (StringUtils.isBlank(poi.cityname)) {
                poi.cityname = poi.pname;
            }

            list.add(poi);
        }

        return list;
    }

    List<POI> addressResolverGeocode(String address, String city) throws IOException {
        String keyword = StringUtils.trimToEmpty(address);
        if (keyword.isEmpty()) {
            return List.of();
        }

        String connector = addressResolverUrl.contains("?") ? "&" : "?";
        String url = addressResolverUrl + connector + "addr=" + URLEncoder.encode(keyword, StandardCharsets.UTF_8);

        HttpResponsePayload response = new HttpRequester().req(url).orElseThrow(() ->
                new IOException("Address resolver request failed")
        );
        if (response.statusCode < 200 || response.statusCode >= 300) {
            throw new IOException("Address resolver request failed with status " + response.statusCode);
        }

        JsonNode root;
        try {
            root = new ObjectMapper().readTree(response.rBody);
        } catch (Exception e) {
            throw new IOException("Address resolver returned invalid JSON", e);
        }

        POI poi = mapAddressResolverPoi(root, city, keyword);
        return poi == POI.NoWhere ? List.of() : List.of(poi);
    }

    static POI mapAddressResolverPoi(JsonNode root, String city, String fallbackAddress) throws IOException {
        if (root == null || root.isNull() || !root.isObject()) {
            throw new IOException("Address resolver returned empty response");
        }

        String location = readText(root.get("location"));
        if (!isValidLocation(location)) {
            throw new IOException("Address resolver returned invalid location");
        }

        JsonNode regeo = root.get("regeo");
        String province = readText(regeo == null ? null : regeo.get("province"));
        String resolvedCity = readText(regeo == null ? null : regeo.get("city"));
        String district = readText(regeo == null ? null : regeo.get("district"));

        POI poi = new POI();
        poi.id = StringUtils.defaultIfBlank(readText(root.get("id")), "resolver_" + fallbackAddress.hashCode());
        poi.name = StringUtils.defaultIfBlank(readText(root.get("name")), fallbackAddress);
        poi.address = StringUtils.defaultIfBlank(readText(root.get("address")), fallbackAddress);
        poi.location = location;
        poi.entr_location = location;
        poi.cityname = StringUtils.defaultIfBlank(resolvedCity, StringUtils.defaultIfBlank(city, province));
        poi.pname = province;
        poi.adname = district;
        poi.type = "ADDR_RESOLVER";
        return poi;
    }

    private boolean usesAddressResolver() {
        return geocodeProvider == GeocodeProvider.ADDR_RESOLVER;
    }

    private static boolean isValidLocation(String location) {
        if (StringUtils.isBlank(location)) {
            return false;
        }
        String[] parts = location.split(",");
        if (parts.length != 2) {
            return false;
        }
        try {
            Double.parseDouble(parts[0].trim());
            Double.parseDouble(parts[1].trim());
            return true;
        } catch (NumberFormatException e) {
            return false;
        }
    }

    private static String readText(JsonNode node) {
        if (node == null || node.isNull()) {
            return "";
        }
        if (node.isArray()) {
            return node.size() > 0 ? readText(node.get(0)) : "";
        }
        return node.asText("");
    }

    /**
     * AMap 地理编码响应只给出行政区 adcode，不能作为 POI 主键。
     * 用坐标与格式化地址生成稳定键，避免同一 adcode 下不同地址被矩阵合并。
     */
    static String stableGeocodePoiId(String location, String formattedAddress) {
        String seed = "amap-geocode|" + StringUtils.defaultString(location) + "|" + StringUtils.defaultString(formattedAddress);
        return "geo_" + UUID.nameUUIDFromBytes(seed.getBytes(StandardCharsets.UTF_8));
    }

    static String sanitizeReverseGeocodeAddress(String address) {
        if (StringUtils.isBlank(address)) {
            return address;
        }

        String[] segments = address.split(",", -1);
        int start = 0;
        while (start < segments.length) {
            String segment = segments[start].trim();
            if (!segment.isEmpty() && !"null".equalsIgnoreCase(segment)) {
                break;
            }
            start++;
        }

        if (start == 0 || start >= segments.length) {
            return address;
        }

        String sanitized = String.join(",", Arrays.copyOfRange(segments, start, segments.length)).trim();
        return StringUtils.isBlank(sanitized) ? address : sanitized;
    }

    /**
     *
     * @param location
     * @return
     * @throws IOException
     * @throws RateLimitExecutor.QuotaExhaustedException
     * @throws ExecutionException
     * @throws InterruptedException
     * @throws TimeoutException
     */
    @Override
    public POI regeo(String location) throws IOException, RateLimitExecutor.QuotaExhaustedException, ExecutionException, InterruptedException, TimeoutException {
        requireEnabled();

        TreeMap<Double, POI> map = new TreeMap<>();

        String url = "https://restapi.amap.com/v3/geocode/regeo?" +
                "key=" + app_key +
                "&extensions=all" +
                "&location=" + location;

        HttpResponsePayload r = rle.exec(() -> new HttpRequester().req(url).orElseThrow(IOException::new));

        ObjectMapper mapper = new ObjectMapper();
        JsonNode root = mapper.readTree(r.rBody);
        JsonNode regeocode = root.get("regeocode");
        if (regeocode == null || regeocode.isNull()) {
            return POI.NoWhere;
        }

        String formattedAddress = sanitizeReverseGeocodeAddress(readText(regeocode.get("formatted_address")));
        JsonNode addressComponent = regeocode.get("addressComponent");
        String city = readText(addressComponent == null ? null : addressComponent.get("city"));
        String province = readText(addressComponent == null ? null : addressComponent.get("province"));
        String district = readText(addressComponent == null ? null : addressComponent.get("district"));
        String normalizedCity = StringUtils.isBlank(city) ? province : city;

        JsonNode pois = regeocode.get("pois");
        if (pois != null && pois.isArray()) {
            for(JsonNode poiNode : pois) {

                processJSON(poiNode).ifPresent(poi -> {
                    if (StringUtils.isBlank(poi.address)) {
                        poi.address = formattedAddress;
                    }
                    if (StringUtils.isBlank(poi.cityname)) {
                        poi.cityname = normalizedCity;
                    }
                    if (StringUtils.isBlank(poi.pname)) {
                        poi.pname = province;
                    }
                    if (StringUtils.isBlank(poi.adname)) {
                        poi.adname = district;
                    }
                    if (StringUtils.isBlank(poi.location)) {
                        poi.location = location;
                    }
                    if (StringUtils.isBlank(poi.entr_location)) {
                        poi.entr_location = poi.location;
                    }

                    double distance = Double.parseDouble(poiNode.get("distance").asText());
                    map.put(distance, poi);
                });
            }
        }

        if (!map.isEmpty()) {
            return map.firstEntry().getValue();
        }

        POI poi = new POI();
        poi.id = "regeo_" + location.replace(",", "_");
        poi.name = formattedAddress;
        poi.address = formattedAddress;
        poi.location = location;
        poi.entr_location = location;
        poi.cityname = normalizedCity;
        poi.pname = province;
        poi.adname = district;
        poi.type = "REGEOCODE";
        return poi;
    }

    /**
     *
     * @param key
     * @param qps
     * @param quota
     * @param interval
     * @param waitTimeout
     */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @RegisterForReflection(serialization = true)
    public record Conf(
            String key,
            int qps,
            long quota,
            Duration interval,
            Duration waitTimeout,
            GeocodeProvider geocodeProvider,
            String addressResolverUrl,
            boolean addressResolverFallbackToAmap
    ) {}

    @RegisterForReflection(serialization = true)
    public enum GeocodeProvider {
        AMAP,
        ADDR_RESOLVER
    }

    public synchronized Conf getConf() {
        return new Conf(
                app_key,
                qps,
                quota,
                interval,
                waitTimeout,
                geocodeProvider,
                addressResolverUrl,
                addressResolverFallbackToAmap
        );
    }

    public synchronized Conf updateConf(Conf conf) {
        validateConf(conf);
        Conf normalized = normalizeConf(conf);
        applyConf(normalized);
        persistConf(normalized);
        return getConf();
    }

    private void validateConf(Conf conf) {
        if (conf == null) {
            throw new IllegalArgumentException("Amap config should not be null");
        }
        if (conf.key() == null || conf.key().isBlank()) {
            throw new IllegalArgumentException("Amap key should not be blank");
        }
        if (conf.qps() <= 0) {
            throw new IllegalArgumentException("Amap qps should be greater than 0");
        }
        if (conf.quota() <= 0) {
            throw new IllegalArgumentException("Amap quota should be greater than 0");
        }
        if (conf.interval() == null || conf.interval().isZero() || conf.interval().isNegative()) {
            throw new IllegalArgumentException("Amap interval should be greater than 0");
        }
        if (conf.waitTimeout() == null || conf.waitTimeout().isZero() || conf.waitTimeout().isNegative()) {
            throw new IllegalArgumentException("Amap wait timeout should be greater than 0");
        }
        if (conf.geocodeProvider() == null) {
            throw new IllegalArgumentException("Geocode provider should not be null");
        }
        if (StringUtils.isBlank(conf.addressResolverUrl())) {
            throw new IllegalArgumentException("Address resolver url should not be blank");
        }
    }

    private Conf loadPersistedConf() {
        if (!Files.exists(configFilePath)) {
            return null;
        }
        try {
            return OM.fromJson(Files.readString(configFilePath, StandardCharsets.UTF_8), Conf.class);
        } catch (Exception e) {
            logger.warnf(e, "Failed to load persisted amap config from %s", configFilePath);
            return null;
        }
    }

    private void persistConf(Conf conf) {
        try {
            Path parent = configFilePath.getParent();
            if (parent != null) {
                Files.createDirectories(parent);
            }
            Files.writeString(configFilePath, OM.toJson(conf), StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new RuntimeException("Failed to persist amap config", e);
        }
    }

    public static class AmapDisabledException extends IllegalStateException {
        public AmapDisabledException(String message) {
            super(message);
        }
    }
}
