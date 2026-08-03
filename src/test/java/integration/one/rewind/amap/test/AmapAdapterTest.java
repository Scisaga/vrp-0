package one.rewind.amap.test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeoutException;

import org.apache.commons.lang3.tuple.Pair;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;
import static org.junit.jupiter.api.Assertions.assertEquals;
import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.core.JsonProcessingException;

import one.rewind.amap.AmapAdapter;
import one.rewind.amap.RateLimitExecutor;
import one.rewind.xforce.geo.LOC;
import one.rewind.xforce.geo.POI;
import one.rewind.xforce.geo.Route;
import one.rewind.xforce.geo.RouteDrawer;
import one.rewind.xforce.geo.distance.ManhattanDistanceCalculator;
import one.rewind.xforce.geo.transit.Transit;
import one.rewind.xforce.geo.transit.TransitCalculator;
import one.rewind.xforce.http.HttpRequester;
import one.rewind.xforce.http.HttpResponsePayload;
import one.rewind.xforce.json.OM;

@Tag("external")
public class AmapAdapterTest {

    @BeforeAll
    static void requireExternalTestsEnabled() {
        one.rewind.xforce.test.support.ExternalTestSupport.requireExternalTestsEnabled();
    }

    List<String> adcodes = List.of(
        "110101", //东城区
        "110102", // 西城区
        "110105", // 朝阳区
        "110106", // 丰台区
        "110107", // 石景山区
        "110108", // 海淀区
        "110109", // 门头沟区
        "110111", // 房山区
        "110112", // 通州区
        "110113", // 顺义区
        "110114", // 昌平区
        "110115", // 大兴区
        "110116", // 怀柔区
        "110117", // 平谷区
        "110118", // 密云区
        "110119" // 延庆区
    );


    @Test
    public void testFetch0() throws IOException, JsonProcessingException, RateLimitExecutor.QuotaExhaustedException, ExecutionException, InterruptedException, TimeoutException {

        List<POI> pois = AmapAdapter.get()
                .fetchPOI("小区", "120000", "110101", 20, 1);

        pois.forEach(poi -> System.out.println(toJson(poi)));
    }

    /**
     * 批量采样获取北京小区地址
     * @throws IOException
     */
    @Test
    public void testFetch1a() throws IOException, JsonProcessingException, RateLimitExecutor.QuotaExhaustedException, ExecutionException, InterruptedException, TimeoutException {

        List<POI> pois = new LinkedList<>();

        for(String adcode : adcodes) {
            for(int page=1; page<5; page++) {
                pois.addAll(AmapAdapter.get()
                        .fetchPOI("小区", "120000", adcode, 20, page));

                /*Files.write(Path.of("data/pois" + adcode + page + ".json"), OM.toJson(pois).getBytes(StandardCharsets.UTF_8));*/
            }
        }

        Path target = Path.of("data/public-demo/pois_ticket.json");
        Path parent = target.getParent();
        if (parent != null) {
            Files.createDirectories(parent);
        }
        Files.write(target, OM.toJson(pois).getBytes(StandardCharsets.UTF_8));
    }

    /**
     * 获取维修站点
     * @throws IOException
     */
    @Test
    public void testFetch1b() throws IOException, JsonProcessingException, RateLimitExecutor.QuotaExhaustedException, ExecutionException, InterruptedException, TimeoutException {

        List<POI> pois = new LinkedList<>();

        for(String adcode : adcodes) {
            for(int page=1; page<3; page++) {
                pois.addAll(AmapAdapter.get()
                        .fetchPOI("", "071200", adcode, 20, page));

                /*Files.write(Path.of("data/pois" + adcode + page + ".json"), OM.toJson(pois).getBytes(StandardCharsets.UTF_8));*/
            }
        }

        Path target = Path.of("data/public-demo/pois_agent_inst.json");
        Path parent = target.getParent();
        if (parent != null) {
            Files.createDirectories(parent);
        }
        Files.write(target, OM.toJson(pois).getBytes(StandardCharsets.UTF_8));
    }

    @Test
    public void testFetch2() throws IOException, JsonProcessingException, RateLimitExecutor.QuotaExhaustedException, ExecutionException, InterruptedException, TimeoutException {

        List<POI> pois = AmapAdapter.get()
                .fetchPOI("", "071200", "110101", 20, 1);

        pois.forEach(poi -> System.out.println(toJson(poi)));

    }

    @Test
    public void testFetch3() throws IOException, JsonProcessingException, RateLimitExecutor.QuotaExhaustedException, ExecutionException, InterruptedException, TimeoutException {

        List<POI> pois = AmapAdapter.get()
                .fetchPOI("天津市津南区鹭洲湾11-3-1201", "", "120000", 20, 1);

        pois.forEach(poi -> System.out.println(toJson(poi)));
    }

    @Test
    public void testFetch4() {
        String url = "https://www.amap.com/service/poiInfo?query_type=TQUERY&pagesize=20&pagenum=1&qii=true&cluster_state=5&need_utd=true&utd_sceneid=1000&div=PC1000&addr_poi_merge=true&is_classify=true&zoom=17.5&city=120000&geoobj=117.35455%7C38.99585%7C117.36756%7C38.998691&keywords=%E9%94%A6%E7%BB%A3%E5%A4%A7%E5%AE%B634%E5%8F%B7%E6%A5%BC";
        Optional<HttpResponsePayload> req = new HttpRequester().req(url);
        System.out.println(req.get().getText());
    }

    @Test
    public void testGeo() throws IOException, JsonProcessingException, RateLimitExecutor.QuotaExhaustedException, ExecutionException, InterruptedException, TimeoutException {

        List<POI> pois = AmapAdapter.get()
                .geo("天津市津南区锦绣大家34-1-12", "120000");

        pois.forEach(poi -> System.out.println(toJson(poi)));
    }

    @Test
    public void testReGeo() throws IOException, JsonProcessingException, RateLimitExecutor.QuotaExhaustedException, ExecutionException, InterruptedException, TimeoutException {

        POI poi = AmapAdapter.get()
                .regeo("116.421616,39.764968");

        System.out.println(toJson(poi));
    }

    @Test
    public void testConvertLoc() {
        var loc = POI.parseLoc("116.439156,39.949916");
        System.out.println(loc);
    }

    @Test
    public void testDriving() throws IOException {

        String ori = "116.421616,39.764968";
        String des = "115.959201,40.433845";
        String ori_poi_id = "B0GU4LU3Z3";
        String des_poi_id = "B0JAF7F70H";
        Route driving = AmapAdapter.get().driving(ori, des, ori_poi_id, des_poi_id);

        String html = new RouteDrawer(11, List.of(List.of(Pair.of("test", driving)))).generateHtml();
        Path target = Path.of("temp/route_driving.html");
        Path parent = target.getParent();
        if (parent != null) {
            Files.createDirectories(parent);
        }
        Files.write(target, html.getBytes(StandardCharsets.UTF_8));
    }

    @Test
    public void testCalc() {

        LOC l1 = new LOC(116.439156D,39.949916D);
        LOC l2 = new LOC(115.959201D,40.433845D);
        double distance = new ManhattanDistanceCalculator().distance(l1, l2);
        System.out.println(distance);
        Assertions.assertTrue(distance > 103417 && distance < 103417+1);

        TransitCalculator tc = new TransitCalculator();
        Transit r = tc.calc(l1, l2);
        System.out.println(r);
    }

    /**
     * 测试地址搜索功能
     * @throws IOException
     */
    @Test
    public void testQuery() throws IOException, JsonProcessingException, RateLimitExecutor.QuotaExhaustedException, ExecutionException, InterruptedException, TimeoutException {
        String city = "天津市";
        String addr = "123456-11234567890-=";
        POI poi = AmapAdapter.get().query(city, addr);
        System.out.println(toJson(poi));

        city = "北京市";
        addr = "北京市圆明园西路2号动科动医教学楼";
        poi = AmapAdapter.get().query(city, "140000", addr);
        System.out.println(OM.toJson(poi));
    }

    @Test
    public void testPOIEqual() {
        POI p1 = new POI("NoWhere");
        Assertions.assertTrue(p1.isNoWhere());

        POI p2 = new POI("2");
        p2.address = "2";

        POI p3 = new POI("2");
        p3.address = "2";

        System.out.println(p2.hashCode());
        System.out.println(p3.hashCode());

        assertEquals(p2, p3);
    }

    @Test
    public void testQueryWithGuess() throws IOException, JsonProcessingException, RateLimitExecutor.QuotaExhaustedException, ExecutionException, InterruptedException, TimeoutException {

        String[] addresses = { "天津市津南区鹭洲湾11-3-1201",
                "天津市滨海新区滨海湾紫宸澜苑1-2-6011",
                "天津市滨海新区汉沽华远棠悦咏棠轩9-3-3021",
                "天津市蓟州区实地常春藤7-1-3021",
                "天津市东丽区华侨城望涛苑12-11",
                "天津市津南区鹭洲湾9-1-4021",
                "天津市西青区飞霞路与阜锦道交口业之峰装饰二楼马可波罗瓷砖1",
                "天津市津南区鹭洲湾14-2-7021" };

        for(String addr : addresses) {
            var poi = AmapAdapter.get().query("天津市", addr);
            System.out.println(toJson(poi));
        }
    }

    private static String toJson(Object value) {
        try {
            return OM.toJson(value);
        } catch (JsonProcessingException e) {
            throw new RuntimeException(e);
        }
    }
}
