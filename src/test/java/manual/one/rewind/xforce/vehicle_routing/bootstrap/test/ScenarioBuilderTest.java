package one.rewind.xforce.vehicle_routing.bootstrap.test;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import one.rewind.amap.RateLimitExecutor;
import one.rewind.xforce.json.OM;
import one.rewind.xforce.vehicle_routing.bootstrap.GeoUtil;
import one.rewind.xforce.vehicle_routing.bootstrap.ScenarioBuilder;
import one.rewind.xforce.vehicle_routing.db.dto.Scenario;
import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.domain.agent.AgentEachDay;
import one.rewind.xforce.vehicle_routing.exception.POINoWhereException;
import one.rewind.xforce.vehicle_routing.exception.POINotBuild;
import one.rewind.xforce.vehicle_routing.exception.TransitMatrixNotBuild;
import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeoutException;

@Disabled
@Tag("manual")
public class ScenarioBuilderTest {

    @TempDir
    Path outputDir;

    @Test
    public void testBuildAndSerialize() throws POINoWhereException, IOException, RateLimitExecutor.QuotaExhaustedException, ExecutionException, InterruptedException, TimeoutException {

        ScenarioBuilder sb = new ScenarioBuilder(10, 1, 5, 1F, 0);
        sb.build("scen-1", "t10, d1, ad5(1)").serializeTo(outputDir.toString() + "/");
    }

    @Test
    public void testBuildAndSerialize1() throws POINoWhereException, IOException, RateLimitExecutor.QuotaExhaustedException, ExecutionException, InterruptedException, TimeoutException {

        ScenarioBuilder sb = new ScenarioBuilder(10, 1, 5, 1F, 0, false);
        sb.build("scen-2", "t10, d1, ad4(1), no install tickets").serializeTo(outputDir.toString() + "/");
    }

    @Test
    public void testBuildAndSerialize2() throws POINoWhereException, IOException, RateLimitExecutor.QuotaExhaustedException, ExecutionException, InterruptedException, TimeoutException {

        ScenarioBuilder sb = new ScenarioBuilder(12, 1, 6, 1F, 0, false);
        sb.build("scen-3", "t12, d1, ad6(1), no install tickets").serializeTo(outputDir.toString() + "/");
    }

    @Test
    public void testDeserialize() throws IOException, TransitMatrixNotBuild, POINotBuild {
        Scenario scen = OM.fromJson(Files.readString(Path.of("src/test/resources/fixtures/scenarios/scen-2.json"), StandardCharsets.UTF_8), Scenario.class);
    }


    @Test
    public void testDeserializeAndBuildRoutePlan() throws IOException, TransitMatrixNotBuild, POINotBuild {

        Scenario scen = OM.fromJson(Files.readString(Path.of("src/test/resources/fixtures/scenarios/scen-2.json"), StandardCharsets.UTF_8), Scenario.class);
        scen.getPlan().print();
    }

    @Test
    public void testBuildScenarios() throws POINoWhereException, IOException, RateLimitExecutor.QuotaExhaustedException, ExecutionException, InterruptedException, TimeoutException {

        // 1
        ScenarioBuilder sb = new ScenarioBuilder(10, 1, 2, 1F, 0);
        sb.build("scen-b-1", "t10, d1, a2(1)").serializeTo(outputDir.toString() + "/");

        sb = new ScenarioBuilder(10, 1, 5, 1F, 0);
        sb.build("scen-b-2", "t10, d1, a5(1)").serializeTo(outputDir.toString() + "/");

        sb = new ScenarioBuilder(10, 1, 4, 0.5F, 4);
        sb.build("scen-b-3", "t10, d1, a4(0.5)").serializeTo(outputDir.toString() + "/");

        // 2
        sb = new ScenarioBuilder(40, 1, 10, 1F, 0);
        sb.build("scen-b-4", "t40, d1, a10(1)").serializeTo(outputDir.toString() + "/");

        sb = new ScenarioBuilder(40, 1, 20, 1F, 0);
        sb.build("scen-b-5", "t40, d1, a20(1)").serializeTo(outputDir.toString() + "/");

        sb = new ScenarioBuilder(40, 1, 12, 0.5F, 10);
        sb.build("scen-b-6", "t40, d1, a12(0.5)").serializeTo(outputDir.toString() + "/");

        // 3
        sb = new ScenarioBuilder(10, 2, 2, 1F, 0);
        sb.build("scen-b-7", "t10, d2, a2(1)").serializeTo(outputDir.toString() + "/");
    }

    @Test
    public void testIncompleteRoutePlan() throws IOException, RateLimitExecutor.QuotaExhaustedException, ExecutionException, InterruptedException, TimeoutException, POINoWhereException {

        // POI 或者 在途矩阵不完整
        String json = Files.readString(Path.of("src/test/resources/fixtures/scenarios/scen-2-c.json"), StandardCharsets.UTF_8);

        Scenario scen = OM.fromJson(json, Scenario.class);

        GeoUtil.buildPOI(scen.getPlan());
        GeoUtil.buildMatrix(scen.getPlan());

        System.out.println(OM.toJson(scen));
    }
}
