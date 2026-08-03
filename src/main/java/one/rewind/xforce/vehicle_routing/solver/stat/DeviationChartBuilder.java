package one.rewind.xforce.vehicle_routing.solver.stat;

import one.rewind.xforce.vehicle_routing.solver.SolverWrapper;
import org.apache.commons.lang3.tuple.ImmutablePair;
import org.apache.commons.lang3.tuple.Pair;
import org.jfree.chart.JFreeChart;
import org.jfree.chart.axis.NumberAxis;
import org.jfree.chart.axis.NumberTickUnit;
import org.jfree.chart.plot.XYPlot;
import org.jfree.chart.renderer.xy.DeviationRenderer;
import org.jfree.chart.renderer.xy.XYItemRenderer;
import org.jfree.chart.renderer.xy.XYLineAndShapeRenderer;
import org.jfree.data.Range;
import org.jfree.data.xy.*;
import org.optaplanner.core.api.score.buildin.hardmediumsoftlong.HardMediumSoftLongScore;

import javax.imageio.ImageIO;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.*;
import java.util.List;

/**
 * 记录同场景多次求解收敛曲线，生成区间统计图
 */
public class DeviationChartBuilder extends ChartBuilder<DeviationChartBuilder>{

    private final long interval;

    public DeviationChartBuilder() {
        this("", 1000);
    }

    /**
     *
     * @param name 标题
     * @param interval 统计间隔，毫秒
     */
    public DeviationChartBuilder(String name, long interval) {
        this.name = name;
        this.interval = interval;
    }

    /**
     * 生成图表
     * @param outputStream
     * @throws IOException
     */
    public void genChart(OutputStream outputStream) throws IOException {

        Pair<IntervalXYDataset, IntervalXYDataset> datasets = calculateStandardDeviationByTime();

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
        /*yAxis_2.setStandardTickUnits(NumberAxis.createStandardTickUnits());*/
        yAxis_2.setTickUnit(new NumberTickUnit(0.1));
        yAxis_2.setLabelPaint(new Color(0, 136, 0));
        yAxis_2.setRange(new Range(- 5, 100));
        /*yAxis_2.setAutoRange(true);*/


        // 创建渲染器，渲染图表中的数据点，表示绘制线条但不绘制形状（即不显示数据点的标记）
        DeviationRenderer renderer_1 = new DeviationRenderer(true, false);
        renderer_1.setSeriesStroke(0, new BasicStroke(2.0f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        renderer_1.setSeriesStroke(1, new BasicStroke(2.0f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        renderer_1.setSeriesPaint(0, Color.blue);
        renderer_1.setSeriesPaint(1, new Color(0, 136, 0));
        renderer_1.setSeriesFillPaint(0, new Color(150, 205, 255));
        renderer_1.setSeriesFillPaint(1, new Color(175, 205, 155));

        XYItemRenderer renderer_2 = new XYLineAndShapeRenderer(true, false);
        renderer_2.setSeriesPaint(0, new Color(0, 136, 0));
        renderer_2.setSeriesStroke(0, new BasicStroke(2.0f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));

        // 创建Plot
        XYPlot plot = new XYPlot();

        plot.setDomainPannable(true);
        plot.setRangePannable(false);
        // 设置数据集索引
        plot.setDataset(0, datasets.getKey());
        plot.setDataset(1, datasets.getValue());
        // 设置数据集的渲染器
        plot.setRenderer(0, renderer_1);
        plot.setRenderer(1, renderer_2);
        // 设置数据集的Y轴
        plot.setRangeAxis(0, yAxis_1);
        plot.setRangeAxis(1, yAxis_2);
        // 设置X轴
        plot.setDomainAxis(xAxis);
        // 设置数据集
        plot.mapDatasetToRangeAxis(0, 0);
        plot.mapDatasetToRangeAxis(1, 1);

        JFreeChart chart = new JFreeChart(name, JFreeChart.DEFAULT_TITLE_FONT, plot, false);

        // 将图表渲染为一个 BufferedImage 对象，宽度为 800 像素，高度为 600 像素
        BufferedImage image = chart.createBufferedImage(1024, 768);

        // 将生成的图像保存为 PNG 文件，文件名为 image.png
        ImageIO.write(image, "png", outputStream);
    }

    /**
     * 计算统一时间点下各组数据的方差
     * @return Map<时间点, 方差>
     */
    private Pair<IntervalXYDataset, IntervalXYDataset> calculateStandardDeviationByTime() {

        // 序列1 时间点求解统计量 期望 +方差 -方差
        YIntervalSeriesCollection dataset_1 = new YIntervalSeriesCollection();
        YIntervalSeries series_1 = new YIntervalSeries(name);
        dataset_1.addSeries(series_1);

        // 序列2 相对最优解差异
        XYSeriesCollection dataset_2 = new XYSeriesCollection();
        XYSeries series_2 = new XYSeries("Relative Performance (%)");
        dataset_2.addSeries(series_2);

        // 1. 找到时间范围
        long minTime = Long.MAX_VALUE;
        long maxTime = Long.MIN_VALUE;
        for (LinkedList<Map.Entry<Long, Long>> ss : timeSeries) {
            if (!ss.isEmpty()) {
                minTime = Math.min(minTime, ss.getFirst().getKey());
                maxTime = Math.max(maxTime, ss.getLast().getKey());
            }
        }

        if (minTime == Long.MAX_VALUE || maxTime == Long.MIN_VALUE) {
            return new ImmutablePair<>(dataset_1, dataset_2); // 空数据
        }

        // 2. 生成统一时间点
        List<Long> unifiedTimes = new ArrayList<>();
        for (long time = minTime; time <= maxTime; time += interval) {
            unifiedTimes.add(time);
        }

        // 最后一个时间点的均值
        double f_m = timeSeries.stream()
                .map(ss -> getNearestValue(ss, unifiedTimes.getLast()))
                .filter(Objects::nonNull)
                .mapToDouble(Long::doubleValue)
                .average()
                .getAsDouble();

        // 3. 计算每个时间点的方差
        for (long t : unifiedTimes) {
            // 收集当前时间点的所有数据值
            List<Double> valuesAtTime = new ArrayList<>();
            for (LinkedList<Map.Entry<Long, Long>> ss : timeSeries) {
                Long value = getNearestValue(ss, t);
                if (value != null) {
                    valuesAtTime.add(value.doubleValue());
                }
            }

            // 计算方差，记录均值、方差和相对差异
            if (!valuesAtTime.isEmpty()) {
                double variance = calculateVariance(valuesAtTime);
                double sd = Math.sqrt(variance);
                @SuppressWarnings("OptionalGetWithoutIsPresent")
                double mean = valuesAtTime.stream().mapToDouble(i -> i).average().getAsDouble();

                series_1.add((double) t /1000, mean, mean - sd, Math.min(mean + sd, 0));
                series_2.add((double) t /1000, Math.max(0, 100 * (mean - f_m) / mean));
            }
        }

        return new ImmutablePair<>(dataset_1, dataset_2);
    }


    /**
     * 查找最接近目标时间的数据值
     * @param series 时间序列（LinkedList<Map.Entry<Long, Long>>）
     * @param targetTime 目标时间
     * @return 最接近的数据值，或 null（如果无有效数据）
     */
    private static Long getNearestValue(LinkedList<Map.Entry<Long, Long>> series, long targetTime) {
        if (series.isEmpty()) {
            return null;
        }

        Map.Entry<Long, Long> matchEntry = series.stream()
                .filter(p -> p.getKey() <= targetTime)
                .max(Map.Entry.comparingByKey())
                .orElse(series.getFirst());

        return matchEntry.getValue();
    }


    /**
     * 计算数据列表的方差
     * @param values 数据值
     * @return 方差
     */
    private static double calculateVariance(List<Double> values) {

        if (values == null || values.isEmpty()) {
            return 0.0;
        }

        // 计算均值
        double mean = values.stream()
                .mapToDouble(v -> v)
                .average()
                .orElse(0.0);

        // 计算方差
        double sumSquaredDiff = values.stream()
                .mapToDouble(v -> v)
                .map(x -> Math.pow(x - mean, 2))
                .sum();

        return sumSquaredDiff / values.size();
    }
}
