package one.rewind.xforce.vehicle_routing.rest.test;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import io.quarkus.test.junit.QuarkusTest;
import one.rewind.xforce.json.OM;
import one.rewind.xforce.vehicle_routing.db.dto.SolutionMetrics;
import one.rewind.xforce.vehicle_routing.db.dto.SolverJob;
import org.apache.commons.lang3.tuple.ImmutablePair;
import org.apache.commons.lang3.tuple.Pair;
import org.jfree.chart.ChartFactory;
import org.jfree.chart.ChartPanel;
import org.jfree.chart.JFreeChart;
import org.jfree.chart.axis.LogAxis;
import org.jfree.chart.axis.LogarithmicAxis;
import org.jfree.chart.axis.NumberAxis;
import org.jfree.chart.axis.NumberTickUnit;
import org.jfree.chart.labels.StandardXYToolTipGenerator;
import org.jfree.chart.plot.PlotOrientation;
import org.jfree.chart.plot.XYPlot;
import org.jfree.chart.renderer.xy.XYItemRenderer;
import org.jfree.chart.renderer.xy.XYLineAndShapeRenderer;
import org.jfree.chart.urls.StandardXYURLGenerator;
import org.jfree.chart.util.Args;
import org.jfree.data.Range;
import org.jfree.data.category.DefaultCategoryDataset;
import org.jfree.data.xy.DefaultXYDataset;
import org.jfree.data.xy.XYDataset;
import org.jfree.data.xy.XYSeries;
import org.jfree.data.xy.XYSeriesCollection;
import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import javax.imageio.ImageIO;
import javax.swing.*;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.text.NumberFormat;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.List;
import java.util.stream.Collectors;
@Disabled("Manual script: requires explicit local data, external dependency, report generation, or long-running solver flow.")
@Tag("manual")
public class JFreeChartTest {

    @Test
    public void test1() throws IOException {

        // 读取SolverJob类型的json文件
        ObjectMapper mapper = new ObjectMapper();
        String src = new String(Files.readAllBytes(Path.of("data/test_scen/route/sj_20250101_beijing-120000-100-1000-12h_routes.json")), StandardCharsets.UTF_8);

        // 创建XYSeries对象，用于存储X轴和Y轴的数据点
        XYSeries series = new XYSeries("SoftScore");

        // 定义第一个时间戳
        long t0 = 0;
        // 记录分数的最大值
        long y_max = 0;
        // 记录分数的最小值
        long y_min = Long.MAX_VALUE;
        // 用于存储时间-分数对
        List<Pair<Long, Long>> raw = new LinkedList<>();

        try {

            // 获取 solutionMetricsList 的所有节点
            ArrayNode solutionMetricsList = (ArrayNode) mapper.readTree(src).get("solutionMetricsList");
            int size = solutionMetricsList.size();
            for(int i = 0; i < size; i++) {
                // 跳过倒数第二个节点
                if (i == size - 2) {
                    continue;
                }
                //  JSON 字符串解析为一个 JsonNode 对象
                JsonNode node = solutionMetricsList.get(i);
                // 解析为毫秒级的时间戳
                long t1 = LocalDateTime.parse(node.get("create_time").asText(), DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"))
                        .atZone(ZoneId.systemDefault())
                        .toInstant()
                        .toEpochMilli();

                // 如果这是第一个节点，则将 t1 作为基准时间 t0
                if(t0 == 0) t0 = t1;

                // 提取soft分数
                String[] split = node.get("metrics").get("score").asText().split("/");
                Long softScore = - Long.valueOf(split[split.length - 1].replaceAll("soft", ""));

                // 更新最大值和最小值
                if(softScore > y_max) y_max = softScore;
                if(softScore < y_min) y_min = softScore;

                // 计算当前时间戳与基准时间t0的差值，并将其转换为秒
                long t_ = (t1 - t0) / 1000;

                raw.add(new ImmutablePair<>(t_, softScore));

            }

        } catch (JsonProcessingException e) {
            e.printStackTrace();
        }

        for(var pair : raw) {
            // key时间，value分数被除以 y_min，然后取10次幂
            series.add((double) pair.getKey(), (double) Math.pow(((double) pair.getValue()) / y_min, 10));
        }


        // 用于存储多个 XYSeries 对象
        XYSeriesCollection dataset = new XYSeriesCollection();
        dataset.addSeries(series);

        // 创建X轴
        NumberAxis xAxis = new NumberAxis("Seconds");
        // 设置X轴的刻度为整数刻度，确保图表上的刻度是整数
        xAxis.setStandardTickUnits(NumberAxis.createIntegerTickUnits());

        // 创建Y轴
        NumberAxis yAxis = new NumberAxis("Seconds");
        // 设置X轴的刻度为整数刻度，确保图表上的刻度是整数
        yAxis.setStandardTickUnits(NumberAxis.createIntegerTickUnits());

        /*yAxis.setTickUnit(new NumberTickUnit(1.0, NumberFormat.getInstance(), 9));
        yAxis.setTickMarkInsideLength(2f);
        yAxis.setTickMarkOutsideLength(4f);
        yAxis.setTickMarkPaint(Color.GREEN);
        yAxis.setTickMarkStroke(new BasicStroke(2f));
        yAxis.setMinorTickMarksVisible(true);*/


        // 创建渲染器，渲染图表中的数据点，表示绘制线条但不绘制形状（即不显示数据点的标记）
        XYItemRenderer renderer = new XYLineAndShapeRenderer(true, false);
        // 用于定义图表的主区域，包括数据集、X 轴、Y 轴和渲染器
        XYPlot plot = new XYPlot(dataset, xAxis, yAxis, renderer);

        // 用于创建图表，"Solution Finding" 是图表的标题，plot 是图表的主区域，false 表示不显示图例
        JFreeChart chart = new JFreeChart("Solution Finding", JFreeChart.DEFAULT_TITLE_FONT, plot, false);

        /*JFreeChart chart = ChartFactory.createXYLineChart(
                "Solution Finding",
                "Seconds",
                yAxis,
                dataset);*/

        // 将图表渲染为一个 BufferedImage 对象，宽度为 800 像素，高度为 500 像素
        BufferedImage image = chart.createBufferedImage(800, 500);

        // 将生成的图像保存为 PNG 文件，文件名为 image.png
        File outputfile = new File("image.png");
        try {
            ImageIO.write(image, "png", outputfile);
        } catch (IOException e) {
            System.err.println("Error " + e.getMessage());
        }

        System.out.println("2");
    }

}
