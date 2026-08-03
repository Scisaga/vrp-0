package one.rewind.xforce.vehicle_routing.solver.stat;

import one.rewind.xforce.geo.RouteDrawer;
import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.domain.ticket.Ticket;
import org.jfree.chart.ChartFactory;
import org.jfree.chart.JFreeChart;
import org.jfree.chart.axis.CategoryAxis;
import org.jfree.chart.axis.DateAxis;
import org.jfree.chart.axis.ValueAxis;
import org.jfree.chart.plot.CategoryPlot;
import org.jfree.chart.plot.PlotOrientation;
import org.jfree.chart.renderer.category.CategoryItemRendererState;
import org.jfree.chart.renderer.category.GanttRenderer;
import org.jfree.chart.text.TextUtils;
import org.jfree.chart.ui.RectangleEdge;
import org.jfree.chart.ui.TextAnchor;
import org.jfree.data.gantt.GanttCategoryDataset;
import org.jfree.data.gantt.Task;
import org.jfree.data.gantt.TaskSeries;
import org.jfree.data.gantt.TaskSeriesCollection;

import javax.imageio.ImageIO;
import java.awt.*;
import java.awt.geom.Rectangle2D;
import java.awt.geom.RoundRectangle2D;
import java.awt.image.BufferedImage;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.*;

/**
 * 基于RoutePlan中的任务指派信息生成Gantt图
 */
public class GanttChartBuilder {

    String name;
    RoutePlan rp;

    /**
     *
     * @param name
     * @param rp
     */
    public GanttChartBuilder(String name, RoutePlan rp) {
        this.name = name;
        this.rp = rp;
    }

    /**
     * 生成图表
     * @param path 文件路径
     * @throws IOException IO异常
     */
    public void genChart(String path) throws IOException {

        var fos = new FileOutputStream(path);
        genChart(fos);
        fos.close();
    }

    /**
     * 生成图表
     * @param outputStream 输出流
     * @throws IOException IO异常
     */
    public void genChart(OutputStream outputStream) throws IOException {


        //
        JFreeChart chart = ChartFactory.createGanttChart(
                name,  // chart title
                "Agents",              // domain axis label
                "Time",              // range axis label
                createDataset(rp),             // data
                false,                // include legend
                true,                // tooltips
                false                // urls
        );

        // 设置图表标题字体
        chart.getTitle().setFont(ChartBuilder.SourceHanSans.deriveFont(Font.BOLD, 16));

        CategoryPlot plot = (CategoryPlot) chart.getPlot();
        plot.setRangePannable(true);
        plot.getDomainAxis().setMaximumCategoryLabelWidthRatio(10.0f);

        // 设置Y轴
        // 使用雅黑字体
        Font font = ChartBuilder.SourceHanSans.deriveFont(Font.PLAIN, 14);
        CategoryAxis domainAxis = plot.getDomainAxis();
        domainAxis.setTickLabelFont(font);
        domainAxis.setLabelFont(font);

        // 自定义任务Bar的渲染器
        CustomGanttRenderer renderer = new CustomGanttRenderer();

        renderer.setDefaultItemLabelsVisible(true);
        // 启用条形边框绘制
        renderer.setDrawBarOutline(true);
        // 设置边框颜色为黑色
        renderer.setSeriesOutlinePaint(0, Color.WHITE);
        // 设置边框线条样式（例如，线宽为1.0f）
        renderer.setSeriesOutlineStroke(0, new BasicStroke(1.0f));
        // 完成度设置为透明
        renderer.setCompletePaint(new Color(0, 0, 0, 0));

        plot.setRenderer(renderer);

        // 设置X轴
        DateAxis dateAxis = (DateAxis) plot.getRangeAxis();
        dateAxis.setDateFormatOverride(new SimpleDateFormat("M/dd HH:mm"));

        // 将图表渲染为一个 BufferedImage 对象
        BufferedImage image = chart.createBufferedImage(1024, 768);

        // 将生成的图像以PNG格式写入输出流
        ImageIO.write(image, "png", outputStream);
    }

    /**
     * 创建数据集
     * @param rp RoutePlan
     * @return TaskSeriesCollection
     */
    private static TaskSeriesCollection createDataset(RoutePlan rp) {

        TaskSeriesCollection collection = new TaskSeriesCollection();
        TaskSeries s1 = new TaskSeries("Planned Tickets");

        rp.getAgents().forEach(a -> {
            if(!a.getTickets().isEmpty()) {
                LocalDateTime s_a_local_date_time = a.getTickets().getFirst().getArrivalTime();
                for (Ticket ticket : a.getTickets()) {
                    if (ticket.getArrivalTime().isBefore(s_a_local_date_time)) {
                        s_a_local_date_time = ticket.getArrivalTime();
                    }
                }
                Date s_a = Date.from(s_a_local_date_time.atZone(ZoneId.systemDefault()).toInstant());

                LocalDateTime e_a_local_date_time = a.getTickets().getLast().getDepartureTime();
                for (Ticket ticket : a.getTickets()) {
                    if (ticket.getDepartureTime().isAfter(e_a_local_date_time)) {
                        e_a_local_date_time = ticket.getDepartureTime();
                    }
                }
                Date e_a = Date.from(e_a_local_date_time.atZone(ZoneId.systemDefault()).toInstant());

                Task task = new Task(a.getName(), s_a, e_a);

                a.getTickets().forEach(t -> {
                    Date s_t = Date.from(t.getArrivalTime().atZone(ZoneId.systemDefault()).toInstant());
                    Date e_t = Date.from(t.getDepartureTime().atZone(ZoneId.systemDefault()).toInstant());
                    Task subTask = new Task(t.getId(), s_t, e_t);
                    task.addSubtask(subTask);
                });

                s1.add(task);
            }
        });

        collection.add(s1);

        return collection;
    }

    // 继承 GanttRenderer，覆写 drawTasks
    static class CustomGanttRenderer extends GanttRenderer {

        private final Map<String, Paint> taskColorMap = new HashMap<>();
        private int nextColorIndex = 0;

        @Override
        public Paint getItemPaint(int row, int column) {
            TaskSeriesCollection dataset = (TaskSeriesCollection) getPlot().getDataset();
            Task task = dataset.getSeries(row).get(column);
            String key = task.getDescription() != null ? task.getDescription() : "";

            if (key == null) {
                key = task.toString(); // fallback
            }

            // 已有颜色则返回，否则分配新颜色
            if (!taskColorMap.containsKey(key)) {
                Color color = RouteDrawer.colorPalette.get(nextColorIndex % RouteDrawer.colorPalette.size());
                taskColorMap.put(key, color);
                nextColorIndex++;
            }

            return taskColorMap.get(key);
        }

        /**
         *
         * @param g2  the graphics device.
         * @param state  the renderer state.
         * @param dataArea  the data plot area.
         * @param plot  the plot.
         * @param domainAxis  the domain axis.
         * @param rangeAxis  the range axis.
         * @param dataset  the data.
         * @param row  the row index (zero-based).
         * @param column  the column index (zero-based).
         */
        @Override
        protected void drawTasks(Graphics2D g2,
                                 CategoryItemRendererState state,
                                 Rectangle2D dataArea,
                                 CategoryPlot plot,
                                 CategoryAxis domainAxis,
                                 ValueAxis rangeAxis,
                                 GanttCategoryDataset dataset,
                                 int row,
                                 int column) {

            PlotOrientation orientation = plot.getOrientation();
            RectangleEdge edge = plot.getRangeAxisEdge();
            int count = dataset.getSubIntervalCount(row, column);
            // 转为 TaskSeriesCollection 以获取 Task 对象
            TaskSeriesCollection collection = (TaskSeriesCollection) dataset;
            Task task = collection.getSeries(row).get(column);

            // 设置TaskBar文字字体
            g2.setFont(ChartBuilder.SourceHanSans.deriveFont(Font.ITALIC, 14));

            if (count == 0) {
                // ---- 单区间任务 ----
                Number start = dataset.getStartValue(row, column);
                Number end   = dataset.getEndValue(row, column);
                if (start == null || end == null) {
                    return;
                }
                double v0 = rangeAxis.valueToJava2D(start.doubleValue(), dataArea, edge);
                double v1 = rangeAxis.valueToJava2D(end.doubleValue(),   dataArea, edge);
                double rectStart = calculateBarW0(plot, orientation, dataArea,
                        domainAxis, state, row, column);
                double barWidth  = state.getBarWidth();
                double rectLength = Math.abs(v1 - v0);

                Rectangle2D bar;

                if (orientation == PlotOrientation.HORIZONTAL) {
                    bar = new Rectangle2D.Double(
                            Math.min(v0, v1), rectStart, rectLength, barWidth);
                } else {
                    bar = new Rectangle2D.Double(
                            rectStart, Math.min(v0, v1), barWidth, rectLength);
                }

                // 创建圆角矩形
                RoundRectangle2D roundedBar = new RoundRectangle2D.Double(
                        bar.getX(), bar.getY(), bar.getWidth(), bar.getHeight(),
                        10.0, 10.0);

                // 绘制条形与边框
                g2.setPaint(getItemPaint(row, column));
                g2.fill(roundedBar);
                if (isDrawBarOutline() && barWidth > BAR_OUTLINE_WIDTH_THRESHOLD) {
                    g2.setPaint(getItemOutlinePaint(row, column));
                    g2.setStroke(getItemOutlineStroke(row, column));
                    g2.draw(roundedBar);
                }
                // 绘制描述文字
                String desc = task.getDescription();
                if (desc != null) {
                    g2.setPaint(getItemLabelPaint(row, column));
                    TextUtils.drawAlignedString(desc, g2,
                            (float)bar.getCenterX(), (float)bar.getCenterY(),
                            TextAnchor.CENTER);
                }
            }
            else {
                // ---- 多子区间任务 ----
                for (int i = 0; i < count; i++) {
                    Number s = dataset.getStartValue(row, column, i);
                    Number e = dataset.getEndValue(row, column, i);
                    if (s == null || e == null) {
                        continue;
                    }
                    double v0 = rangeAxis.valueToJava2D(s.doubleValue(), dataArea, edge);
                    double v1 = rangeAxis.valueToJava2D(e.doubleValue(), dataArea, edge);
                    double rectStart = calculateBarW0(plot, orientation, dataArea,
                            domainAxis, state, row, column);
                    double barWidth  = state.getBarWidth();
                    double rectLength = Math.abs(v1 - v0);

                    Rectangle2D bar;
                    if (orientation == PlotOrientation.HORIZONTAL) {
                        bar = new Rectangle2D.Double(
                                Math.min(v0, v1), rectStart, rectLength, barWidth);
                    } else {
                        bar = new Rectangle2D.Double(
                                rectStart, Math.min(v0, v1), barWidth, rectLength);
                    }

                    // 创建圆角矩形
                    RoundRectangle2D roundedBar = new RoundRectangle2D.Double(
                            bar.getX(), bar.getY(), bar.getWidth(), bar.getHeight(),
                            10.0, 10.0);

                    g2.setPaint(getItemPaint(row, column));
                    g2.fill(roundedBar);

                    if (isDrawBarOutline() && barWidth > BAR_OUTLINE_WIDTH_THRESHOLD) {
                        g2.setPaint(getItemOutlinePaint(row, column));
                        g2.setStroke(getItemOutlineStroke(row, column));
                        g2.draw(roundedBar);
                    }
                    // 绘制子任务描述
                    try {
                        Task sub = task.getSubtask(i);
                        if (sub != null && sub.getDescription() != null) {
                            g2.setPaint(getItemLabelPaint(row, column));
                            TextUtils.drawAlignedString(
                                    sub.getDescription(), g2,
                                    (float)bar.getCenterX(), (float)bar.getCenterY(),
                                    TextAnchor.CENTER);
                        }
                    } catch (IndexOutOfBoundsException ex) {
                    }
                }
            }
        }
    }
}
