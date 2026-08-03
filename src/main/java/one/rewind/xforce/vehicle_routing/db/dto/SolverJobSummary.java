package one.rewind.xforce.vehicle_routing.db.dto;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.quarkus.runtime.annotations.RegisterForReflection;
import one.rewind.xforce.vehicle_routing.solver.Status;
import org.eclipse.microprofile.openapi.annotations.media.Schema;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.UUID;

@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@RegisterForReflection(serialization = true)
public class SolverJobSummary {

    private UUID id;
    private String scenarioName;
    private String name;
    private Status status;
    @JsonFormat(shape = JsonFormat.Shape.STRING)
    private Duration solveTime;
    private String matrixMode;
    private Boolean buildTransitMatrix;
    private Boolean drawRoute;

    @Schema(
            description = "当前最佳或最终求解得分，分为 hard/medium/soft 三部分",
            example = "0hard/-5medium/-79909soft"
    )
    private String score;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private LocalDateTime createTime;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private LocalDateTime updateTime;

    public SolverJobSummary() {
    }

    public SolverJobSummary(
            UUID id,
            String scenarioName,
            String name,
            Status status,
            Duration solveTime,
            String matrixMode,
            Boolean buildTransitMatrix,
            Boolean drawRoute,
            String score,
            LocalDateTime createTime,
            LocalDateTime updateTime
    ) {
        this.id = id;
        this.scenarioName = scenarioName;
        this.name = name;
        this.status = status;
        this.solveTime = solveTime;
        this.matrixMode = matrixMode;
        this.buildTransitMatrix = buildTransitMatrix;
        this.drawRoute = drawRoute;
        this.score = score;
        this.createTime = createTime;
        this.updateTime = updateTime;
    }

    public static SolverJobSummary from(SolverJob job) {
        if (job == null) {
            return null;
        }
        return new SolverJobSummary(
                job.getId(),
                job.getScenarioName(),
                job.getName(),
                job.getStatus(),
                job.getSolveTime(),
                job.getMatrixMode(),
                job.getBuildTransitMatrix(),
                job.getDrawRoute(),
                job.getScore() == null ? null : job.getScore().toString(),
                job.getCreateTime(),
                job.getUpdateTime()
        );
    }

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public String getScenarioName() {
        return scenarioName;
    }

    public void setScenarioName(String scenarioName) {
        this.scenarioName = scenarioName;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public Status getStatus() {
        return status;
    }

    public void setStatus(Status status) {
        this.status = status;
    }

    public Duration getSolveTime() {
        return solveTime;
    }

    public void setSolveTime(Duration solveTime) {
        this.solveTime = solveTime;
    }

    public String getMatrixMode() {
        return matrixMode;
    }

    public void setMatrixMode(String matrixMode) {
        this.matrixMode = matrixMode;
    }

    public Boolean getBuildTransitMatrix() {
        return buildTransitMatrix;
    }

    public void setBuildTransitMatrix(Boolean buildTransitMatrix) {
        this.buildTransitMatrix = buildTransitMatrix;
    }

    public Boolean getDrawRoute() {
        return drawRoute;
    }

    public void setDrawRoute(Boolean drawRoute) {
        this.drawRoute = drawRoute;
    }

    public String getScore() {
        return score;
    }

    public void setScore(String score) {
        this.score = score;
    }

    public LocalDateTime getCreateTime() {
        return createTime;
    }

    public void setCreateTime(LocalDateTime createTime) {
        this.createTime = createTime;
    }

    public LocalDateTime getUpdateTime() {
        return updateTime;
    }

    public void setUpdateTime(LocalDateTime updateTime) {
        this.updateTime = updateTime;
    }

}
