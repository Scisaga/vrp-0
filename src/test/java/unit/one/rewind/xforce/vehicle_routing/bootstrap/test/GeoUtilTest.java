package one.rewind.xforce.vehicle_routing.bootstrap.test;

import one.rewind.amap.AmapAdapter;
import one.rewind.xforce.geo.POI;
import one.rewind.xforce.geo.Route;
import one.rewind.xforce.geo.transit.Transit;
import one.rewind.xforce.geo.transit.TransitMatrix;
import one.rewind.xforce.vehicle_routing.bootstrap.GeoUtil;
import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.domain.agent.Agent;
import one.rewind.xforce.vehicle_routing.domain.agent.AgentEachDay;
import one.rewind.xforce.vehicle_routing.domain.agent.Depo;
import one.rewind.xforce.vehicle_routing.domain.ticket.Ticket;
import one.rewind.xforce.vehicle_routing.exception.POINoWhereException;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;

class GeoUtilTest {

    @Test
    void buildPoiCollectsDistinctResolvedPoisWithoutExternalLookup() throws Exception {
        POI shared = poi("shared", "116.100000,39.100000");
        POI ticketPoi = poi("ticket", "116.200000,39.200000");
        RoutePlan plan = routePlan(shared, shared, ticketPoi);

        GeoUtil.buildPOI(plan);

        assertEquals(2, plan.getPois().size());
        assertSame(shared, plan.getDepos().getFirst().getLoc());
        assertSame(shared, plan.getAgents().getFirst().getStartLoc());
    }

    @Test
    void buildMatrixWithManhattanCreatesMatrixForAllDistinctPois() throws Exception {
        POI depoPoi = poi("depo", "116.100000,39.100000");
        POI agentPoi = poi("agent", "116.120000,39.120000");
        POI ticketPoi = poi("ticket", "116.200000,39.200000");
        RoutePlan plan = routePlan(depoPoi, agentPoi, ticketPoi);

        GeoUtil.buildMatrix(plan, GeoUtil.MatrixMode.MANHATTAN);

        assertEquals(List.of(depoPoi, agentPoi, ticketPoi), plan.getPois());
        assertNotNull(plan.getMatrix());
        assertEquals(Transit.ZERO.distance(), plan.getMatrix().get(depoPoi.id, depoPoi.id).distance());
        assertNotEquals(Transit.MAX, plan.getMatrix().get(depoPoi.id, ticketPoi.id));
        assertNotEquals(Transit.MAX, plan.getMatrix().get(ticketPoi.id, agentPoi.id));
    }

    @Test
    void buildMatrixRejectsNoWherePoi() {
        RoutePlan plan = routePlan(poi("depo", "116.100000,39.100000"), poi("agent", "116.120000,39.120000"), POI.NoWhere);

        assertThrows(POINoWhereException.class, () -> GeoUtil.buildMatrix(plan, GeoUtil.MatrixMode.MANHATTAN));
    }

    @Test
    void populateMatrixWithChangingTicketsInitializesEmptyMatrixWithoutMovedTickets() throws Exception {
        POI depoPoi = poi("depo", "116.100000,39.100000");
        POI agentPoi = poi("agent", "116.120000,39.120000");
        POI ticketPoi = poi("ticket", "116.200000,39.200000");
        RoutePlan plan = routePlan(depoPoi, agentPoi, ticketPoi);
        plan.setMatrix(null);

        GeoUtil.populateMatrixWithChangingTickets(plan);

        assertEquals(List.of(depoPoi, agentPoi, ticketPoi), plan.getPois());
        assertNotNull(plan.getMatrix());
        assertNotEquals(Transit.MAX, plan.getMatrix().get(depoPoi.id, ticketPoi.id));
    }

    @Test
    void populateMatrixWithExistRouteAddsReturnRouteForSingleTicket() throws Exception {
        AmapAdapter previousAdapter = installStubAmapAdapter();
        try {
            POI depoPoi = poi("depo", "116.100000,39.100000");
            POI agentPoi = poi("agent", "116.120000,39.120000");
            POI ticketPoi = poi("ticket", "116.200000,39.200000");
            RoutePlan plan = routePlan(depoPoi, agentPoi, ticketPoi);
            AgentEachDay agent = plan.getAgents().getFirst();

            GeoUtil.populateMatrixWithExistRoute(plan);

            assertNotNull(agent.getRoutes());
            assertEquals(2, agent.getRoutes().size());
            assertRoute(agent.getRoutes().get(0), agentPoi, ticketPoi);
            assertRoute(agent.getRoutes().get(1), ticketPoi, agentPoi);
            assertNotEquals(Transit.MAX, plan.getMatrix().get(agentPoi.id, ticketPoi.id));
            assertNotEquals(Transit.MAX, plan.getMatrix().get(ticketPoi.id, agentPoi.id));
        } finally {
            restoreAmapAdapter(previousAdapter);
        }
    }

    private static RoutePlan routePlan(POI depoPoi, POI agentPoi, POI ticketPoi) {
        Depo depo = new Depo("depo-a", "depo-a", depoPoi);
        AgentEachDay agent = agent("agent-1", agentPoi);
        Ticket ticket = ticket("ticket-1", ticketPoi);
        agent.setTickets(List.of(ticket));
        RoutePlan plan = new RoutePlan();
        plan.setDepos(List.of(depo));
        plan.setAgents(List.of(agent));
        plan.setTickets(List.of(ticket));
        plan.setMatrix(new TransitMatrix());
        return plan;
    }

    private static AgentEachDay agent(String id, POI startLoc) {
        Agent base = new Agent(id, id, "depo-a", startLoc, List.of("Delv"), 10, 10);
        return new AgentEachDay(base, LocalDate.of(2026, 1, 2), LocalTime.of(8, 0), LocalTime.of(18, 0));
    }

    private static Ticket ticket(String id, POI loc) {
        LocalDateTime start = LocalDateTime.of(2026, 1, 2, 9, 0);
        return new Ticket(
                id,
                "depo-a",
                false,
                Ticket.Type.Delv,
                List.of("Delv"),
                1,
                1,
                loc,
                LocalDateTime.of(2026, 1, 1, 9, 0),
                start,
                start.withHour(18)
        );
    }

    private static POI poi(String id, String location) {
        POI poi = new POI(id);
        poi.location = location;
        return poi;
    }

    private static void assertRoute(Route route, POI origin, POI destination) {
        assertEquals(origin.getLoc().lat, route.origin.lat);
        assertEquals(origin.getLoc().lon, route.origin.lon);
        assertEquals(destination.getLoc().lat, route.destination.lat);
        assertEquals(destination.getLoc().lon, route.destination.lon);
    }

    private static AmapAdapter installStubAmapAdapter() throws Exception {
        Field instField = AmapAdapter.class.getDeclaredField("inst");
        instField.setAccessible(true);
        AmapAdapter previousAdapter = (AmapAdapter) instField.get(null);
        AmapAdapter stubAdapter = new StubAmapAdapter();
        instField.set(null, stubAdapter);
        return previousAdapter;
    }

    private static void restoreAmapAdapter(AmapAdapter previousAdapter) throws Exception {
        Field instField = AmapAdapter.class.getDeclaredField("inst");
        instField.setAccessible(true);
        instField.set(null, previousAdapter);
    }

    private static class StubAmapAdapter extends AmapAdapter {

        StubAmapAdapter() {
            super(
                    false,
                    "change-me",
                    10,
                    10000,
                    86400,
                    10,
                    "build/test-amap-config.json",
                    AmapAdapter.GeocodeProvider.ADDR_RESOLVER,
                    "http://example.invalid",
                    false
            );
        }

        @Override
        public Route routing(Agent agent, POI ori, POI des) {
            return new Route(
                    ori.getLoc(),
                    des.getLoc(),
                    List.of(ori.getLoc(), des.getLoc()),
                    new Transit(1, 1),
                    0
            );
        }
    }
}
