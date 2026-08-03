package one.rewind.xforce.vehicle_routing.rest.test;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.quarkus.test.junit.QuarkusTest;
import one.rewind.xforce.geo.LOC;
import one.rewind.xforce.geo.Route;
import one.rewind.xforce.geo.transit.Transit;
import one.rewind.xforce.geo.transit.TransitCalculator;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/**
 * TODO 结构化输出结果 增加可读性 可与x-force结果对比
 */
@QuarkusTest
@Disabled("Manual script: requires explicit local data, external dependency, report generation, or long-running solver flow.")
@Tag("manual")
public class ScopeDetailPrintTest {

    @Test
    public void showScopeDetail() {
        // 创建ObjectMapper实例来解析JSON
        ObjectMapper mapper = new ObjectMapper();
        // 加载 JSON 文件并解析为 JsonNode
        JsonNode rootNode = null;
        try {
            rootNode = mapper.readTree(new File("data/test_scen/scope_response_20241216_beijing-120000-工作时长均衡-100-5.json"));
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
            Workbook workbook = new XSSFWorkbook();
            Sheet sheet = workbook.createSheet("data");
            // 获取业务员信息节点
            JsonNode staffDataNode = rootNode.at("/data/result/assignments");
            int row_i = 0;
            int max_col = 0;
            int totalMileageForAllVehicles = 0; // 存储所有车辆的总里程
            int totalDurationForAllVehicles = 0; // 存储所有车辆的总时长

            TransitCalculator tc = new TransitCalculator();
            // 在循环外部定义数组来存储每辆车的里程和时长
            List<Double> distances = new ArrayList<>();
            List<Double> durations = new ArrayList<>();

            for (int i = 0; i < staffDataNode.size(); i++) {
                JsonNode orderDataNode = staffDataNode.get(i).at("/day/0");
                // 创建一个新的行并设置Agent名称
                var agentName = staffDataNode.get(i).at("/info/name").asText();
                Row row = sheet.createRow(row_i++);
                Cell cell = row.createCell(0);
                cell.setCellValue(agentName);
                System.out.println("这是Agent名称：" + agentName);

                // 设置起始地点
                Cell cell1 = row.createCell(2);
                double x = staffDataNode.get(i).at("/info/x").asDouble();
                double y = staffDataNode.get(i).at("/info/y").asDouble();
                LOC startLoc = new LOC(x, y);
                cell1.setCellValue(startLoc.getLat() + "," + startLoc.getLon());

                int col_i = 3;
                // 将里程和时长写入到对应工单的下面两行
                int distanceColIndex = 3;
                int durationColIndex = 3;
                Row distanceRow = sheet.createRow(row_i++);
                Row durationRow = sheet.createRow(row_i++);
                Cell startLocDis = distanceRow.createCell(2);
                Cell startLocDur = durationRow.createCell(2);
                startLocDis.setCellValue(0);
                startLocDur.setCellValue(0);

                // 累加当前agent的总里程和总时长到全局累计值
                int totalDistance = 0;
                int totalDuration = 0;
                for (int j = 0; j < orderDataNode.size(); j++) {
                    //设置工单经纬度
                    double x1 = orderDataNode.get(j).path("x").asDouble();
                    double y1 = orderDataNode.get(j).path("y").asDouble();
                    LOC ticket_loc = new LOC(x1, y1);
                    Cell cell2 = row.createCell(col_i++);
                    cell2.setCellValue(ticket_loc.getLat() + "," + ticket_loc.getLon());
                    System.out.println("这是工单地址：" + j + "====" +  ticket_loc.getLat() + "," + ticket_loc.getLon());
                    // 仓库到第一个客户
                    if (j==0){
                        Transit r = tc.calc(startLoc, ticket_loc);
                        // 设置里程和时长
                        Cell cell3 = distanceRow.createCell(distanceColIndex++);
                        cell3.setCellValue(r.distance());
                        Cell cell4 = durationRow.createCell(durationColIndex++);
                        cell4.setCellValue(r.duration());
                        totalDistance += r.distance();
                        totalDuration += r.duration();
                    }
                    // 客户到客户
                    else {
                        JsonNode orderPreviousNode = orderDataNode.get(j - 1);
                        orderPreviousNode.path("x").asDouble();
                        orderPreviousNode.path("y").asDouble();
                        LOC ticket_previous_loc = new LOC(orderPreviousNode.path("x").asDouble(), orderPreviousNode.path("y").asDouble());
                        Transit r = tc.calc(ticket_previous_loc, ticket_loc);
                        // 设置里程和时长
                        Cell cell3 = distanceRow.createCell(distanceColIndex++);
                        cell3.setCellValue(r.distance());
                        Cell cell4 = durationRow.createCell(durationColIndex++);
                        cell4.setCellValue(r.duration());
                        totalDistance += r.distance();
                        totalDuration += r.duration();
                        // 最后一个客户到返仓
                        if (j == orderDataNode.size() - 1) {
                            Transit r_b = tc.calc(ticket_loc, startLoc);
                            // 设置里程和时长
                            Cell cell5 = distanceRow.createCell(distanceColIndex++);
                            Cell cell6 = durationRow.createCell(durationColIndex++);
                            Cell cell7 = row.createCell(col_i++);
                            cell5.setCellValue(r_b.distance());
                            cell6.setCellValue(r_b.duration());
                            cell7.setCellValue(startLoc.getLat() + "," + startLoc.getLon());
                            totalDistance += r_b.distance();
                            totalDuration += r_b.duration();
                        }
                    }

                    if (col_i > max_col) max_col = col_i;

                }

                // 计算当前agent的总里程和总时长，并将其加入到列表中
                distances.add((double) (totalDistance / 1000)); // 转换为千米
                durations.add((double) (totalDuration / 3600)); // 转换为小时
                // 计算当前车所有工单的里程
                Cell distance = distanceRow.createCell(1);
                distance.setCellValue((double) totalDistance /1000);
                totalMileageForAllVehicles += totalDistance;
                // 计算当前车所有工单的时长
                Cell duration = durationRow.createCell(1);
                duration.setCellValue((double) totalDuration /3600);
                totalDurationForAllVehicles += totalDuration;
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
            totalRow.createCell(0).setCellValue((double) totalMileageForAllVehicles /1000);
            // 写入累加的总时长
            totalRow.createCell(1).setCellValue((double) totalDurationForAllVehicles /3600);
            // 计算里程平均值
            double distanceMean = distances.stream()
                    .mapToDouble(Double::doubleValue)
                    .average()
                    .orElseThrow(() -> new RuntimeException("List is empty"));
            totalRow.createCell(2).setCellValue(distanceMean);
            // 计算时长平均值
            double durationsMean = durations.stream()
                    .mapToDouble(Double::doubleValue)
                    .average()
                    .orElseThrow(() -> new RuntimeException("List is empty"));
            totalRow.createCell(3).setCellValue(durationsMean);
            // 计算里程方差
            double distanceVariance = distances.stream()
                    .mapToDouble(i -> Math.pow(i - distanceMean, 2))
                    .average()
                    .orElseThrow(() -> new RuntimeException("List is empty"));
            // 计算里程标准差
            double distanceStdDev = Math.sqrt(distanceVariance);
            totalRow.createCell(4).setCellValue(distanceStdDev);
            // 计算时长方差
            double durationVariance = durations.stream()
                    .mapToDouble(i -> Math.pow(i - durationsMean, 2))
                    .average()
                    .orElseThrow(() -> new RuntimeException("List is empty"));
            // 计算时长标准差
            double durationStdDev = Math.sqrt(durationVariance);
            totalRow.createCell(5).setCellValue(durationStdDev);

            // Auto Fit Column
            for(int i=0; i<max_col; i++) {
                sheet.autoSizeColumn(i);
            }

            // 将工作簿写入文件系统
            FileOutputStream fileOut = null;
            try {
                fileOut = new FileOutputStream("data/test_scen/scope_北京-小区-工作时长均衡-100-排程排线-5.xlsx");
                workbook.write(fileOut);
            } catch (IOException e) {
                throw new RuntimeException(e);
            }

    }
}
