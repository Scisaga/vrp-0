package one.rewind.xforce.vehicle_routing.domain.agent;

import com.fasterxml.jackson.annotation.*;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.quarkus.runtime.annotations.RegisterForReflection;
import jakarta.ws.rs.core.Response;
import one.rewind.xforce.geo.POI;
import one.rewind.xforce.geo.transit.Transit;
import one.rewind.xforce.json.DeduplicateObjectIdResolver;
import one.rewind.xforce.vehicle_routing.domain.ticket.Ticket;
import one.rewind.xforce.vehicle_routing.rest.exception.ExceptionWrapper;
import org.apache.commons.lang3.ObjectUtils;
import org.eclipse.microprofile.openapi.annotations.enums.SchemaType;
import org.eclipse.microprofile.openapi.annotations.media.Schema;
import org.eclipse.microprofile.openapi.annotations.media.SchemaProperty;
import org.optaplanner.core.api.domain.entity.PlanningEntity;
import org.optaplanner.core.api.domain.lookup.PlanningId;
import org.optaplanner.core.api.domain.variable.PlanningListVariable;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedList;
import java.util.List;

/**
 * 每日Agent
 * 对应于多日规划
 */
@Schema(
        requiredProperties = {"id"},
        properties = {
                @SchemaProperty(
                        name = "start_loc",
                        description = "开始位置。可传 plan.pois 中 POI 的 ID 字符串，或直接传 POI 对象。",
                        oneOf = {String.class, POI.class},
                        example = "B0G2X7N5D2"
                )
        }
)
@PlanningEntity
@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@JsonIdentityInfo(
        scope = AgentEachDay.class,
        generator = ObjectIdGenerators.PropertyGenerator.class,
        property = "id",
        resolver = DeduplicateObjectIdResolver.class
)
@RegisterForReflection(serialization = true)
public class AgentEachDay extends Agent {

    // 日期
    @JsonFormat(pattern="yyyy-MM-dd")
    @Schema(description = "日期")
    private LocalDate date;

    @Schema(description = "是否当日限行")
    private boolean restrict;

    @Schema(description = "当日最大接单量")
    private int maxTicketNum;

    @JsonFormat(pattern="yyyy-MM-dd HH:mm:ss")
    @Schema(description = "最早指派时间")
    private LocalDateTime shiftStartTime;

    @JsonFormat(pattern="yyyy-MM-dd HH:mm:ss")
    @Schema(description = "最晚完成时间")
    private LocalDateTime shiftOffTime;

    @JsonIdentityReference(alwaysAsId = true)
    @Schema(description = "分配工单ID列表",
            type = SchemaType.ARRAY,
            implementation = String.class,
            example = "[\"ticket-1\", \"ticket-2\"]")
    @PlanningListVariable
    private List<Ticket> tickets;

    /**
     *
     */
    public AgentEachDay() {}

    /**
     *
     * @param agent 原始Agent
     * @param date 日期
     * @param shiftStartTime 班次开始时间
     * @param shiftOffTime 班次结束时间
     */
    public AgentEachDay(Agent agent, LocalDate date, LocalTime shiftStartTime, LocalTime shiftOffTime) {

        String yyMMdd = date.format(DateTimeFormatter.ofPattern("yyMMdd"));
        this.setId(agent.getId() + "-" + yyMMdd);
        this.setName(agent.getName() + "-" + yyMMdd);
        this.setDepoId(agent.getDepoId());
        this.setStartLoc(agent.getStartLoc());
        this.setSkills(agent.getSkills());
        this.setSize(agent.getSize());
        this.setHeight(agent.getHeight());
        this.setWidth(agent.getWidth());
        this.setWeight(agent.getWeight());
        this.setVol(agent.getVol());
        this.setVehicleType(agent.getVehicleType());
        this.setFuelType(agent.getFuelType());
        this.setFuelConsumption(agent.getFuelConsumption());
        this.setFixCostDaily(agent.getFixCostDaily());
        this.setRented(agent.isRented());
        this.setVirtual(agent.isVirtual());

        this.date = date;
        this.shiftStartTime = this.date.atTime(shiftStartTime);
        this.shiftOffTime = this.date.atTime(shiftOffTime);

        tickets = new ArrayList<>();
    }

    @PlanningId
    public String getId() {
        return super.id;
    }

    public void setId(String id) {
        super.id = id;
    }

    public LocalDate getDate() {
        return date;
    }

    public void setDate(LocalDate date) {
        this.date = date;
    }

    public boolean isRestrict() {
        return restrict;
    }

    public void setRestrict(boolean restrict) {
        this.restrict = restrict;
    }

    public LocalDateTime getShiftStartTime() {
        return shiftStartTime;
    }

    public void setShiftStartTime(LocalDateTime shiftStartTime) {
        this.shiftStartTime = shiftStartTime;
    }

    public LocalDateTime getShiftOffTime() {
        return shiftOffTime;
    }

    public void setShiftOffTime(LocalDateTime shiftOffTime) {
        this.shiftOffTime = shiftOffTime;
    }

    public List<Ticket> getTickets() {
        return tickets;
    }

    public void setTickets(List<Ticket> tickets) {
        this.tickets = tickets;
    }


    public void setMaxTicketNum(int maxTicketNum) {
        this.maxTicketNum = maxTicketNum;
    }


    public int getMaxTicketNum() {
        return maxTicketNum;
    }

    @JsonProperty(access = JsonProperty.Access.READ_ONLY)
    public double getTransitWeight() {

        // 根据ticket顺序动态计算
        double init = ObjectUtils.isEmpty(tickets) ? 0 :
                tickets.stream().filter(t -> t.getType() == Ticket.Type.Delv).map(Ticket::getWeight).reduce(0F, Float::sum);

        // 生成在途装载
        double w0 = init;
        List<Double> w_transit = new LinkedList<>(){{
            add(init);
        }};

        if (tickets != null) {
            for(Ticket t : tickets) {

                w0 = switch (t.getType()) {
                    case Delv -> w0 - t.getWeight();
                    case Delv_BH -> w0 + t.getWeight();
                    default -> w0;
                };

                w_transit.add(w0);
            }
        }
        return w_transit.stream().mapToDouble(v -> v).max().orElse(0);
    }

    @JsonProperty(access = JsonProperty.Access.READ_ONLY)
    public double getTransitVol() {

        // 根据ticket顺序动态计算
        double init = tickets == null ? 0 :
                tickets.stream().filter(t -> t.getType() == Ticket.Type.Delv).map(Ticket::getVol).reduce(0F, Float::sum);

        // 生成在途装载
        double v0 = init;
        List<Double> v_transit = new LinkedList<>(){{
            add(init);
        }};

        if (tickets != null) {
            for(Ticket t : tickets) {

                v0 = switch (t.getType()) {
                    case Delv -> v0 - t.getVol();
                    case Delv_BH -> v0 + t.getVol();
                    default -> v0;
                };

                v_transit.add(v0);
            }
        }
        return v_transit.stream().mapToDouble(v -> v).max().orElse(0);
    }

    /**
     * 计算在途载荷
     * @return
     */
    @JsonProperty(access = JsonProperty.Access.READ_ONLY)
    public Capacity getTransitLoading() {

        // 根据ticket顺序动态计算
        Capacity init_total = tickets == null ? new Capacity(0, 0) :
                tickets.stream().filter(t -> t.getType() == Ticket.Type.Delv).map(t -> new Capacity(t.getWeight(), t.getVol())).reduce(new Capacity(0, 0), Capacity::add);

        // 生成在途装载
        Capacity current = init_total;
        List<Capacity> capacities_transit = new LinkedList<>(){{
            add(init_total);
        }};

        if (tickets != null) {
            for(Ticket t : tickets) {

                current = switch (t.getType()) {
                    case Delv -> current.minus(new Capacity(t.getWeight(), t.getVol()));
                    case Delv_BH -> current.add(new Capacity(t.getWeight(), t.getVol()));
                    default -> current;
                };

                capacities_transit.add(new Capacity(current.weight(), current.vol()));
            }
        }

        /*System.out.println(">>>" + capacities_transit);*/

        // TODO 先只比较重量
        return capacities_transit.stream().max(Comparator.comparingDouble(Capacity::weight)).orElse(new Capacity(0, 0));
    }

    /**
     * @return 总行驶时间
     */
    @JsonProperty(access = JsonProperty.Access.READ_ONLY)
    public long getTotalDrivingTimeSeconds() {

        if (tickets == null || tickets.isEmpty() || matrix == null) {
            return 0;
        }

        long totalDrivingTime = 0;
        POI previousPOI = getStartLoc();

        if (tickets != null) {
            for (Ticket ticket : tickets) {
                Transit transit = readTransit(previousPOI, ticket.getLoc());
                if (isTransitAvailable(transit)) {
                    totalDrivingTime += transit.duration();
                }
                previousPOI = ticket.getLoc();
            }
        }

        Transit backToStart = readTransit(previousPOI, getStartLoc());
        if (isTransitAvailable(backToStart)) {
            totalDrivingTime += backToStart.duration();
        }

        return totalDrivingTime;
    }

    /**
     *
     * @return 总行使里程
     */
    @JsonProperty(access = JsonProperty.Access.READ_ONLY)
    public long getTotalDrivingDistanceMeters() {

        if (tickets == null || tickets.isEmpty() || matrix == null) {
            return 0;
        }

        long totalDrivingDistance = 0;
        POI previousPOI = getStartLoc();

        for (Ticket ticket : tickets) {
            Transit transit = readTransit(previousPOI, ticket.getLoc());
            if (isTransitAvailable(transit)) {
                totalDrivingDistance += transit.distance();
            }
            previousPOI = ticket.getLoc();
        }
        Transit backToStart = readTransit(previousPOI, getStartLoc());
        if (isTransitAvailable(backToStart)) {
            totalDrivingDistance += backToStart.distance();
        }

        return totalDrivingDistance;
    }

    /**
     * 计算最后一个工单的完成时间
     * @return 工单完成时间
     */
    @JsonProperty(access = JsonProperty.Access.READ_ONLY)
    @JsonFormat(pattern="yyyy-MM-dd HH:mm:ss")
    public LocalDateTime getTicketsDoneTime() {

        if (tickets == null || tickets.isEmpty() || matrix == null) {
            return shiftStartTime;
        }

        Ticket lastTicket = tickets.getLast();

        LocalDateTime departureTime = lastTicket.getDepartureTime();
        if (departureTime == null) {
            return shiftStartTime;
        }

        Transit backToStart = readTransit(lastTicket.getLoc(), getStartLoc());
        if (!isTransitAvailable(backToStart)) {
            return departureTime;
        }

        try {
            return departureTime.plusSeconds(backToStart.duration());
        } catch (RuntimeException e) {
            throw new ExceptionWrapper(Response.Status.INTERNAL_SERVER_ERROR, "Failed to calculate tickets_done_time");
        }
    }

    private Transit readTransit(POI origin, POI destination) {
        if (matrix == null || origin == null || destination == null || origin.id == null || destination.id == null) {
            return null;
        }
        return matrix.get(origin.id, destination.id);
    }

    private boolean isTransitAvailable(Transit transit) {
        return transit != null
                && transit.distance() != Long.MAX_VALUE
                && transit.duration() != Long.MAX_VALUE;
    }


}
