package one.rewind.xforce.vehicle_routing.db.dto;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.quarkus.runtime.annotations.RegisterForReflection;
import one.rewind.xforce.vehicle_routing.domain.cost.Metrics;
import org.eclipse.microprofile.openapi.annotations.media.Schema;

import java.time.LocalDateTime;
import java.util.UUID;

@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@RegisterForReflection(serialization = true)
@Schema(description = "求解过程的真实 Best、搜索快照或最终解记录")
public class SolutionMetrics {

    public enum RecordType {
        BEST_SOLUTION,
        SEARCH_SAMPLE,
        FINAL_SOLUTION
    }

    public UUID id;

    private Metrics metrics;

    @JsonFormat(pattern="yyyy-MM-dd HH:mm:ss")
    private LocalDateTime createTime = LocalDateTime.now();

    @Schema(description = "记录产生时的 Unix 毫秒时间戳")
    private Long recordedAtMillis = System.currentTimeMillis();

    @Schema(description = "从本次实际搜索开始到记录时刻的毫秒数")
    private Long elapsedMillis;

    @Schema(description = "仅 record_type=SEARCH_SAMPLE 时存在的搜索快照")
    private SolverSearchProgress searchProgress;

    @Schema(description = "BEST_SOLUTION 仅在得分严格改善时产生；SEARCH_SAMPLE 为至多每秒一次的搜索快照；FINAL_SOLUTION 使用搜索结束时刻")
    private RecordType recordType;

    public SolutionMetrics() {}

    @JsonCreator
    public SolutionMetrics(
            @JsonProperty("metrics") Metrics metrics,
            @JsonProperty("record_type") RecordType recordType,
            @JsonProperty("recorded_at_millis") Long recordedAtMillis,
            @JsonProperty("elapsed_millis") Long elapsedMillis,
            @JsonProperty("search_progress") SolverSearchProgress searchProgress
    ) {
        this.metrics = metrics;
        this.recordType = recordType;
        if (recordedAtMillis != null) {
            this.recordedAtMillis = recordedAtMillis;
        }
        this.elapsedMillis = elapsedMillis;
        this.searchProgress = searchProgress;
    }

    public SolutionMetrics(Metrics metrics, RecordType recordType) {
        this.metrics = metrics;
        this.recordType = recordType;
    }

    public SolutionMetrics(Metrics metrics, RecordType recordType, Long recordedAtMillis) {
        this(metrics, recordType, recordedAtMillis, null, null);
    }

    public static SolutionMetrics searchSample(
            SolverSearchProgress searchProgress,
            long recordedAtMillis,
            long elapsedMillis
    ) {
        return new SolutionMetrics(
                null,
                RecordType.SEARCH_SAMPLE,
                recordedAtMillis,
                elapsedMillis,
                searchProgress
        );
    }

    public LocalDateTime getCreateTime() {
        return createTime;
    }

    public void setCreateTime(LocalDateTime createTime) {
        this.createTime = createTime;
    }

    public Metrics getMetrics() {
        return metrics;
    }

    public void setMetrics(Metrics metrics) {
        this.metrics = metrics;
    }

    public Long getRecordedAtMillis() {
        return recordedAtMillis;
    }

    public void setRecordedAtMillis(Long recordedAtMillis) {
        this.recordedAtMillis = recordedAtMillis;
    }

    public Long getElapsedMillis() {
        return elapsedMillis;
    }

    public void setElapsedMillis(Long elapsedMillis) {
        this.elapsedMillis = elapsedMillis;
    }

    public SolverSearchProgress getSearchProgress() {
        return searchProgress;
    }

    public void setSearchProgress(SolverSearchProgress searchProgress) {
        this.searchProgress = searchProgress;
    }

    public RecordType getRecordType() {
        return recordType;
    }

    public void setRecordType(RecordType recordType) {
        this.recordType = recordType;
    }
}
