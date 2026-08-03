package one.rewind.xforce.vehicle_routing.service;

import one.rewind.amap.AmapAdapter;
import one.rewind.xforce.geo.POI;
import one.rewind.xforce.vehicle_routing.db.dto.Scenario;
import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.domain.agent.AgentEachDay;
import one.rewind.xforce.vehicle_routing.domain.agent.Depo;
import one.rewind.xforce.vehicle_routing.domain.ticket.Ticket;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

class ScenarioLocationEnricherTest {

    @Test
    void reverseGeocodesOnlyIncompleteAddressOrCityAndKeepsFailuresSaveable() throws Exception {
        Path configPath = Path.of("build/test-scenario-location-enricher-" + System.nanoTime() + ".json");
        try {
            RecordingAmapAdapter adapter = new RecordingAmapAdapter(configPath);
            ScenarioLocationEnricher enricher = new ScenarioLocationEnricher();
            enricher.amapAdapter = adapter;

            POI fullyProvided = poi("manual-poi", "用户填写地址", "用户填写城市", "116.397128,39.916527");
            fullyProvided.name = "用户名称";
            fullyProvided.pcode = "用户省份编码";

            POI missingAddress = poi("manual-address", "", "用户城市", "116.397129,39.916528");
            missingAddress.name = "保留名称";
            POI missingCity = poi("manual-city", "用户地址", "", "116.397130,39.916529");
            missingCity.name = "保留名称";
            POI missingBoth = poi("manual-both", "", "", "116.397131,39.916530");
            missingBoth.name = "保留名称";
            POI sameCoordinate = poi("manual-duplicate", "", "", "116.397131,39.916530");
            sameCoordinate.name = "保留名称";

            POI depotLocation = poi(null, "同一地址", "", "");
            POI ticketLocation = poi(null, "同一地址", "", "");
            POI failedLocation = poi(null, "无法解析", "", "");

            Depo depot = new Depo("depot-1", "仓库", fullyProvided);
            Depo retained = new Depo("depot-2", "正向解析", depotLocation);
            AgentEachDay agent = new AgentEachDay();
            agent.setStartLoc(missingAddress);
            Ticket forwardGeocodedTicket = new Ticket();
            forwardGeocodedTicket.setLoc(ticketLocation);
            Ticket missingCityTicket = new Ticket();
            missingCityTicket.setLoc(missingCity);
            Ticket missingBothTicket = new Ticket();
            missingBothTicket.setLoc(missingBoth);
            Ticket duplicateCoordinateTicket = new Ticket();
            duplicateCoordinateTicket.setLoc(sameCoordinate);
            Ticket failedTicket = new Ticket();
            failedTicket.setLoc(failedLocation);

            RoutePlan plan = new RoutePlan();
            plan.setDepos(List.of(depot, retained));
            plan.setAgents(List.of(agent));
            plan.setTickets(List.of(
                    forwardGeocodedTicket,
                    missingCityTicket,
                    missingBothTicket,
                    duplicateCoordinateTicket,
                    failedTicket
            ));
            Scenario scenario = new Scenario();
            scenario.setPlan(plan);

            assertDoesNotThrow(() -> enricher.enrich(scenario));

            assertEquals(2, adapter.geocodeCalls, "两个不同文本输入中，重复地址只解析一次");
            assertEquals(3, adapter.regeoCalls, "仅地址或城市缺失的三个不同坐标调用逆地理接口");

            assertEquals("manual-poi", fullyProvided.id);
            assertEquals("用户名称", fullyProvided.name);
            assertEquals("用户填写地址", fullyProvided.address);
            assertEquals("用户填写城市", fullyProvided.cityname);
            assertEquals("用户省份编码", fullyProvided.pcode);
            assertNull(fullyProvided.type);
            assertNull(fullyProvided.entr_location);

            assertEquals("解析后的坐标地址", missingAddress.address);
            assertEquals("用户城市", missingAddress.cityname);
            assertEquals("manual-address", missingAddress.id);
            assertEquals("保留名称", missingAddress.name);
            assertNull(missingAddress.pcode, "逆地理解析不补充 POI 元数据");

            assertEquals("用户地址", missingCity.address);
            assertEquals("解析城市", missingCity.cityname);
            assertEquals("manual-city", missingCity.id);
            assertEquals("保留名称", missingCity.name);
            assertNull(missingCity.pcode, "逆地理解析不补充 POI 元数据");

            assertEquals("解析后的坐标地址", missingBoth.address);
            assertEquals("解析城市", missingBoth.cityname);
            assertEquals("manual-both", missingBoth.id);
            assertEquals("保留名称", missingBoth.name);
            assertNull(missingBoth.pcode, "逆地理解析不补充 POI 元数据");
            assertEquals("解析后的坐标地址", sameCoordinate.address);
            assertEquals("解析城市", sameCoordinate.cityname);

            assertEquals("解析城市", depotLocation.cityname);
            assertEquals("121.5,31.2", depotLocation.location);
            assertEquals("geo-result", depotLocation.id);
            assertEquals("解析城市", ticketLocation.cityname);
            assertEquals("无法解析", failedLocation.address, "解析失败保留原始数据");
            assertNotNull(depotLocation.location);
        } finally {
            Files.deleteIfExists(configPath);
        }
    }

    private static POI poi(String id, String address, String city, String location) {
        POI poi = new POI();
        poi.id = id;
        poi.address = address;
        poi.cityname = city;
        poi.location = location;
        return poi;
    }

    private static final class RecordingAmapAdapter extends AmapAdapter {

        private int geocodeCalls;
        private int regeoCalls;

        private RecordingAmapAdapter(Path configPath) {
            super(
                    true,
                    "test-amap-key",
                    10,
                    10000,
                    86400,
                    10,
                    configPath.toString(),
                    GeocodeProvider.AMAP,
                    "http://127.0.0.1:18080/api/resolve",
                    false
            );
        }

        @Override
        public List<POI> geocode(String address, String city) throws IOException {
            geocodeCalls += 1;
            if ("无法解析".equals(address)) {
                throw new IOException("no match");
            }
            POI poi = poi("geo-result", "解析后的地址", "解析城市", "121.5,31.2");
            return List.of(poi);
        }

        @Override
        public POI regeo(String location) {
            regeoCalls += 1;
            POI poi = poi("regeo-result", "解析后的坐标地址", "解析城市", location);
            poi.name = "解析名称";
            poi.pcode = "解析省份编码";
            poi.type = "解析类型";
            poi.entr_location = "116.0,39.0";
            return poi;
        }
    }
}
