package one.rewind.xforce.vehicle_routing.solver.test;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.google.common.collect.Lists;
import one.rewind.xforce.json.OM;
import one.rewind.xforce.vehicle_routing.bootstrap.GeoUtil;
import one.rewind.xforce.vehicle_routing.db.dto.Scenario;
import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.exception.AgentOrTicketNotCompatible;
import one.rewind.xforce.vehicle_routing.exception.POINoWhereException;
import one.rewind.xforce.vehicle_routing.exception.POINotBuild;
import one.rewind.xforce.vehicle_routing.exception.TransitMatrixNotBuild;
import one.rewind.xforce.vehicle_routing.solver.SolverWrapper;
import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.time.Duration;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;


@Disabled("Manual script: requires explicit local data, external dependency, report generation, or long-running solver flow.")
@Tag("manual")
public class SolverTest {

    @TempDir
    Path outputDir;



    @Test
    public void changeAndContinueSolve() throws IOException, JsonProcessingException, TransitMatrixNotBuild, POINotBuild, AgentOrTicketNotCompatible {
        // 只有1个agent，最大接单量为3
        String json = Files.readString(Path.of("src/test/resources/fixtures/scenarios/scen-2-a.json"), StandardCharsets.UTF_8);
        Scenario scen = OM.fromJson(json, Scenario.class);
        scen.serializeTo(outputDir.toString() + "/");
        scen.addVirtualAgents();

        SolverWrapper solverWrapper = SolverWrapper.build(Duration.ofMinutes(1));

        // 求解
        RoutePlan rp1 = solverWrapper.solve(scen.getPlan().init());

        DateTimeFormatter df = DateTimeFormatter.ofPattern("yyyy-MM-dd-hh-mm-ss");

        rp1.print();
        rp1.serializeTo(outputDir.resolve("scen-2_rp_1.json").toString());

        scen.applyRoutePlan(rp1);
        List<RoutePlan.AvailableAgentWindow> availableAgentsCount = scen.getPlan().getAvailableAgentsCount(scen.getStartTime(), scen.getEndTime(), Duration.ofHours(2));
        System.out.println(availableAgentsCount);

        // 修改参数
        rp1.getAgents().getFirst().setMaxTicketNum(6);

        // 继续求解
        rp1 = solverWrapper.solve(rp1);
        rp1.print();
        rp1.serializeTo(outputDir.resolve("scen-2_rp_2.json").toString());

        scen.applyRoutePlan(rp1);
        availableAgentsCount = scen.getPlan().getAvailableAgentsCount(scen.getStartTime(), scen.getEndTime(), Duration.ofHours(2));
        System.out.println(availableAgentsCount);
    }

    @Test
    public void testPinnedTickets() throws IOException, JsonProcessingException, POINoWhereException, AgentOrTicketNotCompatible {

        SolverWrapper solverWrapper = SolverWrapper.build(Duration.ofMinutes(1));

        // 2
        String json = Files.readString(Path.of("src/test/resources/fixtures/scenarios/scen-3.json"), StandardCharsets.UTF_8);
        Scenario scen = OM.fromJson(json, Scenario.class);

        // 分组
        var subSets = Lists.partition(scen.getPlan().getTickets(), 6);

        // 分配第一组工单
        scen.getPlan().setTickets(subSets.getFirst());
        GeoUtil.buildMatrix(scen.getPlan());

        // 求解
        RoutePlan plan = solverWrapper.solve(scen.getPlan());
        // 设置 original agent，设置工单固定
        plan.getTickets().forEach(t -> t.setOriginalAgent(t.getAgent()));
        plan.getTickets().forEach(t -> t.setPinned(true));
        plan.print();

        // 分配第二组工单
        plan.getTickets().addAll(subSets.getLast());
        GeoUtil.buildMatrix(plan);

        // 求解
        plan = solverWrapper.solve(plan.init());
        plan.print();

    }

    @Test
    public void clearAssignmentsAndSolve() throws JsonProcessingException {

        System.out.println("It's works!");

        // TODO
    }
}
