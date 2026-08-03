package one.rewind.xforce.vehicle_routing.rest.test;

import com.fasterxml.jackson.core.JsonProcessingException;
import io.quarkus.test.junit.QuarkusTest;
import one.rewind.amap.AmapAdapter;
import one.rewind.xforce.geo.LOC;
import one.rewind.xforce.geo.POI;
import one.rewind.xforce.geo.Route;
import one.rewind.xforce.geo.distance.ManhattanDistanceCalculator;
import one.rewind.xforce.geo.transit.Transit;
import one.rewind.xforce.geo.transit.TransitCalculator;
import one.rewind.xforce.json.OM;
import one.rewind.xforce.vehicle_routing.db.dto.SolverJob;
import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.domain.agent.Agent;
import one.rewind.xforce.vehicle_routing.domain.agent.AgentEachDay;
import one.rewind.xforce.vehicle_routing.domain.ticket.Ticket;
import org.apache.commons.math3.stat.descriptive.moment.Variance;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.AbstractMap;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 按车辆/工单 生成求解结果详情数据
 */
@QuarkusTest
@Disabled("Manual script: requires explicit local data, external dependency, report generation, or long-running solver flow.")
@Tag("manual")
public class RoutPlanDetailPrintTest {

    @Test
    public void showRoutePlanDetail() {
        RoutePlan sj = null;
        try {
            sj = OM.fromJson(new String(Files.readAllBytes(Path.of("data/test_scen/route/rp_20250109_qingdao-120100_routes.json")), StandardCharsets.UTF_8), RoutePlan.class);
            System.out.println("1");
        } catch (IOException e) {
            System.err.println("无法读取RourePlan");
            throw new RuntimeException(e);
        }

        Workbook workbook = new XSSFWorkbook();
        Sheet sheet = workbook.createSheet("data");
        System.out.println("2");

        var poiMap = sj.getPois().stream()
                .map(poi -> new AbstractMap.SimpleEntry<>(poi.getId(), poi))
                .collect(Collectors.toMap(AbstractMap.SimpleEntry::getKey, AbstractMap.SimpleEntry::getValue));

        var ticketMap = sj.getTickets().stream()
                .map(ticket -> new AbstractMap.SimpleEntry<>(ticket.getId(), ticket))
                .collect(Collectors.toMap(AbstractMap.SimpleEntry::getKey, AbstractMap.SimpleEntry::getValue));

        int row_i = 0;
        int max_col = 0;
        int totalMileageForAllVehicles = 0; // 存储所有车辆的总里程
        int totalTimeForAllVehicles = 0; // 存储所有车辆的总时长

        TransitCalculator tc = new TransitCalculator();

        TransitCalculator t_c = new TransitCalculator();

        // 在循环外部定义数组来存储每辆车的里程和时长
        List<Double> distances = new ArrayList<>();
        List<Double> durations = new ArrayList<>();

        for (AgentEachDay agent : sj.getAgents()) {

            System.out.println("这是Agent名称：" + agent.getName());
            // 创建一个新的行并设置Agent名称
            var agentName = agent.getName();
            Row row = sheet.createRow(row_i++);
            Cell cell = row.createCell(0);
            cell.setCellValue(agentName);

            // 设置起始地点
            Cell cell1 = row.createCell(2);
            cell1.setCellValue(poiMap.get(agent.getStartLoc().id).name);

            // 定义起始位置
            POI startLoc = poiMap.get(agent.getStartLoc().id);

            // 遍历每个工单ticket并将对应的地点添加到单元格中
            int col_i = 3;
            List<Ticket> tickets = agent.getTickets();
            int distanceColIndex = 3;
            int durationColIndex = 3;
            int totalDistance = 0;
            int totalDuration = 0;

            // 将里程和时长写入到对应工单的下面两行
            Row distanceRow = sheet.createRow(row_i++);
            Row durationRow = sheet.createRow(row_i++);

            for (int j = 0; j < tickets.size(); j++) {
                Ticket t = agent.getTickets().get(j);
                // 写入工单地址
                Cell cell2 = row.createCell(col_i++);
                var ticket_ = ticketMap.get(t.getId());
                var ticket_loc = poiMap.get(ticket_.getLoc().id);
                cell2.setCellValue(ticket_loc.name);
                System.out.println("这是工单地址：" + j + ticket_loc.name);

                Cell startLocDis = distanceRow.createCell(2);
                startLocDis.setCellValue(0);
                Cell startLocDur = durationRow.createCell(2);
                startLocDur.setCellValue(0);
                Cell cell3 = distanceRow.createCell(distanceColIndex++);
                Cell cell4 = durationRow.createCell(durationColIndex++);

                // 判断是否为第一个工单
                if (j == 0) {
                    Transit r = tc.calc(startLoc.getLoc(), ticket_loc.getLoc());
                    cell3.setCellValue(r.distance());
                    cell4.setCellValue(r.duration());
                    totalDistance += r.distance();
                    totalDuration += r.duration();
                }
                // 客户到客户
                else {
                    Ticket ticket_previous = agent.getTickets().get(j - 1);
                    var previous_loc = poiMap.get(ticketMap.get(ticket_previous.getId()).getLoc().id);
                    Transit r = tc.calc(previous_loc.getLoc(), ticket_loc.getLoc());
                    cell3.setCellValue(r.distance());
                    cell4.setCellValue(r.duration());
                    totalDistance += r.distance();
                    totalDuration += r.duration();
                    // 判断是否为最后一个工单
                    if (j == tickets.size() - 1) {
                        Transit r_b = t_c.calc(ticket_loc.getLoc(), startLoc.getLoc());
                        // 用于赋值返程的里程和时长
                        Cell cell7 = row.createCell(col_i++);
                        Cell cell5 = distanceRow.createCell(distanceColIndex++);
                        Cell cell6 = durationRow.createCell(durationColIndex++);
                        cell7.setCellValue(startLoc.name);
                        cell5.setCellValue(r_b.distance());
                        cell6.setCellValue(r_b.duration());
                        totalDistance += r_b.distance();
                        totalDuration += r_b.duration();
                    }
                }


            }
            // 计算当前agent的总里程和总时长，并将其加入到列表中
            distances.add((totalDistance / 1000.0)); // 转换为千米
            durations.add((totalDuration / 3600.0)); // 转换为小时
            // 写入累加的总里程
            Cell distance = distanceRow.createCell(1);
            distance.setCellValue((double) totalDistance /1000);
            Cell duration = durationRow.createCell(1);
            duration.setCellValue((double) totalDuration /3600);


            // 累加当前agent的总里程和总时长到全局累计值
            totalMileageForAllVehicles += totalDistance;
            totalTimeForAllVehicles += totalDuration;

            if (col_i > max_col) max_col = col_i;
        }

        // 写入标题
        Row titleRow = sheet.createRow(row_i++);
        titleRow.createCell(0).setCellValue("总里程");
        titleRow.createCell(1).setCellValue("总时长");
        titleRow.createCell(2).setCellValue("里程平均值");
        titleRow.createCell(3).setCellValue("时长平均值");
        titleRow.createCell(4).setCellValue("里程标准差");
        titleRow.createCell(5).setCellValue("时长标准差");

        // 写入累加的总里程
        Row totalRow = sheet.createRow(row_i++);
        totalRow.createCell(0).setCellValue(Math.round((double) totalMileageForAllVehicles / 1000 * 100.0) / 100.0);
        // 写入累加的总时长
        totalRow.createCell(1).setCellValue(Math.round((double) totalTimeForAllVehicles / 3600 * 100.0) / 100.0);
        // 计算里程平均值
        BigDecimal distanceSum = distances.stream()
                .map(BigDecimal::valueOf)
                .reduce(BigDecimal.ZERO, BigDecimal::add);

        BigDecimal distanceCount = BigDecimal.valueOf(distances.size());
        BigDecimal distanceMean = distanceSum.divide(distanceCount, 2, RoundingMode.HALF_UP);
        totalRow.createCell(2).setCellValue(distanceMean.doubleValue());
        // 计算时长平均值
        BigDecimal durationsSum = durations.stream()
                .map(BigDecimal::valueOf)
                .reduce(BigDecimal.ZERO, BigDecimal::add);

        BigDecimal durationsCount = BigDecimal.valueOf(durations.size());
        BigDecimal durationsMean = durationsSum.divide(durationsCount, 2, RoundingMode.HALF_UP);
        totalRow.createCell(3).setCellValue(durationsMean.doubleValue());
        // 计算里程方差
        double distanceVariance = distances.stream()
                .mapToDouble(i -> Math.pow(i - distanceMean.doubleValue(), 2))
                .average()
                .orElseThrow(() -> new RuntimeException("List is empty"));
        // 计算里程标准差
        double distanceStdDev = Math.round(distanceVariance * 100.0) / 100.0;
        totalRow.createCell(4).setCellValue(distanceStdDev);
        // 计算时长方差
        double durationVariance = durations.stream()
                .mapToDouble(i -> Math.pow(i - durationsMean.doubleValue(), 2))
                .average()
                .orElseThrow(() -> new RuntimeException("List is empty"));
        // 计算时长标准差
        double durationStdDev = Math.round(durationVariance * 100.0) / 100.0;
        totalRow.createCell(5).setCellValue(durationStdDev);

        // Auto Fit Column
        for(int i=0; i<max_col; i++) {
            sheet.autoSizeColumn(i);
        }

        // 将工作簿写入文件系统
        FileOutputStream fileOut = null;
        try {
            fileOut = new FileOutputStream("data/test_scen/xresult/rp_20250110_qingdao-120100_routes.xlsx");
            workbook.write(fileOut);
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
    }

    /**
     * 根据poiId从RoutePlan里获取POI对象
     * @param plan 规划方案
     * @param poiId POI的id
     * @return POI对象
     */
    public static POI getPOI(RoutePlan plan, String poiId) {
        var map = plan.getPois().stream()
                .map(poi -> new AbstractMap.SimpleEntry<>(poi.getId(), poi))
                .collect(Collectors.toMap(AbstractMap.SimpleEntry::getKey, AbstractMap.SimpleEntry::getValue));
        return map.get(poiId);
    }

    /**
     *根据ticketId从RoutePlan里获取Ticket对象
     * @param plan 规划方案
     * @param ticketId Ticket的id
     * @return
     */
    public static Ticket getTicket(RoutePlan plan, String ticketId) {
        var map = plan.getTickets().stream()
                .map(ticket -> new AbstractMap.SimpleEntry<>(ticket.getId(), ticket))
                .collect(Collectors.toMap(AbstractMap.SimpleEntry::getKey, AbstractMap.SimpleEntry::getValue));
        return map.get(ticketId);
    }





}
