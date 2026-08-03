package one.rewind.xforce.vehicle_routing.solver.stat;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.jfree.chart.JFreeChart;
import org.jfree.chart.axis.NumberAxis;
import org.jfree.chart.plot.XYPlot;
import org.jfree.chart.renderer.xy.XYItemRenderer;
import org.jfree.chart.renderer.xy.XYLineAndShapeRenderer;
import org.jfree.data.xy.*;
import org.optaplanner.core.api.score.buildin.hardmediumsoftlong.HardMediumSoftLongScore;

import javax.imageio.ImageIO;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.*;
import java.util.List;

/**
 * 显示一组或多组求解收敛曲线
 * @param <C>
 */
public class ChartBuilder<C extends ChartBuilder<C>> {

    public final static Logger logger = LogManager.getLogger(ChartBuilder.class.getName());

    public static Font SourceHanSans;

    static {
        ClassLoader classLoader = Thread.currentThread().getContextClassLoader();
        try (InputStream is = classLoader.getResourceAsStream("META-INF/SourceHanSansSC-Normal-Min.ttf")) {
            if (is == null) {
                throw new RuntimeException("字体文件不存在: META-INF/SourceHanSansSC-Normal-Min.ttf");
            }
            SourceHanSans = Font.createFont(Font.TRUETYPE_FONT, is);
        } catch (Exception e) {
            throw new RuntimeException("读取失败", e);
        }
    }

    String name;

    // List of LinkedList<Map.Entry<Long, Long>>，每组是时间戳和值的键值对
    List<LinkedList<Map.Entry<Long, Long>>> timeSeries = new LinkedList<>();

    public ChartBuilder() {
        this("");
    }

    public ChartBuilder(String name) {
        this.name = name;
    }

    /**
     * 添加一组scoreList
     *
     * @param scoreList 求解过程中的最优解时间记录
     * @return 自身
     */
    public ChartBuilder<C> addScoreList(LinkedHashMap<Long, HardMediumSoftLongScore> scoreList) {

        var list_1 = new ArrayList<>(scoreList.entrySet());
        var list_2 = new LinkedList<Map.Entry<Long, Long>>();

        var minScore = list_1.stream().min(Comparator.comparing(en -> en.getValue().softScore())).get().getValue();

        // 遍历数据，修正SoftScore
        for (Map.Entry<Long, HardMediumSoftLongScore> longHardMediumSoftLongScoreEntry : list_1) {
            var t = longHardMediumSoftLongScoreEntry.getKey();
            var score = longHardMediumSoftLongScoreEntry.getValue();
            var softScore = score.softScore();

            if (score.mediumScore() < minScore.mediumScore()) {
                softScore = minScore.softScore() - (minScore.mediumScore() - score.mediumScore());
            }

            list_2.add(new AbstractMap.SimpleEntry<>(t, softScore));
        }

        timeSeries.add(list_2);
        return this;
    }

    /**
     * 计算统一时间点下各组数据的方差
     * @return Map<时间点, 方差>
     */
    private IntervalXYDataset genDataSets() {

        XYSeriesCollection dataset_1 = new XYSeriesCollection();

        int i = 0;
        for(var series : timeSeries) {
            XYSeries series_1 = new XYSeries(name + "-" + (++i));
            series.forEach(en -> {
                series_1.add((double) en.getKey()/1000, en.getValue());
            });
            dataset_1.addSeries(series_1);
        }

        return dataset_1;
    }

    /**
     * 创建图表
     * @param path
     * @throws IOException
     */
    public void genChart(String path) throws IOException {

        var fos = new FileOutputStream(path);
        genChart(fos);
        fos.close();
    }

    /**
     * 创建图表
     * @param outputStream
     * @throws IOException
     */
    public void genChart(OutputStream outputStream) throws IOException {

        var dataset_1 = genDataSets();

        // 创建X轴
        NumberAxis xAxis = new NumberAxis("Seconds");
        // 设置X轴的刻度为整数刻度，确保图表上的刻度是整数
        xAxis.setStandardTickUnits(NumberAxis.createIntegerTickUnits());

        // 创建Y轴
        NumberAxis yAxis_1 = new NumberAxis("Soft Penalty");
        // 设置X轴的刻度为整数刻度，确保图表上的刻度是整数
        yAxis_1.setStandardTickUnits(NumberAxis.createIntegerTickUnits());
        yAxis_1.setLabelPaint(Color.blue);
        /*yAxis_1.setAutoRange(true);
        yAxis_1.setAutoRangeIncludesZero(false);*/

        // 创建渲染器，渲染图表中的数据点，表示绘制线条但不绘制形状（即不显示数据点的标记）
        XYItemRenderer renderer_1 = new XYLineAndShapeRenderer(true, false);
        for(int i=0; i<20; i++) {
            renderer_1.setSeriesPaint(i, Color.blue);
            renderer_1.setSeriesStroke(i, new BasicStroke(2.0f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        }

        // 用于定义图表的主区域，包括数据集、X 轴、Y 轴和渲染器
        XYPlot plot = new XYPlot();
        plot.setDataset(0, dataset_1);
        plot.setRenderer(0, renderer_1);
        plot.setRangeAxis(0, yAxis_1);
        plot.setDomainAxis(xAxis);

        plot.mapDatasetToRangeAxis(0, 0);

        // 用于创建图表，plot 是图表的主区域，false 表示不显示图例
        JFreeChart chart = new JFreeChart(name, JFreeChart.DEFAULT_TITLE_FONT, plot, false);

        // 将图表渲染为一个 BufferedImage 对象
        BufferedImage image = chart.createBufferedImage(1024, 768);

        // 将生成的图像以PNG格式保存到输出流
        try {
            ImageIO.write(image, "png", outputStream);
        } catch (IOException e) {
            logger.error("Error {}", e.getMessage());
        }
    }
}
