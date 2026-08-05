package one.rewind.xforce.vehicle_routing.db.dto;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.quarkus.runtime.annotations.RegisterForReflection;
import one.rewind.xforce.geo.POI;
import one.rewind.xforce.geo.map.MapProvider;
import one.rewind.xforce.json.OM;
import one.rewind.xforce.vehicle_routing.db.repository.SolverJobRepository;
import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.domain.agent.Agent;
import one.rewind.xforce.vehicle_routing.domain.agent.AgentEachDay;
import one.rewind.xforce.vehicle_routing.domain.cost.CostParameter;
import one.rewind.xforce.vehicle_routing.domain.ticket.Ticket;
import one.rewind.xforce.vehicle_routing.exception.AgentOrTicketNotCompatible;
import one.rewind.xforce.vehicle_routing.exception.POINoWhereException;
import one.rewind.xforce.vehicle_routing.exception.POINotBuild;
import one.rewind.xforce.vehicle_routing.exception.TransitMatrixNotBuild;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.eclipse.microprofile.openapi.annotations.media.Schema;

import java.io.IOException;
import java.io.Serializable;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * 规划场景类
 */

@Schema(requiredProperties = {"name", "planning_date", "start_time", "end_time", "plan"})
@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@RegisterForReflection(serialization = true)
public class Scenario implements Serializable {

    public final static Logger logger = LogManager.getLogger(Scenario.class.getName());

    private UUID id;

    @Schema(
            description = "场景名称"
    )
    private String name;

    @Schema(
            description = "场景描述"
    )
    private String desc;

    @Schema(title = "地图服务提供商", description = "决定场景坐标及地图能力使用的图商；缺省时由当前 MAP_PROVIDER 补齐。", enumeration = {"AMAP", "HERE"})
    private MapProvider mapProvider;

    // 当前规划日期
    @JsonFormat(pattern = "yyyy-MM-dd")
    @Schema(
            description = "当前规划日期"
    )
    private LocalDate planningDate = LocalDate.now();

    // 规划开始日
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    @Schema(
            description = "规划开始日期"
    )
    private LocalDateTime startTime;

    // 规划结束日
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    @Schema(
            description = "规划结束日期"
    )
    private LocalDateTime endTime;

    @Schema(
            description = "规划方案"
    )
    private RoutePlan plan;

    @JsonFormat(pattern="yyyy-MM-dd HH:mm:ss")
    @Schema(
            description = "场景创建时间"
    )
    private LocalDateTime createTime = LocalDateTime.now();

    @JsonFormat(pattern="yyyy-MM-dd HH:mm:ss")
    @Schema(
            description = "场景更新时间"
    )
    private LocalDateTime updateTime = LocalDateTime.now();

    /**
     * 无参构造方法
     */
    public Scenario() {}

    /**
     * 构造方法
     * @param name 场景名册灰姑娘
     * @param planningDate 规划日期
     * @param schedule_interval_days 规划天数
     */
    public Scenario(String name, String desc, LocalDate planningDate, int schedule_interval_days) {
        this.name = name;
        this.desc = desc;
        this.planningDate = planningDate;
        this.startTime = planningDate.atTime(0, 0).plusDays(1);
        this.endTime = startTime.plusDays(schedule_interval_days);
        this.plan = new RoutePlan();
    }

    @JsonProperty(value = "poi_build", access = JsonProperty.Access.READ_ONLY)
    public boolean isPOIBuild() {
        if (plan == null) {
            return false;
        }
        if((plan.getDepos() != null && plan.getDepos().stream().anyMatch(d -> d == null || d.getLoc() == null || d.getLoc().isRaw()))
                || (plan.getAgents() != null && plan.getAgents().stream().anyMatch(a -> a == null || a.getStartLoc() == null || a.getStartLoc().isRaw()))
                || (plan.getTickets() != null && plan.getTickets().stream().anyMatch(t -> t == null || t.getLoc() == null || t.getLoc().isRaw()))
        ) {
            return false;
        }
        return true;
    }

    @JsonProperty(value = "matrix_build", access = JsonProperty.Access.READ_ONLY)
    public boolean isMatrixBuild() {

        if(plan == null || plan.getMatrix() == null || plan.getMatrix().data == null || plan.getMatrix().data.isEmpty()) {

            return false;
        }
        else {
            if (plan.getPois() == null) {
                return false;
            }
            for(POI p1 : plan.getPois()) {
                for(POI p2: plan.getPois()) {
                    if(plan.getMatrix().get(p1.id, p2.id).distance() == Long.MAX_VALUE) {

                        return false;
                    }
                }
            }
        }

        return true;
    }

    /**
     * RoutePlan对象
     * @return
     * @throws IOException
     * @throws POINoWhereException
     */
    @JsonIgnore
    public SolverJob getSolverJob(SolverJobRepository solverJobRepository, Duration solveTime) throws POINotBuild, TransitMatrixNotBuild {

        if(!isPOIBuild()) throw new POINotBuild();
        if(!isMatrixBuild()) throw new TransitMatrixNotBuild();

        return new SolverJob(id, name,
                LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyMMdd-HHmmss")),
                startTime,
                endTime,
                plan,
                solveTime
        );
    }

    /**
     *
     * @param rp
     * @return
     * @throws AgentOrTicketNotCompatible
     */
    public Scenario applyRoutePlan(RoutePlan rp) throws AgentOrTicketNotCompatible {

        List<String> rpAgentIds = rp.getAgents().stream().map(AgentEachDay::getId).sorted().collect(Collectors.toList());
        List<String> rpTicketIds = rp.getTickets().stream().map(Ticket::getId).sorted().collect(Collectors.toList());

        List<String> agentIds = plan.getAgents().stream().map(AgentEachDay::getId).sorted().collect(Collectors.toList());
        List<String> ticketIds = plan.getTickets().stream().map(Ticket::getId).sorted().collect(Collectors.toList());

        if(!ticketIds.equals(rpTicketIds) || !agentIds.equals(rpAgentIds)) {
            throw new AgentOrTicketNotCompatible();
        }

        setPlan(rp);

        setUpdateTime(LocalDateTime.now());

        return this;
    }

    /**
     * 序列化到文件
     * @param folderPath 文件夹路径
     */
    public void serializeTo(String folderPath) {

        try {
            Path target = Path.of(folderPath + name + ".json");
            Path parent = target.getParent();
            if (parent != null) {
                Files.createDirectories(parent);
            }
            Files.write(target, OM.toJson(this).getBytes(StandardCharsets.UTF_8));
        } catch (IOException e) {
            logger.warn("Error serialize to JSON, ", e);
        }
    }

    @JsonIgnore
    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public LocalDate getPlanningDate() {
        return planningDate;
    }

    public void setPlanningDate(LocalDate planningDate) {
        this.planningDate = planningDate;
    }

    public LocalDateTime getStartTime() {
        return startTime;
    }

    public void setStartTime(LocalDateTime startTime) {
        this.startTime = startTime;
    }

    public LocalDateTime getEndTime() {
        return endTime;
    }

    public void setEndTime(LocalDateTime endTime) {
        this.endTime = endTime;
    }

    public RoutePlan getPlan() {
        return plan;
    }

    public void setPlan(RoutePlan plan) {
        this.plan = plan;
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

    public String getDesc() {
        return desc;
    }

    public void setDesc(String desc) {
        this.desc = desc;
    }

    public MapProvider getMapProvider() {
        return mapProvider;
    }

    public void setMapProvider(MapProvider mapProvider) {
        this.mapProvider = mapProvider;
    }

    /**
     * 添加虚拟工程师
     */
    public void addVirtualAgents() {

        getPlan().addVirtualAgents();

        /* // 场景中第一个Ticket
        var firstTicket = getPlan().getTickets().getFirst();

        if(firstTicket != null) {
            for(int i = 0; i < Duration.between(getStartTime(), getEndTime()).toDays(); i++) {

                // 规划日期中的每一天
                LocalDate d = getStartTime().plusDays(i).toLocalDate();

                // 当前没有虚拟agent
                if(getPlan().getAgents().stream().noneMatch(a -> a.isVirtual() && a.getDate().equals(d))) {

                    String name = "virtual-1";
                    Agent a = new Agent(name, name, null, firstTicket.getLoc(), new LinkedList<>(), 0, 0);
                    AgentEachDay aed = new AgentEachDay(a, d, d.atStartOfDay().toLocalTime(), d.atTime(23, 59, 59).toLocalTime());
                    aed.setVirtual(true);
                    getPlan().getAgents().add(aed);
                }
            }
        } */
    }
}
