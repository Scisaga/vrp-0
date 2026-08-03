package one.rewind.xforce.vehicle_routing.domain.cost;

import io.quarkus.runtime.annotations.RegisterForReflection;
import org.eclipse.microprofile.openapi.annotations.media.Schema;
import org.optaplanner.core.api.score.buildin.hardmediumsoftlong.HardMediumSoftLongScore;

import java.io.Serializable;

import static one.rewind.xforce.vehicle_routing.domain.cost.CostParameter.df;

@RegisterForReflection(serialization = true)
public record Metrics(
        long distance_total, // 总里程
        long duration_total, // 总时长
        double ton_total, // 总吨数
        double cost_total, // 总成本
        double cost_per_ton_per_km, // 吨公里费
        @Schema(implementation = String.class, example = "0hard/-5medium/-79909soft") HardMediumSoftLongScore score
) implements Serializable {
    public String toString() {

        return "Distance total: " + df.format((double) distance_total/1000) + "km, " +
                "Duration total: " + df.format((double) duration_total / 3600) + "h, " +
                "Cost total: " + df.format(cost_total);
    }
}
