package one.rewind.xforce.vehicle_routing.solver.test;

import one.rewind.xforce.vehicle_routing.solver.stat.DeviationChartBuilder;
import org.jfree.chart.ChartFactory;
import org.jfree.chart.JFreeChart;
import org.jfree.chart.axis.NumberAxis;
import org.jfree.chart.plot.XYPlot;
import org.jfree.chart.renderer.xy.DeviationRenderer;
import org.jfree.chart.renderer.xy.XYItemRenderer;
import org.jfree.chart.renderer.xy.XYLineAndShapeRenderer;
import org.jfree.chart.ui.RectangleInsets;
import org.jfree.data.xy.YIntervalSeries;
import org.jfree.data.xy.YIntervalSeriesCollection;
import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.optaplanner.core.api.score.buildin.hardmediumsoftlong.HardMediumSoftLongScore;

import javax.imageio.ImageIO;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.File;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;

@Disabled("Manual script: requires explicit local data, external dependency, report generation, or long-running solver flow.")
@Tag("manual")
public class DeviationChartBuilderTest {

    @Test
    public void test() throws IOException {

        var s1 = new LinkedHashMap<Long, HardMediumSoftLongScore>();
        s1.put(1000L, HardMediumSoftLongScore.parseScore("0hard/-6medium/-332soft"));
        s1.put(2100L, HardMediumSoftLongScore.parseScore("0hard/-5medium/-344soft"));
        s1.put(4900L, HardMediumSoftLongScore.parseScore("0hard/-5medium/-311soft"));
        s1.put(8000L, HardMediumSoftLongScore.parseScore("0hard/-5medium/-290soft"));

        var s2 = new LinkedHashMap<Long, HardMediumSoftLongScore>();
        s2.put(1000L, HardMediumSoftLongScore.parseScore("0hard/-6medium/-312soft"));
        s2.put(3000L, HardMediumSoftLongScore.parseScore("0hard/-5medium/-291soft"));
        s2.put(6000L, HardMediumSoftLongScore.parseScore("0hard/-5medium/-280soft"));
        s2.put(9000L, HardMediumSoftLongScore.parseScore("0hard/-5medium/-276soft"));

        var s3 = new LinkedHashMap<Long, HardMediumSoftLongScore>();
        s3.put(1000L, HardMediumSoftLongScore.parseScore("0hard/-6medium/-312soft"));
        s3.put(3000L, HardMediumSoftLongScore.parseScore("0hard/-5medium/-291soft"));
        s3.put(6000L, HardMediumSoftLongScore.parseScore("0hard/-5medium/-280soft"));
        s3.put(9000L, HardMediumSoftLongScore.parseScore("0hard/-5medium/-276soft"));

        DeviationChartBuilder dr = new DeviationChartBuilder();
        dr.addScoreList(s1).addScoreList(s2).addScoreList(s3).genChart("scenarios/vrp_20231201/deviation_chart_test.png");

    }
}
