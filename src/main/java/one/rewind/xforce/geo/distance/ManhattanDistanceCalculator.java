package one.rewind.xforce.geo.distance;

import one.rewind.xforce.geo.LOC;

/**
 * 简化版大球曼哈顿距离计算类
 */
public class ManhattanDistanceCalculator implements DistanceCalculator{

    /**
     *
     * @param p1
     * @param p2
     * @return
     */
    @Override
    public double distance(LOC p1, LOC p2) {

        double jl_jd = 102834.74258026089786013677476285; // 每经度单位米;
        double jl_wd = 111712.69150641055729984301412873; // 每纬度单位米;
        double b = Math.abs((p1.lat - p2.lat) * jl_jd);
        double a = Math.abs((p1.lon - p2.lon) * jl_wd);
        return a + b; // 此处采用曼哈顿距离
        /*return Math.sqrt((a * a + b * b));*/ // 直线距离
    }
}
