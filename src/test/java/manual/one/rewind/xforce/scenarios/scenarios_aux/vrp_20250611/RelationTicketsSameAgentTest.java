package one.rewind.xforce.scenarios.scenarios_aux.vrp_20250611;

import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import one.rewind.xforce.geo.RouteDrawer;
import one.rewind.xforce.json.OM;
import one.rewind.xforce.vehicle_routing.bootstrap.GeoUtil;
import one.rewind.xforce.vehicle_routing.db.dto.Scenario;
import one.rewind.xforce.vehicle_routing.db.dto.SolverJob;
import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.exception.POINotBuild;
import one.rewind.xforce.vehicle_routing.exception.TransitMatrixNotBuild;
import one.rewind.xforce.vehicle_routing.rest.ScenarioResource;
import one.rewind.xforce.vehicle_routing.rest.SolverJobResource;
import one.rewind.xforce.vehicle_routing.solver.SolverWrapper;
import one.rewind.xforce.vehicle_routing.solver.stat.GanttChartBuilder;
import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;

/**
 * @author Yang Zhongwei
 * @date 2025/5/30
 * @description 同地址工单派发给相同工程师约束测试 RoutePlanConstraintConfiguration.relationTicketsSameAgent
 */
@Disabled("Manual script: requires explicit local data, external dependency, report generation, or long-running solver flow.")
@Tag("manual")
public class RelationTicketsSameAgentTest {

    private String path = "scenarios/scenarios_aux/vrp_20250611/";

    /**
     * 求解
     * - 无历史工单
     * - C工单的关联工单为 D, E, F
     *
     * @throws IOException
     */
    @Test
    public void relationTicketsSameAgentTest() throws Exception {
        String name = "scenario_request.json";
        byte[] bytes = Files.readAllBytes(Path.of(path + name));
        Scenario scen = OM.fromJson(new String(bytes, StandardCharsets.UTF_8), Scenario.class);

        GeoUtil.buildPOI(scen.getPlan());
        GeoUtil.buildMatrix(scen.getPlan());
        scen.getPlan().init();

        for (int i = 0; i < 5; i++) {
            SolverWrapper solverWrapper = SolverWrapper.build(Duration.ofMinutes(1));
            RoutePlan rp1 = solverWrapper.solve(scen.getPlan().init());
            rp1.serializeTo(path + "ticket_rp_" + i + ".json");
        }
    }

    /**
     * 求解
     * - 有历史工单
     * - 历史工单为关联订单，并派发给同一个人
     * - C工单的关联工单为 D, E, F
     *
     * @throws IOException
     */
    @Test
    public void relationTicketsSameAgentTest2() throws Exception {
        String name = "scenario_request_history_ticket_same_agent.json";
        byte[] bytes = Files.readAllBytes(Path.of(path + name));
        Scenario scen = OM.fromJson(new String(bytes, StandardCharsets.UTF_8), Scenario.class);
        GeoUtil.buildPOI(scen.getPlan());
        GeoUtil.buildMatrix(scen.getPlan());
        scen.getPlan().init();

        for (int i = 0; i < 5; i++) {
            SolverWrapper solverWrapper = SolverWrapper.build(Duration.ofMinutes(1));
            RoutePlan rp1 = solverWrapper.solve(scen.getPlan().init());
            rp1.serializeTo(path + "ticket_rp_" + i + ".json");
        }
    }

    /**
     * 求解
     * - 有历史工单
     * - 历史工单为关联订单，并派发给不同的人
     * - C工单的关联工单为 D, E, F
     *
     * @throws IOException
     */
    @Test
    public void relationTicketsSameAgentTest3() throws Exception {
        String name = "scenario_request_history_ticket_not_same_agent.json";
        byte[] bytes = Files.readAllBytes(Path.of(path + name));
        Scenario scen = OM.fromJson(new String(bytes, StandardCharsets.UTF_8), Scenario.class);
        GeoUtil.buildPOI(scen.getPlan());
        GeoUtil.buildMatrix(scen.getPlan());
        scen.getPlan().init();

        for (int i = 0; i < 5; i++) {
            SolverWrapper solverWrapper = SolverWrapper.build(Duration.ofMinutes(1));
            RoutePlan rp1 = solverWrapper.solve(scen.getPlan().init());
            rp1.serializeTo(path + "ticket_rp_" + i + ".json");
        }
    }
}
