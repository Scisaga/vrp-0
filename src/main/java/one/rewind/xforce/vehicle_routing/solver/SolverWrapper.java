package one.rewind.xforce.vehicle_routing.solver;

import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.domain.agent.AgentEachDay;
import one.rewind.xforce.vehicle_routing.domain.ticket.Ticket;
import one.rewind.xforce.vehicle_routing.solver.filter.TicketChangeMoveFilter;
import one.rewind.xforce.vehicle_routing.solver.filter.TicketSwapMoveFilter;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.jfree.chart.JFreeChart;
import org.jfree.chart.axis.NumberAxis;
import org.jfree.chart.plot.XYPlot;
import org.jfree.chart.renderer.xy.XYItemRenderer;
import org.jfree.chart.renderer.xy.XYLineAndShapeRenderer;
import org.jfree.data.Range;
import org.jfree.data.xy.XYSeries;
import org.jfree.data.xy.XYSeriesCollection;
import org.optaplanner.core.api.score.buildin.hardmediumsoftlong.HardMediumSoftLongScore;
import org.optaplanner.core.api.solver.SolutionManager;
import org.optaplanner.core.api.solver.Solver;
import org.optaplanner.core.api.solver.SolverFactory;
import org.optaplanner.core.config.constructionheuristic.ConstructionHeuristicPhaseConfig;
import org.optaplanner.core.config.heuristic.selector.move.composite.UnionMoveSelectorConfig;
import org.optaplanner.core.config.heuristic.selector.move.generic.list.ListChangeMoveSelectorConfig;
import org.optaplanner.core.config.heuristic.selector.move.generic.list.ListSwapMoveSelectorConfig;
import org.optaplanner.core.config.localsearch.LocalSearchPhaseConfig;
import org.optaplanner.core.config.localsearch.decider.acceptor.LocalSearchAcceptorConfig;
import org.optaplanner.core.config.localsearch.decider.forager.LocalSearchForagerConfig;
import org.optaplanner.core.config.phase.custom.CustomPhaseConfig;
import org.optaplanner.core.config.solver.SolverConfig;

import javax.imageio.ImageIO;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.*;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.function.Supplier;

public class SolverWrapper {

    public final static Logger logger = LogManager.getLogger(SolverWrapper.class.getName());

    private final Solver<RoutePlan> solver;

    private final LinkedHashMap<Long, HardMediumSoftLongScore> scoreList = new LinkedHashMap<>();

    private final SolutionManager<RoutePlan, HardMediumSoftLongScore> solutionManager;

    /**
     *
     * @param solveTime
     * @return
     */
    public static SolverWrapper build(Duration solveTime) {
        return new SolverWrapper(0, solveTime, LocalSearchConfig_1);
    }

    /**
     *
     * @param solveTime
     * @param lsConfig
     * @return
     */
    public static SolverWrapper build(int threadCount, Duration solveTime, Supplier<LocalSearchPhaseConfig> lsConfig) {
        return new SolverWrapper(threadCount, solveTime, lsConfig);
    }

    /**
     *
     * @param solveTime
     * @param lsConfig
     */
    private SolverWrapper(int threadCount, Duration solveTime, Supplier<LocalSearchPhaseConfig> lsConfig) {

        String threadCountStr = threadCount == 0 ? "AUTO" : String.valueOf(threadCount);

        long t = System.currentTimeMillis();

        SolverConfig sc = new SolverConfig()
                .withSolutionClass(RoutePlan.class)
                .withEntityClasses(AgentEachDay.class, Ticket.class)
                .withConstraintProviderClass(RoutePlanConstraintProvider.class)
                .withMoveThreadCount(threadCountStr)
                .withTerminationSpentLimit(solveTime)
                .withPhases(
                        new CustomPhaseConfig()
                                .withCustomPhaseCommands(new InitialArrivalTimeCustomPhaseCommand()),
                        new ConstructionHeuristicPhaseConfig(),
                        lsConfig.get()
                );

        SolverFactory<RoutePlan> solverFactory = SolverFactory.create(sc);
        this.solver = solverFactory.buildSolver();
        this.solutionManager = SolutionManager.create(solverFactory); // ✅ 初始化 ScoreManager

        solver.addEventListener(event -> {
            RoutePlan newBestSolution = event.getNewBestSolution();
            HardMediumSoftLongScore newScore = newBestSolution.getScore();
            logger.info("t={} score={}", event.getTimeMillisSpent(), newScore);
            scoreList.put(event.getTimeMillisSpent(), newScore);
        });

        logger.info("build solver time: {}ms", System.currentTimeMillis() - t);
    }

    /**
     *
     * @param plan
     * @return
     */
    public RoutePlan solve(RoutePlan plan) {
        this.scoreList.clear();

        plan.init();
        RouteScheduleInitializer.initializePreassignedRoutes(plan);
        RoutePlan best = this.solver.solve(plan);

        // ✅ 求解结束后解释评分
        var explanation = solutionManager.explain(best);

        best.setScoreExplanation(explanation.getSummary());

        return best;
    }

    /**
     *
     * @return
     */
    public LinkedHashMap<Long, HardMediumSoftLongScore> getScoreList() {
        return new LinkedHashMap<>(scoreList);
    }

    /**
     *
     * @param path
     * @throws IOException
     */
    public SolverWrapper genChart(String path) throws IOException {

        var fos = new FileOutputStream(path);

        genChart(this.scoreList, fos);

        fos.close();

        return this;
    }


    /**
     * OptaPlanner 会默认启用以下两种 ListMoveSelector：
     * - ListChangeMoveSelector：将列表中的一个元素移动到同一或不同列表的另一个位置。
     * - ListSwapMoveSelector：交换同一列表或不同列表中的两个元素的位置。
     *
     * 这两种移动选择器是处理列表变量的基本操作，适用于大多数情况。
     * 如果希望使用更复杂的移动操作（例如 SubListChangeMoveSelector、KOptListMoveSelector 等），需要在配置中显式添加。
     */
    public static Supplier<LocalSearchPhaseConfig> LocalSearchConfig_1 = () -> new LocalSearchPhaseConfig()
            .withAcceptorConfig(
                    new LocalSearchAcceptorConfig()
                            .withEntityTabuSize(4)
                            .withSimulatedAnnealingStartingTemperature("2hard/2medium/100soft")
            )
            .withForagerConfig(
                    new LocalSearchForagerConfig()
                            .withAcceptedCountLimit(4)
            )
            .withMoveSelectorConfig(
                    new UnionMoveSelectorConfig().withMoveSelectors(
                            new ListChangeMoveSelectorConfig()
                                    .withFilterClass(TicketChangeMoveFilter.class),
                            new ListSwapMoveSelectorConfig()
                                    .withFilterClass(TicketSwapMoveFilter.class)
                    )
            );


    /**
     *
     * @param scoreList
     * @param outputStream
     */
    public static void genChart(LinkedHashMap<Long, HardMediumSoftLongScore> scoreList, OutputStream outputStream) {

        if (scoreList == null || scoreList.isEmpty()) {
            return;
        }

        long f_m = scoreList.lastEntry().getValue().softScore();

        // 用于存储多个 XYSeries 对象
        XYSeriesCollection dataset_1 = new XYSeriesCollection();
        XYSeriesCollection dataset_2 = new XYSeriesCollection();

        // 创建XYSeries对象，用于存储X轴和Y轴的数据点
        XYSeries series_1 = new XYSeries("SoftScore");
        XYSeries series_2 = new XYSeries("SoftScoreRelative");

        scoreList.forEach((i, s) -> {
            series_1.add((double) i/1000, s.softScore());
            series_2.add((double) i/1000, Math.max(100 * (double) (s.softScore() - f_m) / s.softScore(), 0));
        });

        dataset_1.addSeries(series_1);
        dataset_2.addSeries(series_2);

        // 创建X轴
        NumberAxis xAxis = new NumberAxis("Seconds");
        // 设置X轴的刻度为整数刻度，确保图表上的刻度是整数
        xAxis.setStandardTickUnits(NumberAxis.createIntegerTickUnits());

        // 创建Y轴
        NumberAxis yAxis_1 = new NumberAxis("Soft Penalty");
        // 设置X轴的刻度为整数刻度，确保图表上的刻度是整数
        yAxis_1.setStandardTickUnits(NumberAxis.createIntegerTickUnits());
        yAxis_1.setLabelPaint(Color.blue);
        yAxis_1.setAutoRange(true);
        yAxis_1.setAutoRangeIncludesZero(false);

        NumberAxis yAxis_2 = new NumberAxis("Performance GAP (%)");
        // 设置X轴的刻度为整数刻度，确保图表上的刻度是整数
        yAxis_2.setStandardTickUnits(NumberAxis.createIntegerTickUnits());
        yAxis_2.setLabelPaint(new Color(0, 136, 0));
        yAxis_2.setRange(new Range(- 5, 100));


        // 创建渲染器，渲染图表中的数据点，表示绘制线条但不绘制形状（即不显示数据点的标记）
        XYItemRenderer renderer_1 = new XYLineAndShapeRenderer(true, false);
        renderer_1.setSeriesPaint(0, Color.blue);
        XYItemRenderer renderer_2 = new XYLineAndShapeRenderer(true, false);
        renderer_2.setSeriesPaint(0, new Color(0, 136, 0));

        // 用于定义图表的主区域，包括数据集、X 轴、Y 轴和渲染器
        XYPlot plot = new XYPlot();
        plot.setDataset(0, dataset_1);
        plot.setDataset(1, dataset_2);
        plot.setRenderer(0, renderer_1);
        plot.setRenderer(1, renderer_2);
        plot.setRangeAxis(0, yAxis_1);
        plot.setRangeAxis(1, yAxis_2);
        plot.setDomainAxis(xAxis);

        // 映射数据集和坐标轴
        plot.mapDatasetToRangeAxis(0, 0);
        plot.mapDatasetToRangeAxis(1, 1);

        // XYPlot plot = new XYPlot(dataset_1, xAxis, yAxis, renderer_1);

        // 用于创建图表，plot 是图表的主区域，false 表示不显示图例
        JFreeChart chart = new JFreeChart("Convergence Curve", JFreeChart.DEFAULT_TITLE_FONT, plot, false);

        // 将图表渲染为一个 BufferedImage 对象
        BufferedImage image = chart.createBufferedImage(1024, 768);

        try {
            ImageIO.write(image, "png", outputStream);
        } catch (IOException e) {
            logger.error("Error {}", e.getMessage());
        }
    }
}
