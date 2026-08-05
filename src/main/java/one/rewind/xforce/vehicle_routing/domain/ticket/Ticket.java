package one.rewind.xforce.vehicle_routing.domain.ticket;

import com.fasterxml.jackson.annotation.*;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.quarkus.runtime.annotations.RegisterForReflection;
import one.rewind.xforce.geo.POI;
import one.rewind.xforce.geo.transit.TransitMatrix;
import one.rewind.xforce.json.DeduplicateObjectIdResolver;
import one.rewind.xforce.vehicle_routing.bootstrap.SKUSupplier;
import one.rewind.xforce.vehicle_routing.domain.agent.Agent;
import one.rewind.xforce.vehicle_routing.domain.agent.AgentEachDay;
import one.rewind.xforce.vehicle_routing.solver.ArrivalTimeUpdatingVariableListener;
import org.eclipse.microprofile.openapi.annotations.enums.SchemaType;
import org.eclipse.microprofile.openapi.annotations.media.Schema;
import org.eclipse.microprofile.openapi.annotations.media.SchemaProperty;
import org.optaplanner.core.api.domain.entity.PlanningEntity;
import org.optaplanner.core.api.domain.lookup.PlanningId;
import org.optaplanner.core.api.domain.variable.InverseRelationShadowVariable;
import org.optaplanner.core.api.domain.variable.NextElementShadowVariable;
import org.optaplanner.core.api.domain.variable.PreviousElementShadowVariable;
import org.optaplanner.core.api.domain.variable.ShadowVariable;

import java.io.Serializable;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.*;

/**
 * 工单类
 * - 上一级工单完成后，当前工单才能执行
 */
@Schema(
        requiredProperties = {"id", "type"},
        properties = {
                @SchemaProperty(
                        name = "loc",
                        description = "客户位置。可传 plan.pois 中 POI 的 ID 字符串，或直接传 POI 对象。",
                        oneOf = {String.class, POI.class},
                        example = "B0G2X7N5D2"
                )
        }
)
@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@JsonIdentityInfo(
        scope = Ticket.class,
        generator = ObjectIdGenerators.PropertyGenerator.class,
        property = "id",
        resolver = DeduplicateObjectIdResolver.class
)
@PlanningEntity
/*(difficultyWeightFactoryClass = DepotAngleTicketDifficultyWeightFactory.class)*/
@RegisterForReflection(serialization = true)
public class Ticket implements Serializable {


    public int getOriginalOrder() {
        return originalOrder;
    }

    public void setOriginalOrder(int originalOrder) {
        this.originalOrder = originalOrder;
    }

    // 类型
    @Schema(
            title = "工单类型",
            description = "可选值：Delv（配送），完成后减少车辆在途载荷；Delv_BH（返仓），完成后增加车辆在途载荷；Inst（安装），执行安装服务且不改变配送载荷。"
    )
    public enum Type {
        Delv, // 配送
        Delv_BH, // 返仓
        Inst, // 安装
    }

    // 工单状态
    @Schema(
            title = "工单状态",
            description = "可选值：New（新生成），尚未指派；Assigned（已指派），已分配工程师；Accepted（已接受），工程师已接单；Transit（在途），正在前往现场；Working（工作中），正在服务；Agent_Done（工程师完成），等待客户确认；Done（客户确认），工单已完成。"
    )
    public enum Status {
        New,        // 新生成
        Assigned,   // 已指派
        Accepted,   // 已接受
        Transit,    // 在途
        Working,    // 工作中
        Agent_Done, // 工作完成
        Done,       // 客户确认
    }

    @PlanningId
    private String id;

    @Schema(description = "是否固定，固定的工单在规划时不改变指派")
    private boolean pinned;

    @Schema(
            description = "网点ID"
    )
    private String depoId;

    @Schema(
            title = "工单类型",
            description = "决定工单的服务业务以及在途载荷变化；求解必填。"
    )
    private Type type;

    @Schema(
            description = "工单资质要求"
    )
    private Map<String, Double> qualificationLevelsRequired = new LinkedHashMap<>();

    @Schema(
            title = "工单状态",
            description = "表示工单从生成、指派、执行到确认完成的当前业务阶段。"
    )
    private Status status = Status.New;

    @Schema(
            description = "工单所需技能"
    )
    private List<String> skillsRequired;

    @JsonIdentityReference(alwaysAsId = true)
    @Schema(
            description = "上一级工单列表",
            type = SchemaType.ARRAY,
            implementation = String.class,
            example = "[\"ticket-1\", \"ticket-2\"]"
    )
    private List<Ticket> depTickets = new LinkedList<>();

    @JsonIdentityReference(alwaysAsId = true)
    @Schema(
            description = "下一级工单列表",
            type = SchemaType.ARRAY,
            implementation = String.class,
            example = "[\"ticket-1\", \"ticket-2\"]"
    )
    private List<Ticket> refTickets = new LinkedList<>();

    @Schema(
            description = "货物信息"
    )
    private List<SKUSupplier.Item> items = new LinkedList<>();

    @Schema(
            description = "工单总重量"
    )
    private float weight;

    @Schema(
            description = "工单总体积"
    )
    private float vol;

    // 客户POI
    @JsonIdentityReference
    @Schema(hidden = true)
    private POI loc;

    @Schema(
            description = "在途矩阵句柄"
    )
    public transient TransitMatrix matrix;

    @Schema(
            description = "工单创建时间"
    )
    @JsonFormat(pattern="yyyy-MM-dd HH:mm:ss")
    private LocalDateTime createTime;

    @Schema(
            description = "客户预期上门开始时间"
    )
    @JsonFormat(pattern="yyyy-MM-dd HH:mm:ss")
    private LocalDateTime minStartTime;

    @Schema(
            description = "客户预期上门结束时间"
    )
    @JsonFormat(pattern="yyyy-MM-dd HH:mm:ss")
    private LocalDateTime maxEndTime;

    @Schema(
            description = "完成时间，单位：分钟"
    )
    @JsonFormat(shape = JsonFormat.Shape.STRING)
    // 完成时间，单位：分钟
    private Duration duration;

    // 指派对象
    @JsonIdentityReference(alwaysAsId = true)
    @Schema(
            description = "当前指派Agent ID",
            type = SchemaType.STRING,
            implementation = String.class,
            example = "agent-1"
    )
    private AgentEachDay agent;

    @JsonIdentityReference(alwaysAsId = true)
    @Schema(
            description = "原指派Agent ID",
            type = SchemaType.STRING,
            implementation = String.class,
            example = "agent-1"
    )
    private AgentEachDay originalAgent;

    @JsonIdentityReference(alwaysAsId = true)
    @Schema(description = "原指派顺序")
    private int originalOrder;

    @JsonIdentityReference(alwaysAsId = true)
    @Schema(
            description = "Agent完成的上一个Ticket ID",
            type = SchemaType.STRING,
            implementation = String.class,
            example = "ticket-1"
    )
    private Ticket previousTicket;

    @JsonIdentityReference(alwaysAsId = true)
    @Schema(
            description = "Agent完成的下一个Ticket ID",
            type = SchemaType.STRING,
            implementation = String.class,
            example = "ticket-1"
    )
    private Ticket nextTicket;


    @Schema(description = "到达工单地点时间")
    @JsonFormat(pattern="yyyy-MM-dd HH:mm:ss")
    private LocalDateTime arrivalTime;


    @Schema(description = "预期改约时间")
    @JsonFormat(pattern="yyyy-MM-dd HH:mm:ss")
    private LocalDateTime reassignTime;


    @Schema(description = "预期取消时间")
    @JsonFormat(pattern="yyyy-MM-dd HH:mm:ss")
    private LocalDateTime cancelTime;

    /**
     *
     */
    public Ticket() {}

    /**
     *
     * @param id
     * @param type
     * @param skillsRequired
     * @param weight
     * @param vol
     * @param loc
     * @param createTime
     * @param minStartTime
     * @param maxEndTime
     */
    public Ticket(String id, String depoId, boolean pinned, Type type, List<String> skillsRequired, float weight, float vol, POI loc, LocalDateTime createTime, LocalDateTime minStartTime, LocalDateTime maxEndTime) {

        this.id = id;
        this.depoId = depoId;
        this.pinned = pinned;
        this.type = type;
        this.skillsRequired = skillsRequired;
        this.loc = loc;
        this.createTime = createTime;
        this.minStartTime = minStartTime;
        this.maxEndTime = maxEndTime;
        this.duration = estimateDuration(); // TODO 应该移到单独的工具类中
        this.weight = weight;
        this.vol = vol;
    }

    /**
     *
     * @param id 工单ID
     * @param type 工单类型
     * @param skillsRequired 工单所需节能
     * @param items 货物信息
     * @param loc 客户POI
     * @param createTime 创建时间
     * @param minStartTime 配送时间窗开始时间
     * @param maxEndTime 配送时间窗结束时间
     */
    public Ticket(String id, String depoId, boolean pinned, Type type, List<String> skillsRequired, List<SKUSupplier.Item> items, POI loc, LocalDateTime createTime, LocalDateTime minStartTime, LocalDateTime maxEndTime) {

        this(id, depoId, pinned, type, skillsRequired, 0f, 0f, loc, createTime, minStartTime, maxEndTime);
        this.items = items;
        var wv = SKUSupplier.estimateWeightAndVol(items);
        this.weight = wv.weight();
        this.vol = wv.vol();
    }

    public String getId() {
        return id;
    }

    public String getDepoId() {
        return depoId;
    }

    public void setDepoId(String depoId) {
        this.depoId = depoId;
    }

    public boolean isPinned() {
        return pinned;
    }

    public void setPinned(boolean pinned) {
        this.pinned = pinned;
    }

    // Agent
    @JsonIdentityReference(alwaysAsId = true)
    @InverseRelationShadowVariable(sourceVariableName = "tickets")
    public AgentEachDay getAgent() {
        return agent;
    }

    public void setAgent(AgentEachDay agent) {
        this.agent = agent;
    }

    @JsonIdentityReference(alwaysAsId = true)
    @PreviousElementShadowVariable(sourceVariableName = "tickets")
    public Ticket getPreviousTicket() {
        return previousTicket;
    }

    public void setPreviousTicket(Ticket previousTicket) {
        this.previousTicket = previousTicket;
    }

    @JsonIdentityReference(alwaysAsId = true)
    @NextElementShadowVariable(sourceVariableName = "tickets")
    public Ticket getNextTicket() {
        return nextTicket;
    }

    public void setNextTicket(Ticket nextTicket) {
        this.nextTicket = nextTicket;
    }

    @ShadowVariable(variableListenerClass = ArrivalTimeUpdatingVariableListener.class, sourceVariableName = "agent")
    @ShadowVariable(variableListenerClass = ArrivalTimeUpdatingVariableListener.class, sourceVariableName = "previousTicket")
    public LocalDateTime getArrivalTime() {
        return arrivalTime;
    }

    public void setArrivalTime(LocalDateTime arrivalTime) {
        this.arrivalTime = arrivalTime;
    }

    // 设置预期改约时间，改约时间>完成时间，不改约
    public void setReassignTime(LocalDateTime reassignTime) {
        this.reassignTime = reassignTime;
    }

    // 设置预期取消时间，取消时间>完成时间，不取消
    public void setCancelTime(LocalDateTime cancelTime) {
        this.cancelTime = cancelTime;
    }

    /**
     *
     * @return 工单开始服务时间
     */
    @JsonProperty(access = JsonProperty.Access.READ_ONLY)
    @JsonFormat(pattern="yyyy-MM-dd HH:mm:ss")
    public LocalDateTime getStartServiceTime() {
        if (arrivalTime == null) {
            return null;
        }
        return arrivalTime.isBefore(minStartTime) ? minStartTime : arrivalTime;
    }

    /**
     *
     * @return 工单完成时间
     */
    @JsonProperty(access = JsonProperty.Access.READ_ONLY)
    @JsonFormat(pattern="yyyy-MM-dd HH:mm:ss")
    public LocalDateTime getDepartureTime() {
        if (arrivalTime == null) {
            return null;
        }

        if(getAgent() != null && getAgent().isVirtual())
            return getStartServiceTime();

        return getStartServiceTime().plus(duration);
    }

    /**
     *
     * @param duration
     */
    public void setDuration(Duration duration) {
        this.duration = duration;
    }

    /**
     *
     * @return
     */
    public Duration getDuration() {
        return this.duration;
    }

    public void setId(String id) {
        this.id = id;
    }

    public Type getType() {
        return type;
    }

    public void setType(Type type) {
        this.type = type;
    }

    public List<SKUSupplier.Item> getItems() {
        return items;
    }

    public void setItems(List<SKUSupplier.Item> items) {
        this.items = items;
    }

    @JsonIdentityReference
    public POI getLoc() {
        return loc;
    }

    public void setLoc(POI loc) {
        this.loc = loc;
    }

    public LocalDateTime getMinStartTime() {
        return minStartTime;
    }

    public void setMinStartTime(LocalDateTime minStartTime) {
        this.minStartTime = minStartTime;
    }

    public LocalDateTime getMaxEndTime() {
        return maxEndTime;
    }

    public void setMaxEndTime(LocalDateTime maxEndTime) {
        this.maxEndTime = maxEndTime;
    }

    @JsonIdentityReference(alwaysAsId = true)
    public AgentEachDay getOriginalAgent() {
        return originalAgent;
    }

    public LocalDateTime getReassignTime() {
        return reassignTime;
    }

    public LocalDateTime getCancelTime() {
        return cancelTime;
    }

    public void setWeight(float weight) {
        this.weight = weight;
    }

    public float getWeight() {
        return this.weight;
    }

    public void setVol(float vol) {
        this.vol = vol;
    }

    public float getVol() {
        return this.vol;
    }

    public void setOriginalAgent(AgentEachDay originalAgent) {
        this.originalAgent = originalAgent;
    }

    public Status getStatus() {
        return status;
    }

    public void setStatus(Status status) {
        this.status = status;
    }

    public List<String> getSkillsRequired() {
        return skillsRequired;
    }

    public void setSkillsRequired(List<String> skillsRequired) {
        this.skillsRequired = skillsRequired;
    }

    public List<Ticket> getDepTickets() {
        return depTickets;
    }

    public void setDepTickets(List<Ticket> depTickets) {
        this.depTickets = depTickets;
    }

    public List<Ticket> getRefTickets() {
        return refTickets;
    }

    public void setRefTickets(List<Ticket> refTickets) {
        this.refTickets = refTickets;
    }

    public LocalDateTime getCreateTime() {
        return createTime;
    }

    public void setCreateTime(LocalDateTime createTime) {
        this.createTime = createTime;
    }

    public Map<String, Double> getQualificationLevelsRequired() {
        return qualificationLevelsRequired;
    }

    public void setQualificationLevelsRequired(Map<String, Double> qualificationLevelsRequired) {
        this.qualificationLevelsRequired = qualificationLevelsRequired;
    }

    /**
     *
     * @return 工单是否超时
     */
    @JsonIgnore
    public boolean isServiceFinishedAfterMaxEndTime() {
        return arrivalTime != null
                && arrivalTime.plus(duration).isAfter(maxEndTime);
    }

    /**
     * 计算延迟时间
     * @return 工单晚于最迟交付时间 单位：分钟
     */
    @JsonIgnore
    public long getServiceFinishedDelayInMinutes() {
        if (arrivalTime == null) {
            return 0;
        }
        long minutes = Duration.between(maxEndTime, arrivalTime.plus(duration)).toMinutes();
        /*logger.info("{} {} {}", id, maxEndTime, arrivalTime);*/
        return minutes;
    }

    /**
     *
     * @return 从上一地点到当前客户的用时
     */
    @JsonIgnore
    public long getDrivingTimeSecondsFromPreviousStandstill()  {

        if(matrix == null) return 0;
        if (agent == null) {
            throw new IllegalStateException(
                    "This method must not be called when the shadow variables are not initialized yet.");
        }
        if (previousTicket == null) {
            return matrix.get(agent.getStartLoc().id, loc.id).duration();
        }
        return matrix.get(previousTicket.loc.id, loc.id).duration();
    }

    /**
     * Required by the web UI even before the solution has been initialized.
     * @return
     */
    @JsonProperty(value = "drivingTimeSecondsFromPreviousStandstill", access = JsonProperty.Access.READ_ONLY)
    public Long getDrivingTimeSecondsFromPreviousStandstillOrNull() {
        if (agent == null) {
            return null;
        }
        return getDrivingTimeSecondsFromPreviousStandstill();
    }

    /**
     * 仅判断是否在 agent 之间变动
     * TODO 需要进一步调整
     * @return
     */
    @JsonProperty(value = "moved", access = JsonProperty.Access.READ_ONLY)
    public boolean isMoved() {
        return originalAgent != null && !originalAgent.isVirtual() &&
                ( !originalAgent.getId().equals(agent.getId()));
    }

    /**
     * 计算工单用时
     * @return
     */
    public Duration estimateDuration() {

        if(items!= null && !items.isEmpty()) {
            return Duration.of(
                    items.stream()
                            .map(v -> v.value() * switch(type) {
                                case Inst -> 10;
                                default -> 5;
                            })
                            .reduce(0L, Long::sum),
                    ChronoUnit.MINUTES
            );
        }
        else {
            float f = type == Ticket.Type.Inst ? 2 : 1;
            return Duration.of(Math.round(Math.ceil(weight) * 5 * f) + 5, ChronoUnit.MINUTES);
        }
    }

    /**
     *
     * @return 序列化结果
     */
    public String toString() {

        DateTimeFormatter df = DateTimeFormatter.ofPattern("MM/dd-HH:mm");

        return String.format("%s %s %s %s exp[%s, %s] -> act[%s, %s] reassign=%s cancel=%s",
                id,
                type,
                loc.address != null ? loc.address : loc.loc,
                new Agent.Capacity(weight, vol),
                minStartTime.format(df),
                maxEndTime.format(df),
                getStartServiceTime() != null ? getStartServiceTime().format(df) : null,
                getDepartureTime() != null ? getDepartureTime().format(df) : null,
                reassignTime != null ? reassignTime.format(df) : null,
                cancelTime != null ? cancelTime.format(df): null);
    }
}
