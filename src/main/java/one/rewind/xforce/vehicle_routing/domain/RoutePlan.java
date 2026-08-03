package one.rewind.xforce.vehicle_routing.domain;

import com.fasterxml.jackson.annotation.*;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.quarkus.runtime.annotations.RegisterForReflection;
import one.rewind.xforce.geo.POI;
import one.rewind.xforce.geo.transit.TransitMatrix;
import one.rewind.xforce.json.OM;
import one.rewind.xforce.vehicle_routing.domain.agent.Agent;
import one.rewind.xforce.vehicle_routing.domain.agent.AgentEachDay;
import one.rewind.xforce.vehicle_routing.domain.agent.Depo;
import one.rewind.xforce.vehicle_routing.domain.cost.CostParameter;
import one.rewind.xforce.vehicle_routing.domain.cost.Metrics;
import one.rewind.xforce.vehicle_routing.domain.ticket.SKU;
import one.rewind.xforce.vehicle_routing.domain.ticket.Ticket;
import one.rewind.xforce.vehicle_routing.solver.RoutePlanConstraintConfiguration;
import org.eclipse.microprofile.openapi.annotations.media.Schema;
import org.jboss.logging.Logger;
import org.optaplanner.core.api.domain.constraintweight.ConstraintConfigurationProvider;
import org.optaplanner.core.api.domain.solution.PlanningEntityCollectionProperty;
import org.optaplanner.core.api.domain.solution.PlanningScore;
import org.optaplanner.core.api.domain.solution.PlanningSolution;
import org.optaplanner.core.api.domain.solution.ProblemFactCollectionProperty;
import org.optaplanner.core.api.domain.valuerange.ValueRangeProvider;
import org.optaplanner.core.api.score.buildin.hardmediumsoftlong.HardMediumSoftLongScore;

import java.io.IOException;
import java.io.Serializable;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedList;
import java.util.List;
import java.util.stream.Collectors;

/**
 * 规划方案类
 */

@Schema(requiredProperties = {"depos", "agents", "tickets"})
@PlanningSolution
@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@RegisterForReflection(serialization = true)
public class RoutePlan implements Serializable {

    public final static Logger logger = Logger.getLogger(RoutePlan.class);

    @ProblemFactCollectionProperty
    @JsonProperty(index = 1)
    private List<SKU> skus = new ArrayList<>();

    @ProblemFactCollectionProperty
    @JsonProperty(index = 2)
    @Schema(
            description = "地址信息"
    )
    private List<POI> pois = new ArrayList<>();

    @ProblemFactCollectionProperty
    @JsonProperty(index = 3)
    @Schema(
            description = "仓库地址"
    )
    private List<Depo> depos = new ArrayList<>();

    // Agent列表
    @PlanningEntityCollectionProperty
    @JsonProperty(index = 4)
    @Schema(
            description = "工程师/车辆列表"
    )
    private List<AgentEachDay> agents = new ArrayList<>();

    // 工单列表
    @ProblemFactCollectionProperty
    @ValueRangeProvider
    @JsonProperty(index = 5)
    @Schema(
            description = "工单列表"
    )
    private List<Ticket> tickets = new ArrayList<>();

    // 迁移矩阵
    @JsonProperty(index = 6)
    @Schema(
            description = "迁移矩阵"
    )
    private TransitMatrix matrix = new TransitMatrix();

    @ConstraintConfigurationProvider
    @JsonProperty(index = 7)
    @Schema(
            description = "约束配置项"
    )
    private RoutePlanConstraintConfiguration constraintConfiguration = new RoutePlanConstraintConfiguration();

    @JsonProperty(index = 8)
    @Schema(
            description = "成本参数"
    )
    private CostParameter costParameter = new CostParameter();

    // 规划评分
    @PlanningScore
    @JsonProperty(index = 9)
    @Schema(description = "规划评分", implementation = String.class, example = "0hard/-5medium/-79909soft")
    private HardMediumSoftLongScore score;


    @JsonProperty(index = 10)
    @Schema(description = "求解解释，内部字段，不需要传参")
    private String scoreExplanation;

    public RoutePlan() {}

    /**
     *
     * @param depos
     * @param agents
     * @param tickets
     * @param matrix
     * @param constraintConfiguration
     * @param costParameter
     */
    @JsonCreator
    public RoutePlan(
            @JsonProperty("skus") List<SKU> skus,
            @JsonProperty("depos") List<Depo> depos,
            @JsonProperty("agents") List<AgentEachDay> agents,
            @JsonProperty("tickets") List<Ticket> tickets,
            @JsonProperty("matrix") TransitMatrix matrix,
            @JsonProperty("constraint_configuration") RoutePlanConstraintConfiguration constraintConfiguration,
            @JsonProperty("cost_parameter") CostParameter costParameter

    ) {
        this.skus = skus;
        this.depos = depos;
        this.agents = agents;
        this.tickets = tickets;
        this.matrix = matrix;
        this.constraintConfiguration = constraintConfiguration;
        this.costParameter = costParameter;

        /*logger.info("depos: " + depos.size());
        logger.info("agents: " + agents.size());
        logger.info("tickets: " + tickets.size());*/

        init();
    }

    /**
     * 统计可用工程师数量
     * @param planningStart 规划开始时间
     * @param planningEnd 规划结束时间
     * @param interval 区间长度
     * @return 每个时间段可用工程师数量，包含起止时间
     */
    public List<AvailableAgentWindow> getAvailableAgentsCount(LocalDateTime planningStart, LocalDateTime planningEnd, Duration interval) {
        if (planningStart == null || planningEnd == null || interval == null) {
            return Collections.emptyList();
        }
        if (!planningEnd.isAfter(planningStart)) {
            return Collections.emptyList();
        }

        long stepSeconds = interval.getSeconds();
        if (stepSeconds <= 0) {
            return Collections.emptyList();
        }

        long totalSeconds = Duration.between(planningStart, planningEnd).getSeconds();
        long slotCount = (totalSeconds + stepSeconds - 1) / stepSeconds;

        List<AvailableAgentWindow> result = new ArrayList<>();
        for (int i = 0; i < slotCount; i++) {
            LocalDateTime slotStart = planningStart.plusSeconds(stepSeconds * i);
            LocalDateTime slotEnd = slotStart.plusSeconds(stepSeconds);
            if (slotEnd.isAfter(planningEnd)) {
                slotEnd = planningEnd;
            }

            int availableAgents = 0;
            for (AgentEachDay agent : agents) {
                if (isAgentAvailable(agent, slotStart, slotEnd)) {
                    availableAgents++;
                }
            }
            result.add(new AvailableAgentWindow(slotStart, slotEnd, availableAgents));
        }

        return result;
    }

    private boolean isAgentAvailable(AgentEachDay agent, LocalDateTime slotStart, LocalDateTime slotEnd) {
        if (agent == null || agent.isVirtual()) {
            return false;
        }
        LocalDateTime shiftStart = agent.getShiftStartTime();
        LocalDateTime shiftOff = agent.getShiftOffTime();

        if (shiftStart == null || shiftOff == null) {
            return false;
        }

        LocalDateTime intervalStart = slotStart.isAfter(shiftStart) ? slotStart : shiftStart;
        LocalDateTime intervalEnd = slotEnd.isBefore(shiftOff) ? slotEnd : shiftOff;

        if (!intervalStart.isBefore(intervalEnd)) {
            return false;
        }

        List<TimeWindow> busyWindows = buildBusyWindows(agent);
        for (TimeWindow busy : busyWindows) {
            if (intervalsOverlap(intervalStart, intervalEnd, busy)) {
                return false;
            }
        }
        return true;
    }

    private boolean intervalsOverlap(LocalDateTime start, LocalDateTime end, TimeWindow window) {
        return start.isBefore(window.end()) && end.isAfter(window.start());
    }

    private List<TimeWindow> buildBusyWindows(AgentEachDay agent) {
        if (agent.getTickets() == null || agent.getTickets().isEmpty()) {
            return Collections.emptyList();
        }

        LocalDateTime shiftStart = agent.getShiftStartTime();
        LocalDateTime shiftOff = agent.getShiftOffTime();

        List<Ticket> ticketsOrdered = new ArrayList<>(agent.getTickets());
        ticketsOrdered.sort(Comparator.comparing(t -> {
            LocalDateTime arrival = t.getArrivalTime();
            if (arrival != null) return arrival;
            LocalDateTime minStart = t.getMinStartTime();
            if (minStart != null) return minStart;
            return shiftStart;
        }));

        List<TimeWindow> windows = new ArrayList<>();
        LocalDateTime travelStart = shiftStart;

        for (Ticket ticket : ticketsOrdered) {
            LocalDateTime departureTime = ticket.getDepartureTime();
            if (departureTime == null) {
                return shiftStart == null || shiftOff == null
                        ? Collections.emptyList()
                        : List.of(new TimeWindow(shiftStart, shiftOff));
            }

            LocalDateTime start = travelStart != null ? travelStart : shiftStart;
            LocalDateTime windowStart = start.isAfter(shiftStart) ? start : shiftStart;
            LocalDateTime windowEnd = departureTime.isBefore(shiftOff) ? departureTime : shiftOff;

            if (windowStart != null && windowEnd != null && windowStart.isBefore(windowEnd)) {
                windows.add(new TimeWindow(windowStart, windowEnd));
            }
            travelStart = departureTime;
        }

        if (!windows.isEmpty()) {
            LocalDateTime doneTime = agent.getTicketsDoneTime();
            if (doneTime != null) {
                LocalDateTime cappedDone = shiftOff != null && doneTime.isAfter(shiftOff) ? shiftOff : doneTime;
                TimeWindow last = windows.get(windows.size() - 1);
                if (cappedDone.isAfter(last.end())) {
                    windows.set(windows.size() - 1, new TimeWindow(last.start(), cappedDone));
                }
            }
        }

        return mergeWindows(windows);
    }

    private List<TimeWindow> mergeWindows(List<TimeWindow> windows) {
        if (windows.isEmpty()) {
            return windows;
        }

        List<TimeWindow> sorted = windows.stream()
                .sorted(Comparator.comparing(TimeWindow::start))
                .collect(Collectors.toList());

        LinkedList<TimeWindow> merged = new LinkedList<>();
        for (TimeWindow current : sorted) {
            if (merged.isEmpty()) {
                merged.add(current);
                continue;
            }

            TimeWindow last = merged.getLast();
            if (!current.start().isAfter(last.end())) {
                LocalDateTime mergedEnd = current.end().isAfter(last.end()) ? current.end() : last.end();
                merged.removeLast();
                merged.add(new TimeWindow(last.start(), mergedEnd));
            } else {
                merged.add(current);
            }
        }

        return merged;
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    @RegisterForReflection(serialization = true)
    public record AvailableAgentWindow(
            @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss") LocalDateTime startTime,
            @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss") LocalDateTime endTime,
            int availableAgents
    ) { }

    private record TimeWindow(LocalDateTime start, LocalDateTime end) {}

    /**
     *
     * @return
     */
    public RoutePlan init() {

        agents.forEach(a -> {
            a.matrix = matrix;
            a.costParameter = this.costParameter;

            /*// TODO 如此修改Agent ShiftStartTime会产生更多问题
            a.getTickets().stream().max(Comparator.comparing(Ticket::getDepartureTime)).map(Ticket::getDepartureTime).ifPresent(t -> {
                if (a.getShiftStartTime().isBefore(t)) a.setShiftStartTime(t);
            });*/
        });

        tickets.forEach(t -> {
            t.matrix = matrix;

            // set original agent
            if(t.getAgent() != null) {
                t.setOriginalAgent(t.getAgent());
                t.setOriginalOrder(t.getAgent().getTickets().indexOf(t));
            }
        });

        return this;
    }

    /**
     * 清空所有工单指派
     * @return 自身
     */
    public RoutePlan clearAssignments() {

        for(var a : agents) {
            a.getTickets().clear();
        }

        for(var t : tickets) {
            t.setAgent(null);
            t.setOriginalAgent(null);
            t.setArrivalTime(null);
        }
        return this;
    }

    /**
     * 将排程排线结果在终端打印
     */
    public void print() {

        long total_distance = 0;
        long total_time = 0;

        System.out.println("====== 工程师列表 ======");
        for(AgentEachDay a : agents) {
            System.out.printf("%s, TransitLoading=%s, Distance=%dm, DrivingTime=%ds\n", a, a.getTransitLoading(), a.getTotalDrivingDistanceMeters(), a.getTotalDrivingTimeSeconds());
            total_distance += a.getTotalDrivingDistanceMeters();
            total_time += a.getTotalDrivingTimeSeconds();

            for(Ticket t: a.getTickets()) {
                System.out.printf("\t%s\n", t);
                /*System.out.printf("\t\t%s %s %s %s\n", t.isServiceFinishedAfterMaxEndTime(), t.getArrival_time(), t.duration, t.max_end_time);*/
            }
        }

        System.out.println("====== 新工单 ======");
        tickets.stream().filter(t -> t.getAgent() == null).forEach(t -> System.out.printf("\t%s\n", t));

        System.out.println("====== 约束条件 ======");
        try {
            System.out.println(OM.toJson(getConstraintConfiguration()));
        } catch (JsonProcessingException e) {
            logger.error("Error serialize ConstraintConfiguration", e);
        }

        System.out.printf("Total Distance=%dm, Total Time=%ds\n", total_distance, total_time);
    }

    public void updateMinStartTimeAndMaxEndTime() {
        // FIXME 临时解决方案。AUX 会频繁修改预期上门时间，导致严重影响派单
        for(Ticket t : tickets) {
            if(t.getAgent() != null) {
                if(t.getArrivalTime().getHour() < 12) {
                    t.setMinStartTime(t.getMinStartTime().withHour(7));
                    t.setMaxEndTime(t.getMaxEndTime().withHour(12));
                }
                else if(t.getArrivalTime().getHour() < 18) {
                    t.setMinStartTime(t.getMinStartTime().withHour(13));
                    t.setMaxEndTime(t.getMaxEndTime().withHour(18));
                }
                else {
                    t.setMinStartTime(t.getMinStartTime().withHour(18));
                    t.setMaxEndTime(t.getMaxEndTime().withHour(22));
                }
            }
        }
    }

    /**
     * 解决已经分配的工单时间冲突，工单预期上门时间过紧，工单排序混乱的问题
     */
    public void rearrange() {

        // 10分钟
        for(Ticket t : getTickets()) {
            t.setDuration(Duration.ofMinutes(10));
        }

        //
        for(AgentEachDay a : agents) {

            // 按照 ArrivalTime 重新排序
            a.setTickets(a.getTickets().stream()
                    .sorted(Comparator.comparing(Ticket::getArrivalTime))
                    .collect(Collectors.toList()));

            // 重新设定 ArrivalTime
            if(a.getTickets().size() > 1) {
                for(int i=1; i<a.getTickets().size(); i++) {
                    Ticket t1 = a.getTickets().get(i-1);
                    Ticket t2 = a.getTickets().get(i);

                    long duration = getMatrix().get(t1.getLoc().id, t2.getLoc().id).duration();
                    t2.setArrivalTime(t1.getDepartureTime().plusSeconds(duration));
                }
            }
        }

        for(Ticket t : tickets) {
            if(t.getAgent() != null) {
                if(t.getArrivalTime().getHour() < 12) {
                    t.setMinStartTime(t.getMinStartTime().withHour(7));
                    t.setMaxEndTime(t.getMaxEndTime().withHour(12));
                }
                else if(t.getArrivalTime().getHour() < 18) {
                    t.setMinStartTime(t.getMinStartTime().withHour(13));
                    t.setMaxEndTime(t.getMaxEndTime().withHour(18));
                    t.setDuration(Duration.ofMinutes(10));
                }
                else {
                    t.setMinStartTime(t.getMinStartTime().withHour(18));
                    t.setMaxEndTime(t.getMaxEndTime().withHour(22));
                }
            }
        }


        /*for(AgentEachDay a : agents) {

            if(a.getTickets().size() > 1) {
                for(int i=1; i<a.getTickets().size(); i++) {
                    Ticket t1 = a.getTickets().get(i-1);
                    Ticket t2 = a.getTickets().get(i);
                    if(t2.get)
                }
            }
        }*/
    }

    public void setSkus(List<SKU> skus) {
        this.skus = skus;
    }

    public List<SKU> getSkus() {
        return skus;
    }

    public void setPois(List<POI> pois) {
        this.pois = pois;
    }

    public List<POI> getPois() {
        return pois;
    }

    public void setDepos(List<Depo> depos) {
        this.depos = depos;
    }

    public List<Depo> getDepos() {
        return depos;
    }

    public void setAgents(List<AgentEachDay> agents) {
        this.agents = agents;
    }

    public List<AgentEachDay> getAgents() {
        return agents;
    }

    public void setTickets(List<Ticket> tickets) {
        this.tickets = tickets;
    }

    public List<Ticket> getTickets() {
        return tickets;
    }

    public void setMatrix(TransitMatrix matrix) {
        this.matrix = matrix;
    }

    public TransitMatrix getMatrix() {
        return matrix;
    }

    public void setScore(HardMediumSoftLongScore score) {
        this.score = score;
    }

    public String getScoreExplanation() {
        return scoreExplanation;
    }

    public void setScoreExplanation(String scoreExplanation) {
        this.scoreExplanation = scoreExplanation;
    }

    @Schema(
            description = "求解得分，其中分为三个部分[hard/medium/soft]，如果hard为负，则认为没有可行解",
            /*type = SchemaType.ARRAY,*/
            implementation = String.class,
            example = "0hard/-5medium/-79909soft"
    )
    public HardMediumSoftLongScore getScore() {
        return score;
    }

    public void setConstraintConfiguration(RoutePlanConstraintConfiguration constraintConfiguration) {
        this.constraintConfiguration = constraintConfiguration;
    }

    public RoutePlanConstraintConfiguration getConstraintConfiguration() {
        return constraintConfiguration;
    }

    public CostParameter getCostParameter() {
        return costParameter;
    }

    /**
     *
     * @return
     */
    @JsonProperty(access = JsonProperty.Access.READ_ONLY)
    public Metrics getMetrics() {
        if (costParameter == null) {
            costParameter = new CostParameter(200D, 0D, 1.2D, 100D, 100000D, 0D, 0D, 50D, 1.5D, 8.1D);
        }
        return costParameter.calc(agents, score);
    }

    /**
     *
     */
    public void removeVirtualAgents() {
        // 清除虚拟工程师指派
        getTickets().stream()
                .filter(t -> t.getAgent() != null && t.getAgent().isVirtual())
                .forEach(t -> {
                    t.setAgent(null);
                    t.setNextTicket(null);
                    t.setArrivalTime(null);
                });

        setAgents(
                getAgents().stream().filter(a -> !a.isVirtual()).collect(Collectors.toList())
        );
    }

    /**
     * 序列化
     * @param path 序列化文件路径
     */
    public void serializeTo(String path) {
        try {
            Path target = Path.of(path);
            Path parent = target.getParent();
            if (parent != null) {
                Files.createDirectories(parent);
            }
            Files.write(target, OM.toJson(this).getBytes(StandardCharsets.UTF_8));
        } catch (IOException e) {
            logger.warn("Error serialize to JSON, ", e);
        }
    }

    /**
     *
     * @param path
     * @return
     * @throws JsonProcessingException
     */
    public static RoutePlan from(String path) throws JsonProcessingException {
        try {
            String json = Files.readString(Path.of(path), StandardCharsets.UTF_8);
            return OM.fromJson(json, RoutePlan.class);
        } catch (IOException e) {
            throw new RuntimeException("Error read RoutePlan from " + path, e);
        }
    }

    /**
     * 添加虚拟工程师
     */
    public void addVirtualAgents() {

        // 场景中第一个Ticket
        var firstTicket = getTickets().getFirst();

        if(firstTicket != null) {

            @SuppressWarnings("OptionalGetWithoutIsPresent")
            LocalDateTime t1 = getTickets().stream().min(Comparator.comparing(Ticket::getMinStartTime)).get().getMinStartTime();

            @SuppressWarnings("OptionalGetWithoutIsPresent")
            LocalDateTime t2 = getTickets().stream().max(Comparator.comparing(Ticket::getMaxEndTime)).get().getMaxEndTime();

            for(int i = 0; i < Duration.between(t1, t2).toDays() + 1; i++) {

                // 规划日期中的每一天
                LocalDate d = t1.plusDays(i).toLocalDate();

                // 当前没有虚拟agent
                if(getAgents().stream().noneMatch(a -> a.isVirtual() && a.getDate().equals(d))) {

                    String name = "virtual-1";
                    Agent a = new Agent(name, name, null, firstTicket.getLoc(), new LinkedList<>(), 0, 0);
                    AgentEachDay aed = new AgentEachDay(a, d, d.atStartOfDay().toLocalTime(), d.atTime(23, 59, 59).toLocalTime());
                    aed.setVirtual(true);
                    getAgents().add(aed);
                }
            }
        }
    }
}
