package one.rewind.xforce.geo.transit;

import io.quarkus.runtime.annotations.RegisterForReflection;
import one.rewind.amap.AmapAdapter;
import one.rewind.xforce.geo.POI;
import one.rewind.xforce.geo.map.MapAdapter;
import one.rewind.xforce.vehicle_routing.bootstrap.Sampler;
import org.apache.commons.lang3.tuple.ImmutablePair;
import org.apache.commons.lang3.tuple.Pair;

import java.io.Serializable;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.BiFunction;
import java.util.stream.Collectors;

import static one.rewind.xforce.vehicle_routing.db.dto.Scenario.logger;

/**
 *
 */
@RegisterForReflection(serialization = true)
public class TransitMatrix implements Serializable {

    public Map<String, Map<String, Transit>> data = new ConcurrentHashMap<>();

    public TransitMatrix() {}

    /**
     * 添加 Transit 记录
     * @param ori_id 起点ID
     * @param des_id 终点ID
     * @param t 在途数据对象
     * @return 在途矩阵
     */
    public TransitMatrix put(String ori_id, String des_id, Transit t) {
        data.computeIfAbsent(ori_id, v -> new ConcurrentHashMap<>()).put(des_id, t);
        return this;
    }

    /**
     * 根据起点ID和终点ID 获取在途ID
     * @param ori_id 起点ID
     * @param des_id 终点ID
     * @return 在途数据对象
     */
    public Transit get(String ori_id, String des_id) {
        if(ori_id.equals(des_id)) return Transit.ZERO;
        return Optional.ofNullable(data.computeIfAbsent(ori_id, v->new ConcurrentHashMap<>()).get(des_id)).orElse(Transit.MAX);
    }

    /**
     * 使用Amap在途数据对在途矩阵进行修正
     * @param poi 目标POI，工单
     * @param ref_pois 参考POI列表，其他工单，工程师
     * @param n amap修正参考点
     */
    public void amapLinearTransform(POI poi, List<POI> ref_pois, List<POI> new_pois, int n) {
        AmapTransitCalculator ATC = AmapTransitCalculator.inst();
        routingLinearTransform(poi, ref_pois, new_pois, n, ATC::calc);
    }

    /** Applies the historical sampling/linear correction with the selected provider's routing function. */
    public void routingLinearTransform(POI poi, List<POI> ref_pois, List<POI> new_pois, int n,
                                       BiFunction<POI, POI, Transit> routing) {

        if(n == 0 || ref_pois.isEmpty()) return;

        // 1 距离排序
        List<Pair<POI, Transit>> ref_pois_sort = roughEstimate(poi, ref_pois);

        // 2 选择n个参考点
        List<Pair<POI, Transit>> sample_n = Sampler.sample(ref_pois_sort.stream().filter(p -> p.getValue().distance() > 1000).collect(Collectors.toList()), n);

        // 3 回程 Amap在途修正
        List<Pair<Transit, Transit>> sample_n_return = sample_n.stream()
                .map(en -> {
                    POI des_poi = en.getKey();
                    Transit t0 = en.getValue();

                    // 新POI使用高德接口计算，旧POI调用原值
                    Transit t1 = new_pois.contains(poi) || new_pois.contains(des_poi) ? routing.apply(poi, des_poi) : this.get(poi.id, des_poi.id);
                    this.put(poi.id, des_poi.id, t1);

                    return new ImmutablePair<>(t1, t0); // 高德度量 : 曼哈顿度量
                }).collect(Collectors.toList());

        // 4 去程 Amap在途修正
        List<Pair<Transit, Transit>> sample_n_departure = sample_n.stream()
                .map(en -> {
                    POI ori_poi = en.getKey();
                    Transit t0 = en.getValue();

                    // 新POI使用高德接口计算，旧POI调用原值
                    Transit t1 = new_pois.contains(poi) || new_pois.contains(ori_poi) ? routing.apply(ori_poi, poi) : this.get(ori_poi.id, poi.id);
                    this.put(ori_poi.id, poi.id, t1);

                    return new ImmutablePair<>(t1, t0);
                }).collect(Collectors.toList());

        if(ref_pois.size() == 1) return;

        // 5 对其他POI在途消耗进行比例变换
        ref_pois_sort.forEach(en -> {

            POI ref_poi = en.getKey();
            Transit t0 = en.getValue();

            // 找到回程参考点
            Optional<Pair<Transit, Transit>> p_returnOptional = sample_n_return.stream()
                    .min(Comparator.comparing(p -> Math.abs(p.getRight().distance() - t0.distance())));

            // 回程
            if (p_returnOptional.isPresent()) {
                Pair<Transit, Transit> p_return = p_returnOptional.get();
                long distance_m = linear(t0.distance(), p_return.getValue().distance(), p_return.getKey().distance());
                long duration_m = linear(t0.distance(), p_return.getValue().distance(), p_return.getKey().duration());
                this.put(poi.id, ref_poi.id, new Transit(distance_m, duration_m));
            }

            // 找到去程参考点
            Optional<Pair<Transit, Transit>> p_departureOptional = sample_n_departure.stream()
                    .min(Comparator.comparing(p -> Math.abs(p.getRight().distance() - t0.distance())));

            // 去程
            if (p_departureOptional.isPresent()) {
                Pair<Transit, Transit> p_departure = p_departureOptional.get();
                long distance_d = linear(t0.distance(), p_departure.getValue().distance(), p_departure.getKey().distance());
                long duration_d = linear(t0.distance(), p_departure.getValue().distance(), p_departure.getKey().duration());
                this.put(ref_poi.id, poi.id, new Transit(distance_d, duration_d));
            }

            // logger.info("{} {} [{} {} {}] => {} <= {}", poi.id, ref_poi.id, t0, p_return, p_departure, new Transit(distance_m, duration_m), new Transit(distance_d, duration_d));
        });

    }

    /**
     * 粗算 p0 到 pois 列表的距离，并进行排序
     * @param p0 目标点
     * @param pois 参考点
     * @return 排序后的Transit列表
     */
    public static List<Pair<POI, Transit>> roughEstimate(POI p0, List<POI> pois) {

        TransitCalculator TC = new TransitCalculator();

        return pois.stream()
                .map(p -> {
                    Transit t = p == p0 ? new Transit(0, 0) : TC.calc(p0, p);
                    return new ImmutablePair<>(p, t);
                })
                .sorted(Comparator.comparingDouble(p -> p.getRight().distance()))
                .collect(Collectors.toList());
    }

    /**
     * (a / b) * c
     * @return
     */
    public static long linear(long a, long b, long c) {
        return (long) ( (double) a / b  * c );
    }

    @Override
    public String toString() {

        return this.data.values().stream().map(
            v -> v.values().stream()
                .map(Transit::toString)
                .collect(Collectors.joining("\t"))
        )
        .collect(Collectors.joining("\n"));
    }

    /**
     *
     * @param pois
     * @return
     */
    public static TransitMatrix init(List<POI> pois) {

        TransitCalculator TC = new TransitCalculator();

        TransitMatrix tm = new TransitMatrix();

        for(POI p1 : pois) {
            for(POI p2 : pois) {
                Transit transit = p1 == p2 ? new Transit(0, 0) : TC.calc(p1, p2);
                tm.put(p1.id, p2.id, transit);
            }
        }

        return tm;
    }

}
