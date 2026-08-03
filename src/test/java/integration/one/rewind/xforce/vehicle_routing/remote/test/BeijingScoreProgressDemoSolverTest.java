package one.rewind.xforce.vehicle_routing.remote.test;

import com.fasterxml.jackson.databind.ObjectMapper;
import one.rewind.xforce.json.OM;
import one.rewind.xforce.geo.transit.TransitMatrix;
import one.rewind.xforce.vehicle_routing.db.dto.Scenario;
import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.domain.agent.AgentEachDay;
import one.rewind.xforce.vehicle_routing.domain.ticket.Ticket;
import one.rewind.xforce.vehicle_routing.service.ScenarioReferenceNormalizer;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.optaplanner.core.api.score.buildin.hardmediumsoftlong.HardMediumSoftLongScore;
import org.optaplanner.core.api.solver.Solver;
import org.optaplanner.core.api.solver.SolverFactory;
import org.optaplanner.core.config.solver.SolverConfig;
import org.optaplanner.core.config.solver.termination.TerminationConfig;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 真实运行演示场景，确认曲线中的 Best 事件来自 Local Search，而不是 UI 补点。
 */
@Tag("external")
class BeijingScoreProgressDemoSolverTest {

    private static final Path DEMO_PATH = Path.of("scenarios/public-demo/beijing-score-progress.json");

    @BeforeAll
    static void requireExternalTestsEnabled() {
        one.rewind.xforce.test.support.ExternalTestSupport.requireExternalTestsEnabled();
    }

    @Test
    void threeTenSecondRunsOfTheComplexDemoProduceAtLeastTwoStrictBestImprovements() throws Exception {
        for (int run = 1; run <= 3; run++) {
            int runNumber = run;
            List<HardMediumSoftLongScore> bestScores = solveOnce();
            assertTrue(bestScores.size() >= 2,
                    () -> "第 " + runNumber + " 次求解未产生至少两个真实 Best: " + bestScores);
            assertTrue(bestScores.getLast().compareTo(bestScores.getFirst()) > 0,
                    () -> "第 " + runNumber + " 次最终解未严格优于首个完整解: " + bestScores);
        }
    }

    private List<HardMediumSoftLongScore> solveOnce() throws Exception {
        var request = new ObjectMapper().readTree(Files.readString(DEMO_PATH, StandardCharsets.UTF_8));
        Scenario scenario = OM.fromJson(request.path("scenario").toString(), Scenario.class);
        ScenarioReferenceNormalizer.normalize(scenario);
        scenario.addVirtualAgents();
        scenario.getPlan().setMatrix(TransitMatrix.init(scenario.getPlan().getPois()));
        RoutePlan plan = scenario.getPlan().init();

        SolverConfig solverConfig = SolverConfig.createFromXmlResource("solverConfig.xml");
        solverConfig.withSolutionClass(RoutePlan.class)
                .withEntityClasses(AgentEachDay.class, Ticket.class);
        solverConfig.setTerminationConfig(new TerminationConfig().withSpentLimit(Duration.ofSeconds(10)));
        Solver<RoutePlan> solver = SolverFactory.<RoutePlan>create(solverConfig).buildSolver();
        List<HardMediumSoftLongScore> strictBestScores = new ArrayList<>();
        solver.addEventListener(event -> {
            HardMediumSoftLongScore score = event.getNewBestSolution().getScore();
            if (strictBestScores.isEmpty() || score.compareTo(strictBestScores.getLast()) > 0) {
                strictBestScores.add(score);
            }
        });
        RoutePlan finalSolution = solver.solve(plan);
        assertTrue(finalSolution.getScore().hardScore() >= 0,
                () -> "复杂演示场景最终解不应含 Hard 约束违例: " + finalSolution.getScore());
        if (strictBestScores.isEmpty() || finalSolution.getScore().compareTo(strictBestScores.getLast()) > 0) {
            strictBestScores.add(finalSolution.getScore());
        }
        return strictBestScores;
    }
}
