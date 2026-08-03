package one.rewind.xforce.geo.test;

import com.fasterxml.jackson.core.JsonProcessingException;
import one.rewind.xforce.geo.POI;
import one.rewind.xforce.geo.POIStore;
import one.rewind.xforce.geo.transit.AmapTransitCalculator;
import one.rewind.xforce.geo.transit.TransitMatrix;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.util.LinkedList;
import java.util.List;

@Tag("external")
class TransitMatrixExternalTest {

    @BeforeAll
    static void requireExternalTestsEnabled() {
        one.rewind.xforce.test.support.ExternalTestSupport.requireExternalTestsEnabled();
    }

    @Test
    public void test() throws JsonProcessingException {

        POIStore ps1 = new POIStore("data/public-demo/pois_ticket.json");
        POIStore ps2 = new POIStore("data/public-demo/pois_depo.json");
        POIStore ps3 = new POIStore("data/public-demo/pois_agent_inst.json");

        List<POI> ticket_pois = ps1.select(10);
        POI ticket_poi = ticket_pois.get(0);

        List<POI> depo_pois = ps2.select(2);
        List<POI> agent_inst_pois = ps3.select(4);

        List<POI> all = new LinkedList<>(ticket_pois);
        all.addAll(agent_inst_pois);
        all.addAll(depo_pois);

        TransitMatrix tm = TransitMatrix.init(all);

        System.out.println(tm);

        for(POI depo_poi : depo_pois) {
            tm.put(ticket_poi.id, depo_poi.id, AmapTransitCalculator.inst().calc(ticket_poi, depo_poi));
            tm.put(depo_poi.id, ticket_poi.id, AmapTransitCalculator.inst().calc(depo_poi, ticket_poi));
        }

        System.out.println("========");
        System.out.println(tm);

        tm.amapLinearTransform(ticket_poi, agent_inst_pois, all, 2);

        // 2.3 其他工单距离修正
        tm.amapLinearTransform(ticket_poi, ticket_pois, all, 4);

        System.out.println("========");
        System.out.println(tm);

    }
}
