package one.rewind.xforce.vehicle_routing.db.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.quarkus.runtime.annotations.RegisterForReflection;
import org.eclipse.microprofile.openapi.annotations.media.Schema;

/** 一次求解过程采样的只读得分数据。 */
@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@RegisterForReflection(serialization = true)
@Schema(description = "求解过程搜索快照")
public record SolverSearchProgress(
        @Schema(description = "最近完成搜索步骤的得分", example = "0hard/-58medium/-4612soft")
        String currentScore,
        @Schema(description = "截至当前的历史最优得分", example = "0hard/-54medium/-4341soft")
        String bestScore
) {
    public boolean hasAnyValue() {
        return currentScore != null
                || bestScore != null;
    }
}
