package one.rewind.amap.test;

import one.rewind.amap.AmapAdapter;
import one.rewind.amap.RateLimitExecutor;
import one.rewind.xforce.geo.POI;
import one.rewind.xforce.geo.Route;
import one.rewind.xforce.geo.RouteDrawer;
import one.rewind.xforce.vehicle_routing.bootstrap.ScenarioUtil;
import one.rewind.xforce.vehicle_routing.domain.agent.Agent;
import org.apache.commons.lang3.tuple.Pair;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeoutException;

@Tag("external")
public class AmapAdapterTruckRoutingTest {

    @BeforeAll
    static void requireExternalTestsEnabled() {
        one.rewind.xforce.test.support.ExternalTestSupport.requireExternalTestsEnabled();
    }

    @Test
    public void testDriving() throws IOException, RateLimitExecutor.QuotaExhaustedException, ExecutionException, InterruptedException, TimeoutException {

        POI startLoc = AmapAdapter.get().regeo("116.421616,39.764968");

        Agent a = ScenarioUtil.get4m2Agent(1, "1", null, startLoc);

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

        Route truckroute = AmapAdapter.get().truckroute(a, ori, des, ori_poi_id, des_poi_id);

        html = new RouteDrawer(11, List.of(List.of(Pair.of("test", truckroute)))).generateHtml();
        target = Path.of("temp/route_truckroute.html");
        parent = target.getParent();
        if (parent != null) {
            Files.createDirectories(parent);
        }
        Files.write(target, html.getBytes(StandardCharsets.UTF_8));
    }
}
