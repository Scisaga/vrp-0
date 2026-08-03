package one.rewind.xforce.geo.distance;

import one.rewind.xforce.geo.LOC;

import static java.lang.Math.ceil;
import static java.lang.Math.sqrt;

/**
 * 简化版大球欧式距离计算类
 */
public class EuclideanDistanceCalculator implements DistanceCalculator {

    // Approximate Metric Equivalents for Degrees. At the equator for longitude and for latitude anywhere,
    // the following approximations are valid: 1° = 111 km (or 60 nautical miles) 0.1° = 11.1 km.
    public static final long METERS_PER_DEGREE = 111_000;

    @Override
    public double distance(LOC p1, LOC p2) {
        if (p1.equals(p2)) {
            return 0L;
        }
        double latitudeDiff = p1.getLat() - p2.getLat();
        double longitudeDiff = p1.getLon() - p2.getLon();
        return (long) ceil(sqrt(latitudeDiff * latitudeDiff + longitudeDiff * longitudeDiff) * METERS_PER_DEGREE);
    }
}