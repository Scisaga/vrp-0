package one.rewind.xforce.geo.transit;

import one.rewind.xforce.geo.LOC;
import one.rewind.xforce.geo.distance.DistanceCalculator;
import one.rewind.xforce.geo.distance.ManhattanDistanceCalculator;
import one.rewind.xforce.geo.POI;
import one.rewind.xforce.vehicle_routing.domain.agent.Agent;

/**
 * 在途距离时间计算类
 */
public class TransitCalculator {

    DistanceCalculator dc = new ManhattanDistanceCalculator();

    /**
     * 在途距离时间计算
     * @param p1 起点
     * @param p2 终点
     * @return 在途距离时间
     */
    public Transit calc(LOC p1, LOC p2) {

        long distance = (long) dc.distance(p1, p2);

        // 时速估算
        double f = distance >= 30000 ? 60 :
                distance >= 20 ? 45 :
                distance >= 10 ? 30 :
                distance >= 5 ?  20 :
                15;

        long duration = (long) (distance * 3600D / (f * 1000));
        return new Transit(distance, duration);
    }

    /**
     * 在途距离时间计算
     * @param p1 起点 POI
     * @param p2 起点 POI
     * @return 在途距离时间
     */
    public Transit calc(POI p1, POI p2) {
        return calc(p1.getEntrLoc(), p2.getEntrLoc());
    }

}
