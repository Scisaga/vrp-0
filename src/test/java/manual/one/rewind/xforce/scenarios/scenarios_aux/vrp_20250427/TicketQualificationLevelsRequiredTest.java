package one.rewind.xforce.scenarios.scenarios_aux.vrp_20250427;

import one.rewind.xforce.json.OM;
import one.rewind.xforce.vehicle_routing.db.dto.Scenario;
import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.domain.agent.Agent;
import one.rewind.xforce.vehicle_routing.exception.POINoWhereException;
import one.rewind.xforce.vehicle_routing.solver.SolverWrapper;
import one.rewind.xforce.vehicle_routing.solver.stat.GanttChartBuilder;
import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.optaplanner.core.api.score.buildin.hardmediumsoftlong.HardMediumSoftLongScore;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;

/**
 * @author Yang Zhongwei
 * @date 2025/4/27
 * @description
 */
@Disabled("Manual script: requires explicit local data, external dependency, report generation, or long-running solver flow.")
@Tag("manual")
public class TicketQualificationLevelsRequiredTest {

    static String path = "scenarios/scenarios_aux/vrp_20250427/";

    /**
     * 从得分查看 高级工单给到高级工程师 重构后的约束是否实现成功
     *
     * @throws IOException         IO异常
     * @throws POINoWhereException 算路异常
     */
    @Test
    public void testSolve() throws IOException {

        // 1 读取场景和规划方案
        byte[] bytes = Files.readAllBytes(Path.of(path + "TicketQualificationLevelsRequired.json"));
        Scenario scen = OM.fromJson(new String(bytes), Scenario.class);
        RoutePlan rp = scen.getPlan();

        // 先将原始排线进行可视化
        GanttChartBuilder gcb = new GanttChartBuilder("tickets_qualification_levels_required", rp);
        gcb.genChart(path + "agent_plan_origin.png");

        // 预处理
        rp.addVirtualAgents();
        rp.getAgents().forEach(a -> a.setVehicleType(Agent.VehicleType.CAR));
        rp.init();
        rp.getConstraintConfiguration().setMinimizeTicketChanging(HardMediumSoftLongScore.ONE_HARD);

        // 2 创建Solver求解
        var sw = SolverWrapper.build(Duration.ofSeconds(10));
        rp = sw.solve(rp);
        rp.print();
        rp.serializeTo(path + "tickets_qualification_levels_required_rp_1.json");

        // 保存收敛曲线
        sw.genChart(path + "basic_convergence_curve.png");

        // 生成任务分配图
        gcb = new GanttChartBuilder("tickets_qualification_levels_required", rp);
        gcb.genChart(path + "agent_plan.png");
    }
}
