package one.rewind.xforce.vehicle_routing.domain.cost;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.quarkus.runtime.annotations.RegisterForReflection;
import one.rewind.xforce.geo.distance.DistanceCalculator;
import one.rewind.xforce.geo.distance.ManhattanDistanceCalculator;
import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.domain.agent.Agent;
import one.rewind.xforce.vehicle_routing.domain.agent.AgentEachDay;
import one.rewind.xforce.vehicle_routing.domain.ticket.Ticket;
import org.eclipse.microprofile.openapi.annotations.media.Schema;
import org.optaplanner.core.api.score.buildin.hardmediumsoftlong.HardMediumSoftLongScore;

import java.io.Serializable;
import java.text.DecimalFormat;
import java.util.LinkedList;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@RegisterForReflection(serialization = true)
public class CostParameter implements Serializable {

    public static DecimalFormat df = new DecimalFormat("##.0");
    public static DistanceCalculator dc = new ManhattanDistanceCalculator();

    // 起步价，或者出车费，与人工成本有关
    // 只要派出了一辆车就要支付
    @Schema(
            description = "起步价"
    )
    private double startPrice = 200;

    // 节点费
    // 配送了一个客户支付的费用
    // 与订单量有关
    @Schema(
            description = "节点费"
    )
    private double nodeFee = 0;

    // 最大超载比例
    @Schema(
            description = "最大超载比例"
    )
    private double maxOverloadRatio = 1.2;

    // 超载费
    // 车辆超载后支付的额外成本
    @Schema(
            description = "超载费"
    )
    private double overloadFee = 100;

    // 跨区阈值 (米)
    @Schema(
            description = "跨区阈值 (米)"
    )
    private double crossRegionThreshold = 100*1000;

    // 跨区费
    @Schema(
            description = "跨区费"
    )
    private double crossRegionFee = 0;

    // 保底费，单位元/车次
    @Schema(
            description = "保底费，单位元/车次"
    )
    private double guaranteedIncome = 0;

    @Schema(
            description = "限行时段内行驶的额外费用"
    )
    private double timeRestrictedTrafficCharge = 50;

    // 电费 每千瓦小时
    @Schema(
            description = "电费"
    )
    private double elecPrice = 1.5;

    // 92#汽油 每升
    @Schema(
            description = "92油费"
    )
    @JsonProperty("gas_92_price")
    private double gas92Price = 8.1;

    public CostParameter() {}

    /**
     *
     * @param startPrice
     * @param nodeFee
     * @param maxOverloadRatio
     * @param overloadFee
     * @param crossRegionThreshold
     * @param crossRegionFee
     * @param guaranteedIncome
     */
    @JsonCreator
    public CostParameter(
            @JsonProperty("start_price") double startPrice,
            @JsonProperty("node_fee") double nodeFee,
            @JsonProperty("max_overload_ratio") double maxOverloadRatio,
            @JsonProperty("overload_fee") double overloadFee,
            @JsonProperty("cross_region_threshold") double crossRegionThreshold,
            @JsonProperty("cross_region_fee") double crossRegionFee,
            @JsonProperty("guaranteed_income") double guaranteedIncome,
            @JsonProperty("time_restricted_traffic_charge") double timeRestrictedTrafficCharge,
            @JsonProperty("elec_price") double elecPrice,
            @JsonProperty("gas_92_price") double gas92Price) {

        this.startPrice = startPrice;
        this.nodeFee = nodeFee;
        this.maxOverloadRatio = maxOverloadRatio;
        this.overloadFee = overloadFee;
        this.crossRegionThreshold = crossRegionThreshold;
        this.crossRegionFee = crossRegionFee;
        this.guaranteedIncome = guaranteedIncome;
        this.timeRestrictedTrafficCharge = timeRestrictedTrafficCharge;
        this.elecPrice = elecPrice;
        this.gas92Price = gas92Price;
    }

    /**
     *
     * @param as
     * @return
     */
    public Metrics calc(List<AgentEachDay> as, HardMediumSoftLongScore score) {

        long distance_total = 0;
        long duration_total = 0;
        double cost_total = 0;
        double ton_total = 0;

        for(AgentEachDay a : as) {

            // 车辆固定成本
            cost_total += a.getFixCostDaily();

            // 里程油耗 / 电耗
            /*System.out.printf("%s, TransitLoading=%s, Distance=%dm, DrivingTime=%ds\n", a, a.getTransitLoading(), a.getTotalDrivingDistanceMeters(), a.getTotalDrivingTimeSeconds());*/
            distance_total += a.getTotalDrivingDistanceMeters();
            duration_total += a.getTotalDrivingTimeSeconds();

            cost_total += ((double) distance_total / (1000 * 100)) * (a.getFuelType() == Agent.FuelType.GAS_92 ? gas92Price : elecPrice) * a.getFuelConsumption();

            // 道路费
            cost_total += Optional.ofNullable(a.getRoutes()).orElse(new LinkedList<>()).stream().map(r -> r.tolls).mapToLong(r -> r).sum();

            // 限行罚款 每2个小时为一个计费周期
            cost_total +=  Math.ceil((double) duration_total / 7200) * this.timeRestrictedTrafficCharge * 2;

            // 起步费
            cost_total += (a.getTickets() != null && a.getTickets().size() > 0) ? startPrice: 0;

            // 超载费计算
            if(a.getTransitLoading().weight() > a.getWeight()) {
                cost_total += overloadFee;
            }

            // 跨区费计算
            Double max_distance = a.getTickets() == null ? 0 : a.getTickets().stream().map(t -> dc.distance(t.getLoc(), a.getStartLoc())).max(Double::compare).orElse(0D);
            if(max_distance > this.crossRegionThreshold) cost_total += crossRegionFee;

            // 节点费
            if (a.getTickets() != null) {
                for(Ticket t: a.getTickets()) {
                    cost_total += nodeFee;
                    ton_total += t.getWeight();
                }
            }
        }

        // Ref: http://www.wlhcc.com/wuliuchaxun/dun-gongli.html
        double cost_per_ton_per_km = ton_total == 0 ? 0 : cost_total / (( distance_total / 1000D) * ton_total );

        return new Metrics(distance_total, duration_total, ton_total, cost_total, cost_per_ton_per_km, score);
    }

    public double getStartPrice() {
        return startPrice;
    }

    public void setStartPrice(double startPrice) {
        this.startPrice = startPrice;
    }

    public double getNodeFee() {
        return nodeFee;
    }

    public void setNodeFee(double nodeFee) {
        this.nodeFee = nodeFee;
    }

    public double getMaxOverloadRatio() {
        return maxOverloadRatio;
    }

    public void setMaxOverloadRatio(double maxOverloadRatio) {
        this.maxOverloadRatio = maxOverloadRatio;
    }

    public double getOverloadFee() {
        return overloadFee;
    }

    public void setOverloadFee(double overloadFee) {
        this.overloadFee = overloadFee;
    }

    public double getCrossRegionThreshold() {
        return crossRegionThreshold;
    }

    public void setCrossRegionThreshold(double crossRegionThreshold) {
        this.crossRegionThreshold = crossRegionThreshold;
    }

    public double getCrossRegionFee() {
        return crossRegionFee;
    }

    public void setCrossRegionFee(double crossRegionFee) {
        this.crossRegionFee = crossRegionFee;
    }

    public double getGuaranteedIncome() {
        return guaranteedIncome;
    }

    public void setGuaranteedIncome(double guaranteedIncome) {
        this.guaranteedIncome = guaranteedIncome;
    }

    public double getTimeRestrictedTrafficCharge() {
        return timeRestrictedTrafficCharge;
    }

    public void setTimeRestrictedTrafficCharge(double timeRestrictedTrafficCharge) {
        this.timeRestrictedTrafficCharge = timeRestrictedTrafficCharge;
    }

    public double getElecPrice() {
        return elecPrice;
    }

    public void setElecPrice(double elecPrice) {
        this.elecPrice = elecPrice;
    }

    public double getGas92Price() {
        return gas92Price;
    }

    public void setGas92Price(double gas92Price) {
        this.gas92Price = gas92Price;
    }
}
