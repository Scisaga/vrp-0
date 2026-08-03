package one.rewind.xforce.vehicle_routing.db.dto;

import com.fasterxml.jackson.annotation.*;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.quarkus.runtime.annotations.RegisterForReflection;
import one.rewind.xforce.json.Views;
import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.domain.cost.CostParameter;
import one.rewind.xforce.vehicle_routing.domain.cost.Metrics;
import one.rewind.xforce.vehicle_routing.solver.RoutePlanConstraintConfiguration;
import one.rewind.xforce.vehicle_routing.solver.Status;
import org.apache.logging.log4j.core.impl.ThrowableProxy;
import org.eclipse.microprofile.openapi.annotations.media.Schema;
import org.optaplanner.core.api.score.buildin.hardmediumsoftlong.HardMediumSoftLongScore;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@RegisterForReflection(serialization = true)
public class SolverJob {

    private UUID id;

    @Schema(hidden = true)
    private UUID scenarioId;

    @Schema(
            description = "场景名称"
    )
    private String scenarioName;

    // 路径规划方案
    @Schema(
            description = "路径规划方案名称"
    )
    private String name;

    // 规划开始时间
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    @Schema(
            description = "规划开始时间"
    )
    private LocalDateTime startDateTime;

    // 规划结束时间
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    @Schema(
            description = "规划结束时间"
    )
    private LocalDateTime endDateTime;

    @Schema(
            description = "规划方案"
    )
    private RoutePlan plan;

    @Schema(
            description = "求解时长"
    )
    @JsonFormat(shape = JsonFormat.Shape.STRING)
    private Duration solveTime = Duration.ofMinutes(10);

    @Schema(description = "任务提交时记录的矩阵方式元数据；当前求解阶段不会据此重建输入矩阵")
    private String matrixMode;

    @Schema(description = "任务提交时记录的矩阵构建选项元数据；当前求解阶段不会据此重建输入矩阵")
    private Boolean buildTransitMatrix;

    @Schema(
            description = "是否生成完整路线规划"
    )
    private Boolean drawRoute;

    // 求解状态
    @Schema(
            description = "求解状态"
    )
    private Status status = Status.NOT_SOLVING;

    // 求解解释
    @Schema(
            description = "求解解释"
    )
    private String scoreExplanation;

    // 求解时发成的异常
    @Schema(
            description = "求解时发生的异常"
    )
    private ThrowableProxy exception;

    private List<SolutionMetrics> solutionMetricsList = new ArrayList<>();

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private LocalDateTime createTime = LocalDateTime.now();

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private LocalDateTime updateTime = LocalDateTime.now();

    /**
     *
     */
    public SolverJob() {

    }

    @JsonCreator
    public SolverJob(
            @JsonProperty("scenario_id") UUID scenarioId,
            @JsonProperty("scenario_name") String scenarioName,
            @JsonProperty("name") String name,
            @JsonProperty("start_date_time") @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss") LocalDateTime startDateTime,
            @JsonProperty("end_date_time") @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss") LocalDateTime endDateTime,
            @JsonProperty("plan") RoutePlan plan,
            @JsonProperty("solve_time") Duration solveTime
    ) {

        this.scenarioId = scenarioId;
        this.scenarioName = scenarioName;
        this.name = name;
        this.startDateTime = startDateTime;
        this.endDateTime = endDateTime;
        this.plan = plan;
        this.solveTime = solveTime;
    }

    @JsonView(Views.Essential.class)
    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    @JsonView(Views.Essential.class)
    public String getName() {
        return name;
    }

    @JsonIgnore
    public UUID getScenarioId() {
        return scenarioId;
    }

    @JsonView(Views.Public.class)
    public String getScenarioName() {
        return scenarioName;
    }

    @JsonView(Views.Public.class)
    public LocalDateTime getStartDateTime() {
        return startDateTime;
    }

    @JsonView(Views.Public.class)
    public LocalDateTime getEndDateTime() {
        return endDateTime;
    }

    @JsonView(Views.Public.class)
    public RoutePlan getPlan() {
        return plan;
    }

    public void setPlan(RoutePlan plan) {
        this.plan = plan;
    }

    @JsonView(Views.Essential.class)
    public Duration getSolveTime() {
        return solveTime;
    }

    public void setSolveTime(Duration solveTime) {
        this.solveTime = solveTime;
    }

    @JsonView(Views.Essential.class)
    public String getMatrixMode() {
        return matrixMode;
    }

    public void setMatrixMode(String matrixMode) {
        this.matrixMode = matrixMode;
    }

    @JsonView(Views.Essential.class)
    public Boolean getBuildTransitMatrix() {
        return buildTransitMatrix;
    }

    public void setBuildTransitMatrix(Boolean buildTransitMatrix) {
        this.buildTransitMatrix = buildTransitMatrix;
    }

    @JsonView(Views.Essential.class)
    public Boolean getDrawRoute() {
        return drawRoute;
    }

    public void setDrawRoute(Boolean drawRoute) {
        this.drawRoute = drawRoute;
    }

    public void setStatus(Status status) {
        this.status = status;
    }

    @JsonView(Views.Essential.class)
    public Status getStatus() {
        return status;
    }

    @JsonView(Views.Public.class)
    public String getScoreExplanation() {
        return scoreExplanation;
    }

    public void setScoreExplanation(String scoreExplanation) {
        this.scoreExplanation = scoreExplanation;
    }

    @JsonView(Views.Public.class)
    public ThrowableProxy getException() {
        return exception;
    }

    public void setException(ThrowableProxy exception) {
        this.exception = exception;
    }

    @JsonView(Views.Public.class)
    public List<SolutionMetrics> getSolutionMetricsList() {
        return solutionMetricsList;
    }

    public void setSolutionMetricsList(List<SolutionMetrics> solutionMetricsList) {
        this.solutionMetricsList = solutionMetricsList;
    }

    @JsonView(Views.Public.class)
    @JsonIgnore
    public SolutionMetrics getSolutionMetrics() {
        return getSolutionMetrics(null);
    }

    @JsonIgnore
    public SolutionMetrics getSolutionMetrics(SolutionMetrics.RecordType recordType) {
        Metrics metrics = getMetrics();
        if (metrics == null) {
            return null;
        }
        return new SolutionMetrics(metrics, recordType);
    }

    @JsonProperty(access = JsonProperty.Access.READ_ONLY)
    @Schema(
            description = "求解得分，其中分为三个部分[hard/medium/soft]，如果hard为负，则认为没有可行解",
            /*type = SchemaType.ARRAY,*/
            implementation = String.class,
            example = "0hard/-5medium/-79909soft"
    )
    @JsonView(Views.Essential.class)
    public HardMediumSoftLongScore getScore() {
        if (plan == null) {
            return null;
        }
        return plan.getScore();
    }


    @JsonProperty(value = "cc_name", access = JsonProperty.Access.READ_ONLY)
    @JsonView(Views.Essential.class)
    public String getConstraintConfigurationName() {
        if (plan == null || plan.getConstraintConfiguration() == null) {
            return null;
        }
        return plan.getConstraintConfiguration().getName();
    }


    @JsonProperty(access = JsonProperty.Access.READ_ONLY)
    @JsonView(Views.Public.class)
    public RoutePlanConstraintConfiguration getConstraintConfiguration() {
        if (plan == null) {
            return null;
        }
        return plan.getConstraintConfiguration();
    }


    @JsonProperty(access = JsonProperty.Access.READ_ONLY)
    @JsonView(Views.Public.class)
    public CostParameter getCostParameter() {
        if (plan == null) {
            return null;
        }
        return plan.getCostParameter();
    }

    @JsonView(Views.Public.class)
    public Metrics getMetrics() {
        if (plan == null) {
            return null;
        }
        return plan.getMetrics();
    }

    @JsonView(Views.Essential.class)
    public LocalDateTime getCreateTime() {
        return createTime;
    }

    public void setCreateTime(LocalDateTime createTime) {
        this.createTime = createTime;
    }

    @JsonView(Views.Essential.class)
    public LocalDateTime getUpdateTime() {
        return updateTime;
    }

    public void setUpdateTime(LocalDateTime updateTime) {
        this.updateTime = updateTime;
    }

    /**
     *
     */
    public void removeVirtualAgents() {

        if (plan != null) {
            plan.removeVirtualAgents();
        }
    }
}
