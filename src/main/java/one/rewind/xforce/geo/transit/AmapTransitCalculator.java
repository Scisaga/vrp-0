package one.rewind.xforce.geo.transit;

import jakarta.inject.Inject;
import one.rewind.amap.AmapAdapter;
import one.rewind.xforce.geo.POI;
import one.rewind.xforce.vehicle_routing.domain.agent.Agent;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 高德在途距离时间计算类
 */
public class AmapTransitCalculator extends TransitCalculator {

    private static AmapTransitCalculator instance;

    private static final Duration Timeout = Duration.ofDays(7);

    public static AmapTransitCalculator inst() {

        if(instance != null) return instance;

        synchronized (AmapTransitCalculator.class) {

            instance = new AmapTransitCalculator();
        }

        return instance;
    }


    // 历史Transit缓存
    private TransitMatrix cachedMatrix = new TransitMatrix();

    //
    private AmapTransitCalculator() {
    }

    public void setCachedMatrix(TransitMatrix matrix) {
        this.cachedMatrix = matrix;
    }

    public TransitMatrix getCachedMatrix() {
        return this.cachedMatrix;
    }

    /**
     *
     * @param p1 起点
     * @param p2 终点
     * @return 在途对象
     */
    public Transit calc(POI p1, POI p2) {

        // 缓存查询
        Transit cache_t = cachedMatrix.data.get(p1.id) != null ? cachedMatrix.data.get(p1.id).get(p2.id) : null;

        // 存在缓存记录且未超时
        if(cache_t != null && Duration.between(cache_t.create_time(), LocalDateTime.now()).compareTo(Timeout) < 0)
            return cache_t;

        Transit t = AmapAdapter.get().routing(p1, p2).transit;

        // 加入缓存
        cachedMatrix.put(p1.id, p2.id, t);

        return t;
    }

    /**
     *
     * @param p1 起点
     * @param p2 终点
     * @return 在途对象
     */
    public Transit calc(Agent agent, POI p1, POI p2) {

        // 缓存查询
        if(agent.getVehicleType() == Agent.VehicleType.CAR) {

            return calc(p1, p2);
        }

        return AmapAdapter.get().routing(agent, p1, p2).transit;
    }
}
