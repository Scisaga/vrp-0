package one.rewind.xforce.geo.distance;

import one.rewind.xforce.geo.LOC;
import one.rewind.xforce.geo.POI;

/**
 * 距离计算接口
 */
public interface DistanceCalculator {

    /**
     *
     * @param p1
     * @param p2
     * @return
     */
    double distance(LOC p1, LOC p2);

    default double distance(POI p1, POI p2) {
        return distance(p1.getEntrLoc(), p2.getEntrLoc());
    }

}
