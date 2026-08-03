package one.rewind.xforce.vehicle_routing.db.dto;

import com.fasterxml.jackson.databind.ObjectMapper;
import one.rewind.xforce.geo.POI;
import one.rewind.xforce.geo.map.MapProvider;
import one.rewind.xforce.json.OM;
import one.rewind.xforce.vehicle_routing.domain.agent.AgentEachDay;
import one.rewind.xforce.vehicle_routing.domain.ticket.Ticket;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalTime;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AucklandHereComplexDemoTest {

    @Test
    void demoProvidesARealAddressMultiDepotHerePlanningScenario() throws Exception {
        String source = Files.readString(
                Path.of("scenarios/public-demo/here-nz-auckland-complex.json"),
                StandardCharsets.UTF_8
        );
        var request = new ObjectMapper().readTree(source);
        Scenario scenario = OM.fromJson(request.path("scenario").toString(), Scenario.class);
        var plan = scenario.getPlan();

        assertEquals("Auckland multi-depot field-service planning demo", request.path("scenario_name").asText());
        assertEquals("PT2M", request.path("solve_options").path("solve_time").asText());
        assertEquals("ROUTING", request.path("solve_options").path("matrix_mode").asText());
        assertTrue(request.path("solve_options").path("build_transit_matrix").asBoolean());
        assertTrue(request.path("solve_options").path("draw_route").asBoolean());

        assertEquals(UUID.fromString("a04a5bd2-85a6-5e71-a164-09dd91acc4cb"),
                UUID.fromString(request.path("scenario").path("id").asText()));
        assertEquals(MapProvider.HERE, scenario.getMapProvider());
        assertNotNull(plan);
        assertEquals(4, plan.getDepos().size());
        assertEquals(12, plan.getAgents().size());
        assertEquals(44, plan.getTickets().size());
        assertEquals(36, plan.getPois().size());
        assertEquals(13, plan.getSkus().size());

        assertEquals(36, plan.getPois().stream().map(POI::getId).distinct().count());
        plan.getPois().forEach(poi -> {
            assertEquals(poi.address, poi.name, "POI 名称必须使用真实完整地址: " + poi.id);
            assertTrue(poi.address.endsWith("New Zealand"), "POI 地址缺少国家: " + poi.id);
            String[] coordinate = poi.location.split(",");
            double longitude = Double.parseDouble(coordinate[0]);
            double latitude = Double.parseDouble(coordinate[1]);
            assertTrue(longitude >= 174.60 && longitude <= 174.95, "POI 经度不在奥克兰服务区: " + poi.id);
            assertTrue(latitude >= -37.10 && latitude <= -36.70, "POI 纬度不在奥克兰服务区: " + poi.id);
            // 当前 LOC 保留引擎既有的 longitude,latitude 字段映射，HERE 适配器优先读取 location。
            assertEquals(longitude, poi.getLoc().lat, 0.000001, "POI LOC 经度不一致: " + poi.id);
            assertEquals(latitude, poi.getLoc().lon, 0.000001, "POI LOC 纬度不一致: " + poi.id);
        });
        plan.getDepos().forEach(depo -> assertEquals(depo.getLoc().address, depo.getName()));

        Map<String, AgentEachDay> agentsById = plan.getAgents().stream()
                .collect(Collectors.toMap(AgentEachDay::getId, Function.identity()));
        assertEquals(Set.of(
                "Mia Thompson", "Arjun Patel", "Wiremu Rangi",
                "Sofia Martinez", "Ethan Chen", "Aroha Ngata",
                "Noah Williams", "Priya Nair", "Liam Faumuina",
                "Isabella Brown", "Daniel Kim", "Mele Tuivaiti"
        ), plan.getAgents().stream().map(AgentEachDay::getName).collect(Collectors.toSet()));
        plan.getAgents().forEach(agent -> {
            assertFalse(agent.getName().contains("—"), "工程师列表名称应保持紧凑: " + agent.getId());
            assertTrue(agent.getSkills().size() >= 5);
            assertFalse(agent.getQualificationLevels().isEmpty());
            assertTrue(agent.getTickets().size() >= 3 && agent.getTickets().size() <= 4);
            assertTrue(agent.getTickets().size() <= agent.getMaxTicketNum());
            assertTrue(agent.getFuelConsumption() > 0);
            assertTrue(agent.getFixCostDaily() >= 505 && agent.getFixCostDaily() <= 575);
            assertTrue(agent.getTickets().stream().allMatch(ticket -> agent.getDepoId().equals(ticket.getDepoId())));
        });
        assertEquals(Map.of("depo-north", 3L, "depo-central", 3L, "depo-east", 3L, "depo-south", 3L),
                plan.getAgents().stream().collect(Collectors.groupingBy(
                        AgentEachDay::getDepoId,
                        Collectors.counting()
                )));

        assertEquals(44, plan.getTickets().stream().filter(ticket -> ticket.getAgent() != null).count());
        plan.getTickets().forEach(ticket -> {
            AgentEachDay assigned = agentsById.get(ticket.getAgent().getId());
            assertNotNull(assigned, "工单初始工程师不存在: " + ticket.getId());
            assertEquals(ticket.getDepoId(), assigned.getDepoId(), "工单跨仓初始指派: " + ticket.getId());
            assertTrue(assigned.getSkills().containsAll(ticket.getSkillsRequired()), "技能不匹配: " + ticket.getId());
            assertTrue(ticket.getQualificationLevelsRequired().entrySet().stream()
                    .allMatch(required -> assigned.getQualificationLevels().getOrDefault(required.getKey(), 0.0)
                            >= required.getValue()), "资质不匹配: " + ticket.getId());
            assertTrue(ticket.getSkillsRequired().size() >= 1 && ticket.getSkillsRequired().size() <= 4);
            assertFalse(ticket.getItems().isEmpty());

            double itemWeight = ticket.getItems().stream()
                    .mapToDouble(item -> item.sku().weight * item.value())
                    .sum();
            double itemVol = ticket.getItems().stream()
                    .mapToDouble(item -> item.sku().vol * item.value())
                    .sum();
            assertEquals(itemWeight, ticket.getWeight(), 0.0001, "SKU 重量汇总不一致: " + ticket.getId());
            assertEquals(itemVol, ticket.getVol(), 0.0001, "SKU 体积汇总不一致: " + ticket.getId());
        });
        assertEquals(Map.of("depo-north", 11L, "depo-central", 11L, "depo-east", 11L, "depo-south", 11L),
                plan.getTickets().stream().collect(Collectors.groupingBy(Ticket::getDepoId, Collectors.counting())));

        long ticketsWithMultipleCandidates = plan.getTickets().stream()
                .filter(ticket -> plan.getAgents().stream().filter(agent -> isCompatible(agent, ticket)).count() >= 2)
                .count();
        assertEquals(20, ticketsWithMultipleCandidates);

        assertEquals(12, plan.getTickets().stream().filter(ticket -> !ticket.getDepTickets().isEmpty()).count());
        assertEquals(12, plan.getTickets().stream().filter(ticket -> !ticket.getRefTickets().isEmpty()).count());
        assertTrue(plan.getTickets().stream()
                .filter(ticket -> !ticket.getDepTickets().isEmpty())
                .allMatch(ticket -> ticket.getDepTickets().stream().allMatch(dep ->
                        dep.getAgent().getId().equals(ticket.getAgent().getId())
                                && dep.getRefTickets().stream().anyMatch(ref -> ref.getId().equals(ticket.getId()))
                )));

        TreeMap<Integer, Long> startHourHistogram = plan.getTickets().stream().collect(Collectors.groupingBy(
                ticket -> ticket.getMinStartTime().getHour(),
                TreeMap::new,
                Collectors.counting()
        ));
        assertEquals(Map.of(7, 1L, 8, 3L, 9, 5L, 10, 6L, 11, 8L,
                12, 8L, 13, 5L, 14, 3L, 15, 3L, 16, 2L), startHourHistogram);
        assertEquals(LocalTime.of(7, 0), plan.getTickets().stream()
                .map(Ticket::getMinStartTime).min(java.time.LocalDateTime::compareTo).orElseThrow().toLocalTime());
        assertEquals(LocalTime.of(16, 30), plan.getTickets().stream()
                .map(Ticket::getMinStartTime).max(java.time.LocalDateTime::compareTo).orElseThrow().toLocalTime());

        var costs = plan.getCostParameter();
        assertEquals(135.0, costs.getStartPrice());
        assertEquals(18.0, costs.getNodeFee());
        assertEquals(1.05, costs.getMaxOverloadRatio());
        assertEquals(350.0, costs.getOverloadFee());
        assertEquals(18_000.0, costs.getCrossRegionThreshold());
        assertEquals(45.0, costs.getCrossRegionFee());
        assertEquals(300.0, costs.getGuaranteedIncome());
        assertEquals(40.0, costs.getTimeRestrictedTrafficCharge());
        assertEquals(0.24, costs.getElecPrice());
        assertEquals(2.94, costs.getGas92Price());

        var constraints = plan.getConstraintConfiguration();
        assertEquals("1hard/0medium/0soft", constraints.getAgentSkillsAccordWithTicketSkills().toString());
        assertEquals("1hard/0medium/0soft", constraints.getAgentQualificationLevelsMatchTicket().toString());
        assertEquals("1hard/0medium/0soft", constraints.getSameDepo().toString());
        assertEquals("1hard/0medium/0soft", constraints.getRefTicketAfterDepTicket().toString());
        assertEquals("1hard/0medium/0soft", constraints.getRefTicketSameAgentWithDepTicket().toString());
        assertEquals("0hard/5medium/0soft", constraints.getBalanceAgentLoading().toString());
        assertEquals("0hard/3medium/0soft", constraints.getBalanceAgentWorkingTime().toString());
        assertEquals("0hard/0medium/2soft", constraints.getMinimizeTravelTime().toString());
        assertEquals("0hard/0medium/1soft", constraints.getMinimizeTravelDistance().toString());
    }

    private static boolean isCompatible(AgentEachDay agent, Ticket ticket) {
        return agent.getDepoId().equals(ticket.getDepoId())
                && agent.getSkills().containsAll(ticket.getSkillsRequired())
                && ticket.getQualificationLevelsRequired().entrySet().stream()
                .allMatch(required -> agent.getQualificationLevels().getOrDefault(required.getKey(), 0.0)
                        >= required.getValue());
    }
}
