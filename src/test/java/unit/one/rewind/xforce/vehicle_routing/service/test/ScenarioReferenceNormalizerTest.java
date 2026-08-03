package one.rewind.xforce.vehicle_routing.service.test;

import one.rewind.xforce.geo.POI;
import one.rewind.xforce.json.OM;
import one.rewind.xforce.vehicle_routing.db.dto.Scenario;
import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.domain.agent.Agent;
import one.rewind.xforce.vehicle_routing.domain.agent.AgentEachDay;
import one.rewind.xforce.vehicle_routing.domain.ticket.Ticket;
import one.rewind.xforce.vehicle_routing.service.ScenarioReferenceNormalizer;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;

class ScenarioReferenceNormalizerTest {

    @Test
    void acceptsPoiIdReferencesAndInlinePoiObjects() {
        String json = """
                {
                  "plan": {
                    "pois": [
                      {
                        "id": "poi-1",
                        "name": "poi-1",
                        "location": "116.397128,39.916527"
                      }
                    ],
                    "depos": [
                      {
                        "id": "depo-1",
                        "loc": "poi-1"
                      }
                    ],
                    "agents": [
                      {
                        "id": "agent-1",
                        "start_loc": "poi-1",
                        "tickets": []
                      }
                    ],
                    "tickets": [
                      {
                        "id": "ticket-1",
                        "loc": {
                          "cityname": "北京市",
                          "address": "东城区东华门大街"
                        }
                      }
                    ]
                  }
                }
                """;

        Scenario scenario = assertDoesNotThrow(() -> OM.fromJson(json, Scenario.class));
        ScenarioReferenceNormalizer.normalize(scenario);

        POI canonicalPoi = scenario.getPlan().getPois().getFirst();
        assertSame(canonicalPoi, scenario.getPlan().getDepos().getFirst().getLoc());
        assertSame(canonicalPoi, scenario.getPlan().getAgents().getFirst().getStartLoc());

        POI inlinePoi = scenario.getPlan().getTickets().getFirst().getLoc();
        assertNotNull(inlinePoi);
        assertNull(inlinePoi.id);
        assertEquals("北京市", inlinePoi.cityname);
        assertEquals("东城区东华门大街", inlinePoi.address);
    }

    @Test
    void acceptsDuplicatedAgentDefinitionsAcrossRoundTrip() {
        String json = """
                {
                  "name": "roundtrip",
                  "desc": "duplicate agent definitions",
                  "planning_date": "2026-04-14",
                  "start_time": "2026-04-14 08:00:00",
                  "end_time": "2026-04-14 20:00:00",
                  "plan": {
                    "skus": [],
                    "pois": [
                      {
                        "id": "poi-1",
                        "name": "poi-1",
                        "location": "116.397128,39.916527",
                        "address": "beijing"
                      }
                    ],
                    "depos": [],
                    "agents": [
                      {
                        "id": "virtual-1-260410",
                        "name": "virtual-1-260410",
                        "start_loc": "poi-1",
                        "skills": [],
                        "date": "2026-04-10",
                        "restrict": false,
                        "max_ticket_num": 0,
                        "shift_start_time": "2026-04-10 00:00:00",
                        "shift_off_time": "2026-04-10 23:59:59",
                        "tickets": []
                      }
                    ],
                    "tickets": [
                      {
                        "id": "ticket-1",
                        "depo_id": "depo-1",
                        "pinned": false,
                        "type": "Delv",
                        "skills_required": [],
                        "qualification_levels_required": {},
                        "dep_tickets": [],
                        "ref_tickets": [],
                        "weight": 1.0,
                        "vol": 1.0,
                        "loc": "poi-1",
                        "create_time": "2026-04-10 08:00:00",
                        "min_start_time": "2026-04-10 09:00:00",
                        "max_end_time": "2026-04-10 10:00:00",
                        "duration": "PT15M",
                        "agent": {
                          "id": "virtual-1-260410",
                          "name": "virtual-1-260410",
                          "start_loc": "poi-1",
                          "skills": [],
                          "date": "2026-04-10",
                          "restrict": false,
                          "max_ticket_num": 0,
                          "shift_start_time": "2026-04-10 00:00:00",
                          "shift_off_time": "2026-04-10 23:59:59",
                          "tickets": ["ticket-1"]
                        }
                      }
                    ],
                    "matrix": null,
                    "constraint_configuration": {},
                    "cost_parameter": {}
                  }
                }
                """;

        Scenario parsed = assertDoesNotThrow(() -> OM.fromJson(json, Scenario.class));
        ScenarioReferenceNormalizer.normalize(parsed);

        assertEquals(1, parsed.getPlan().getAgents().size());
        assertEquals(1, parsed.getPlan().getTickets().size());
        assertSame(parsed.getPlan().getAgents().getFirst(), parsed.getPlan().getTickets().getFirst().getAgent());

        String normalizedJson = assertDoesNotThrow(() -> OM.toJson(parsed));
        Scenario reparsed = assertDoesNotThrow(() -> OM.fromJson(normalizedJson, Scenario.class));
        ScenarioReferenceNormalizer.normalize(reparsed);

        assertNotNull(reparsed);
        assertEquals("virtual-1-260410", reparsed.getPlan().getAgents().getFirst().getId());
        assertSame(reparsed.getPlan().getAgents().getFirst(), reparsed.getPlan().getTickets().getFirst().getAgent());
    }

    @Test
    void normalizesCanonicalPoiAgentAndTicketReferences() {
        POI poi = new POI("poi-1");
        poi.name = "poi-1";
        poi.location = "116.397128,39.916527";

        POI duplicatePoi = new POI("poi-1");
        duplicatePoi.address = "beijing";

        AgentEachDay listedAgent = newAgent("agent-1", poi);
        AgentEachDay duplicateAgent = newAgent("agent-1", duplicatePoi);

        Ticket listedTicket = newTicket("ticket-1", poi);
        Ticket duplicateTicket = newTicket("ticket-1", duplicatePoi);

        listedAgent.setTickets(new ArrayList<>(List.of(duplicateTicket)));
        listedTicket.setAgent(duplicateAgent);

        Scenario scenario = new Scenario();
        RoutePlan plan = new RoutePlan();
        plan.setPois(new ArrayList<>(List.of(poi)));
        plan.setAgents(new ArrayList<>(List.of(listedAgent)));
        plan.setTickets(new ArrayList<>(List.of(listedTicket)));
        scenario.setPlan(plan);

        ScenarioReferenceNormalizer.normalize(scenario);

        assertEquals(1, scenario.getPlan().getPois().size());
        assertEquals(1, scenario.getPlan().getAgents().size());
        assertEquals(1, scenario.getPlan().getTickets().size());
        assertSame(scenario.getPlan().getPois().getFirst(), scenario.getPlan().getAgents().getFirst().getStartLoc());
        assertSame(scenario.getPlan().getPois().getFirst(), scenario.getPlan().getTickets().getFirst().getLoc());
        assertSame(scenario.getPlan().getAgents().getFirst(), scenario.getPlan().getTickets().getFirst().getAgent());
        assertSame(scenario.getPlan().getTickets().getFirst(), scenario.getPlan().getAgents().getFirst().getTickets().getFirst());
    }

    private static AgentEachDay newAgent(String id, POI startLoc) {
        Agent base = new Agent(id, id, "depo-1", startLoc, List.of(), 0, 0);
        return new AgentEachDay(base, LocalDate.of(2026, 4, 10), LocalTime.of(8, 0), LocalTime.of(18, 0));
    }

    private static Ticket newTicket(String id, POI loc) {
        return new Ticket(
                id,
                "depo-1",
                false,
                Ticket.Type.Delv,
                List.of(),
                1F,
                1F,
                loc,
                LocalDateTime.of(2026, 4, 10, 8, 0),
                LocalDateTime.of(2026, 4, 10, 9, 0),
                LocalDateTime.of(2026, 4, 10, 10, 0)
        );
    }
}
