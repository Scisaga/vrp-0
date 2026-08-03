package one.rewind.xforce.vehicle_routing.db.dto;

import com.fasterxml.jackson.databind.ObjectMapper;
import one.rewind.xforce.json.OM;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BeijingScoreProgressDemoTest {

    @Test
    void demoIsAUuidBackedManhattanScenarioWithAComplexAssignedSuboptimalSeed() throws Exception {
        String source = Files.readString(Path.of("scenarios/public-demo/beijing-score-progress.json"), StandardCharsets.UTF_8);
        var request = new ObjectMapper().readTree(source);
        Scenario scenario = OM.fromJson(request.path("scenario").toString(), Scenario.class);

        // 页面导入使用 solve-request 包装；其中的 scenario 仍须提供稳定合法 UUID。
        assertEquals("北京复杂多仓得分进度演示", request.path("scenario_name").asText());
        assertEquals("PT30S", request.path("solve_options").path("solve_time").asText());
        assertEquals("MANHATTAN", request.path("solve_options").path("matrix_mode").asText());
        assertTrue(request.path("solve_options").path("build_transit_matrix").asBoolean());
        assertTrue(request.path("solve_options").path("draw_route").asBoolean());
        assertEquals(UUID.fromString("1a19b4b8-d0b1-59bb-a0da-fe7562086b5d"),
                UUID.fromString(request.path("scenario").path("id").asText()));
        assertNotNull(scenario.getPlan());
        assertEquals(5, scenario.getPlan().getDepos().size());
        assertEquals(15, scenario.getPlan().getAgents().size());
        assertEquals(60, scenario.getPlan().getTickets().size());
        assertTrue(scenario.getPlan().getTickets().stream()
                .map(ticket -> ticket.getId())
                .allMatch(id -> id.matches("ticket-\\d{2}-(haidian|chaoyang|fengtai|tongzhou|daxing)")));
        assertTrue(scenario.getPlan().getTickets().stream()
                .anyMatch(ticket -> ticket.getId().equals("ticket-02-haidian")));
        assertEquals(50, scenario.getPlan().getPois().size());
        assertTrue(scenario.getPlan().getPois().stream()
                .allMatch(poi -> poi.address != null
                        && poi.address.startsWith("北京市")
                        && poi.address.contains("区")
                        && !poi.name.contains("客户点")));
        assertEquals(10, scenario.getPlan().getSkus().size());
        assertEquals("0hard/0medium/0soft",
                scenario.getPlan().getConstraintConfiguration().getMinimizeTicketChanging().toString());
        assertEquals("1hard/0medium/0soft",
                scenario.getPlan().getConstraintConfiguration().getAgentQualificationLevelsMatchTicket().toString());
        assertEquals("0hard/10medium/0soft",
                scenario.getPlan().getConstraintConfiguration().getBalanceAgentLoading().toString());
        assertEquals("0hard/0medium/1soft",
                scenario.getPlan().getConstraintConfiguration().getMinimizeTravelTime().toString());
        assertEquals("0hard/0medium/1soft",
                scenario.getPlan().getConstraintConfiguration().getMinimizeTravelDistance().toString());
        assertEquals(260.0, scenario.getPlan().getCostParameter().getStartPrice());
        assertEquals(1.0, scenario.getPlan().getCostParameter().getMaxOverloadRatio());
        assertEquals(0.5103, scenario.getPlan().getCostParameter().getElecPrice());
        assertEquals(7.18, scenario.getPlan().getCostParameter().getGas92Price());
        assertTrue(scenario.getPlan().getAgents().stream()
                .allMatch(agent -> agent.getTickets() != null
                        && agent.getTickets().size() == 4
                        && !agent.getSkills().isEmpty()
                        && !agent.getQualificationLevels().isEmpty()
                        && agent.getFuelConsumption() > 0
                        && agent.getFixCostDaily() > 0));
        assertEquals(60, scenario.getPlan().getTickets().stream()
                .filter(ticket -> ticket.getAgent() != null)
                .count());
        assertTrue(scenario.getPlan().getTickets().stream()
                .allMatch(ticket -> !ticket.getItems().isEmpty()
                        && ticket.getWeight() > 0
                        && ticket.getVol() > 0
                        && ticket.getAgent().getDepoId().equals(ticket.getDepoId())));
        assertEquals(5, scenario.getPlan().getTickets().stream()
                .filter(ticket -> !ticket.getDepTickets().isEmpty())
                .count());
        assertEquals(5, scenario.getPlan().getTickets().stream()
                .filter(ticket -> !ticket.getRefTickets().isEmpty())
                .count());
        assertTrue(scenario.getPlan().getTickets().stream()
                .filter(ticket -> !ticket.getDepTickets().isEmpty())
                .allMatch(ticket -> ticket.getDepTickets().stream()
                        .allMatch(dep -> dep.getAgent().getId().equals(ticket.getAgent().getId())
                                && dep.getRefTickets().stream()
                                .anyMatch(ref -> ref.getId().equals(ticket.getId())))));
        scenario.getPlan().getTickets().forEach(ticket -> {
            double itemWeight = ticket.getItems().stream()
                    .mapToDouble(item -> item.sku().weight * item.value())
                    .sum();
            double itemVol = ticket.getItems().stream()
                    .mapToDouble(item -> item.sku().vol * item.value())
                    .sum();
            assertEquals(itemWeight, ticket.getWeight(), 0.0001, "SKU 重量汇总不一致: " + ticket.getId());
            assertEquals(itemVol, ticket.getVol(), 0.0001, "SKU 体积汇总不一致: " + ticket.getId());
        });
    }
}
