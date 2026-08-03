package one.rewind.xforce.vehicle_routing.solver;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.quarkus.runtime.annotations.RegisterForReflection;
import org.eclipse.microprofile.openapi.annotations.media.Schema;
import org.optaplanner.core.api.domain.constraintweight.ConstraintConfiguration;
import org.optaplanner.core.api.domain.constraintweight.ConstraintWeight;
import org.optaplanner.core.api.score.buildin.hardmediumsoftlong.HardMediumSoftLongScore;

import java.io.Serializable;

@ConstraintConfiguration(constraintPackage = "one.rewind.xforce.vehicle_routing.solver")
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@RegisterForReflection(serialization = true)
public class RoutePlanConstraintConfiguration implements Serializable {

    private String name = "default";

    /**
     * Agent相关
     */
    @ConstraintWeight(RoutePlanConstraintProvider.AGENT_CAPACITY)
    @Schema(name="车辆装载容量限制", description = "agent装载不能超过其设计上限，相关字段：agent.weight、agent.vol，默认惩罚：1 Hard", implementation = String.class)
    private HardMediumSoftLongScore agentCapacity = HardMediumSoftLongScore.ofHard(1);


    @ConstraintWeight(RoutePlanConstraintProvider.AGENT_MAX_TICKET)
    @Schema(name = "最大接单", description = "agent最大接单量不应大于设置值，相关字段：agent.max_ticket_num，默认惩罚：1 Hard", implementation = String.class)
    private HardMediumSoftLongScore agentMaxTicket = HardMediumSoftLongScore.ofHard(1);

    // TODO 名称更改为 AGENT_SKILLS_MATCHING
    @ConstraintWeight(RoutePlanConstraintProvider.AGENT_SKILLS_ACCORD_WITH_TICKET_SKILLS)
    @Schema(name = "标签匹配", description = "所指派agent的标签包含ticket标签，相关字段：agent.skills、ticket.skillsRequired，默认惩罚：1 Hard", implementation = String.class)
    private HardMediumSoftLongScore agentSkillsAccordWithTicketSkills = HardMediumSoftLongScore.ofHard(1);

    @ConstraintWeight(RoutePlanConstraintProvider.AGENT_QUALIFICATION_LEVELS_MATCH_TICKET)
    @Schema(name = "需求技能等级匹配", description = "agent等级与ticket等级相匹配，相关字段：agent.qualificationLevels、ticket.qualificationLevelsRequired，默认惩罚：100 medium", implementation = String.class)
    private HardMediumSoftLongScore agentQualificationLevelsMatchTicket = HardMediumSoftLongScore.ofMedium(100);

    /**
     * Ticket相关
     */
    @ConstraintWeight(RoutePlanConstraintProvider.REF_TICKET_AFTER_DEP_TICKET)
    @Schema(name="工单时序因果依赖", description = "下一级ticket的完成时间必须晚于上级ticket，相关字段：ticket.dep_tickets、ticket.ref_tickets，默认惩罚：0 Hard（未启用）", implementation = String.class)
    private HardMediumSoftLongScore refTicketAfterDepTicket = HardMediumSoftLongScore.ofHard(0);


    @ConstraintWeight(RoutePlanConstraintProvider.REF_TICKET_SAME_AGENT_WITH_DEP_TICKET)
    @Schema(name="工单工程师依赖", description = "下一级ticket与上级ticket必须分配给同一agent，相关字段：ticket.dep_tickets、ticket.ref_tickets、ticket.agent_id，默认惩罚：0 Hard（未启用）", implementation = String.class)
    private HardMediumSoftLongScore refTicketSameAgentWithDepTicket = HardMediumSoftLongScore.ofHard(0);


    @ConstraintWeight(RoutePlanConstraintProvider.SERVICE_FINISHED_AFTER_MAX_END_TIME)
    @Schema(name="工单截止时间", description = "ticket完成不能晚于最后截止时间，相关字段：ticket.max_end_time，默认惩罚：0 Hard（未启用）", implementation = String.class)
    private HardMediumSoftLongScore serviceFinishedAfterMaxEndTime = HardMediumSoftLongScore.ofHard(0);

    @ConstraintWeight(RoutePlanConstraintProvider.TICKET_START_SERVICE_TIME_MATCH_EXPECTED)
    @Schema(name = "时间窗约束", description = "ticket在客户预期时间上门，相关字段：ticket.min_start_time、ticket.max_end_time，默认惩罚：100 Soft（每分钟）", implementation = String.class)
    private HardMediumSoftLongScore ticketStartServiceTimeMatchExpected = HardMediumSoftLongScore.ofSoft(100);


    @ConstraintWeight(RoutePlanConstraintProvider.TICKET_ARRIVAL_TIME_SAME_DATE_WITH_PLAN_TIME)
    @Schema(name = "当日指派", description = "ticket必须在当日指派工程师，相关字段：ticket.create_time，默认惩罚：1 Hard", implementation = String.class)
    private HardMediumSoftLongScore ticketArrivalTimeSameDateWithPlanTime = HardMediumSoftLongScore.ofHard(1);

    @ConstraintWeight(RoutePlanConstraintProvider.RELATION_TICKETS_SAME_AGENT)
    @Schema(name = "关联工单相同指派", description = "ticket与其关联ticket尽量派发给相同工程师，相关字段：ticket.relation_tickets，默认惩罚：50 Medium", implementation = String.class)
    private HardMediumSoftLongScore relationTicketsSameAgent = HardMediumSoftLongScore.ofMedium(50);


    /**
     * 目标函数
     */
    @ConstraintWeight(RoutePlanConstraintProvider.MINIMIZE_TRAVEL_TIME)
    @Schema(name = "最小行驶时间", description = "所有agent的总在途时间尽可能小，默认惩罚：1 Soft（每分钟）", implementation = String.class)
    private HardMediumSoftLongScore minimizeTravelTime = HardMediumSoftLongScore.ofSoft(1);


    @ConstraintWeight(RoutePlanConstraintProvider.MINIMIZE_TRAVEL_DISTANCE)
    @Schema(name = "最化行驶距离", description = "所有agent的总在途里程尽可能小，默认惩罚：0 Soft（每米）（未启用）", implementation = String.class)
    private HardMediumSoftLongScore minimizeTravelDistance = HardMediumSoftLongScore.ofSoft(0);


    @ConstraintWeight(RoutePlanConstraintProvider.MINIMIZE_AGENT_FIXED_COST)
    @Schema(name = "最小固定成本", description = "总固定成本最小，默认惩罚：20 Soft（每元）", implementation = String.class)
    private HardMediumSoftLongScore minimizeAgentFixedCost = HardMediumSoftLongScore.ofSoft(20);


    /**
     * 高级
     */
    @ConstraintWeight(RoutePlanConstraintProvider.SAME_DEPO)
    @Schema(name = "工单工程师同网点", description = "ticket只能指派给同网点的agent，相关字段：agent.depo_id、ticket.depo_id，默认惩罚：1 Hard", implementation = String.class)
    private HardMediumSoftLongScore sameDepo = HardMediumSoftLongScore.ofHard(1);

    @ConstraintWeight(RoutePlanConstraintProvider.BALANCE_AGENT_LOADING)
    @Schema(name = "工单负载均衡", description = "分配给每个agent的ticket应差异不大，相关字段：agent.tickets，默认惩罚：1 Medium", implementation = String.class)
    private HardMediumSoftLongScore balanceAgentLoading = HardMediumSoftLongScore.ofMedium(1);

    @ConstraintWeight(RoutePlanConstraintProvider.BALANCE_AGENT_LOADING_RATIO)
    @Schema(name = "负载比例均衡", description = "每个agent的有效载荷使用比例应该差异不大，默认惩罚：0 Medium（未启用）", implementation = String.class)
    private HardMediumSoftLongScore balanceAgentLoadingRatio = HardMediumSoftLongScore.ofMedium(0);

    @ConstraintWeight(RoutePlanConstraintProvider.BALANCE_AGENT_WORKING_TIME)
    @Schema(name = "工作时长负载均衡", description = "每个agent的预期工作时长应该差异不大，默认惩罚：0 Medium（未启用）", implementation = String.class)
    private HardMediumSoftLongScore balanceAgentWorkingTime = HardMediumSoftLongScore.ofMedium(0);

    @ConstraintWeight(RoutePlanConstraintProvider.MINIMIZE_TICKET_CHANGING)
    @Schema(name = "最小工单变更", description = "尽量不要改派已经分配的工单，默认惩罚：1000 Soft", implementation = String.class)
    private HardMediumSoftLongScore minimizeTicketChanging = HardMediumSoftLongScore.ofSoft(1000);

    @ConstraintWeight(RoutePlanConstraintProvider.AGENT_IS_VIRTUAL)
    @Schema(name = "虚拟工程师", description = "超约束优化时使用，需要权衡业务场景和客户需求设计惩罚值。" +
            "如果违背时间窗约束带来的惩罚大于虚拟工程师的惩罚，求解时倾向于虚拟工程师指派，也就是说该工单不进行配送，反之亦然。" +
            "默认惩罚：1000 Medium", implementation = String.class)
    private HardMediumSoftLongScore agentIsVirtual = HardMediumSoftLongScore.ofMedium(1000);


    public RoutePlanConstraintConfiguration() {}


    public RoutePlanConstraintConfiguration(
            String name,
            HardMediumSoftLongScore agentCapacity,
            HardMediumSoftLongScore agentMaxTicket,
            HardMediumSoftLongScore agentSkillsAccordWithTicketSkills,
            HardMediumSoftLongScore agentQualificationLevelsMatchTicket,
            HardMediumSoftLongScore refTicketAfterDepTicket,
            HardMediumSoftLongScore refTicketSameAgentWithDepTicket,
            HardMediumSoftLongScore serviceFinishedAfterMaxEndTime,
            HardMediumSoftLongScore ticketStartServiceTimeMatchExpected,
            HardMediumSoftLongScore ticketArrivalTimeSameDateWithPlanTime,
            HardMediumSoftLongScore relationTicketsSameAgent,
            HardMediumSoftLongScore minimizeTravelTime,
            HardMediumSoftLongScore minimizeTravelDistance,
            HardMediumSoftLongScore minimizeAgentFixedCost,
            HardMediumSoftLongScore sameDepo,
            HardMediumSoftLongScore balanceAgentLoading,
            HardMediumSoftLongScore balanceAgentLoadingRatio,
            HardMediumSoftLongScore balanceAgentWorkingTime,
            HardMediumSoftLongScore minimizeTicketChanging,
            HardMediumSoftLongScore agentIsVirtual
    ) {
        this.name = name;
        this.agentCapacity = agentCapacity;
        this.agentMaxTicket = agentMaxTicket;
        this.agentSkillsAccordWithTicketSkills = agentSkillsAccordWithTicketSkills;
        this.agentQualificationLevelsMatchTicket = agentQualificationLevelsMatchTicket;
        this.refTicketAfterDepTicket = refTicketAfterDepTicket;
        this.refTicketSameAgentWithDepTicket = refTicketSameAgentWithDepTicket;
        this.serviceFinishedAfterMaxEndTime = serviceFinishedAfterMaxEndTime;
        this.ticketStartServiceTimeMatchExpected = ticketStartServiceTimeMatchExpected;
        this.ticketArrivalTimeSameDateWithPlanTime = ticketArrivalTimeSameDateWithPlanTime;
        this.relationTicketsSameAgent = relationTicketsSameAgent;
        this.minimizeTravelTime = minimizeTravelTime;
        this.minimizeTravelDistance = minimizeTravelDistance;
        this.minimizeAgentFixedCost = minimizeAgentFixedCost;
        this.sameDepo = sameDepo;
        this.balanceAgentLoading = balanceAgentLoading;
        this.balanceAgentLoadingRatio = balanceAgentLoadingRatio;
        this.balanceAgentWorkingTime = balanceAgentWorkingTime;
        this.minimizeTicketChanging = minimizeTicketChanging;
        this.agentIsVirtual = agentIsVirtual;
    }

    public HardMediumSoftLongScore getAgentCapacity() {
        return agentCapacity;
    }

    public void setAgentCapacity(HardMediumSoftLongScore agentCapacity) {
        this.agentCapacity = agentCapacity;
    }

    public HardMediumSoftLongScore getServiceFinishedAfterMaxEndTime() {
        return serviceFinishedAfterMaxEndTime;
    }

    public void setServiceFinishedAfterMaxEndTime(HardMediumSoftLongScore serviceFinishedAfterMaxEndTime) {
        this.serviceFinishedAfterMaxEndTime = serviceFinishedAfterMaxEndTime;
    }

    public HardMediumSoftLongScore getRefTicketAfterDepTicket() {
        return refTicketAfterDepTicket;
    }

    public void setRefTicketAfterDepTicket(HardMediumSoftLongScore refTicketAfterDepTicket) {
        this.refTicketAfterDepTicket = refTicketAfterDepTicket;
    }

    public HardMediumSoftLongScore getRefTicketSameAgentWithDepTicket() {
        return refTicketSameAgentWithDepTicket;
    }

    public void setRefTicketSameAgentWithDepTicket(HardMediumSoftLongScore refTicketSameAgentWithDepTicket) {
        this.refTicketSameAgentWithDepTicket = refTicketSameAgentWithDepTicket;
    }

    public HardMediumSoftLongScore getBalanceAgentLoading() {
        return balanceAgentLoading;
    }

    public void setBalanceAgentLoading(HardMediumSoftLongScore balanceAgentLoading) {
        this.balanceAgentLoading = balanceAgentLoading;
    }

    public HardMediumSoftLongScore getMinimizeTravelTime() {
        return minimizeTravelTime;
    }

    public void setMinimizeTravelTime(HardMediumSoftLongScore minimizeTravelTime) {
        this.minimizeTravelTime = minimizeTravelTime;
    }

    public HardMediumSoftLongScore getMinimizeTravelDistance() {
        return minimizeTravelDistance;
    }

    public void setMinimizeTravelDistance(HardMediumSoftLongScore minimizeTravelDistance) {
        this.minimizeTravelDistance = minimizeTravelDistance;
    }

    public HardMediumSoftLongScore getMinimizeTicketChanging() {
        return minimizeTicketChanging;
    }

    public void setMinimizeTicketChanging(HardMediumSoftLongScore minimizeTicketChanging) {
        this.minimizeTicketChanging = minimizeTicketChanging;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public HardMediumSoftLongScore getMinimizeAgentFixedCost() {
        return minimizeAgentFixedCost;
    }

    public void setMinimizeAgentFixedCost(HardMediumSoftLongScore minimizeAgentFixedCost) {
        this.minimizeAgentFixedCost = minimizeAgentFixedCost;
    }

    public HardMediumSoftLongScore getAgentSkillsAccordWithTicketSkills() {
        return agentSkillsAccordWithTicketSkills;
    }

    public void setAgentSkillsAccordWithTicketSkills(HardMediumSoftLongScore agentSkillsAccordWithTicketSkills) {
        this.agentSkillsAccordWithTicketSkills = agentSkillsAccordWithTicketSkills;
    }

    public HardMediumSoftLongScore getTicketArrivalTimeSameDateWithPlanTime() {
        return ticketArrivalTimeSameDateWithPlanTime;
    }

    public void setTicketArrivalTimeSameDateWithPlanTime(HardMediumSoftLongScore ticketArrivalTimeSameDateWithPlanTime) {
        this.ticketArrivalTimeSameDateWithPlanTime = ticketArrivalTimeSameDateWithPlanTime;
    }

    public HardMediumSoftLongScore getRelationTicketsSameAgent() {
        return relationTicketsSameAgent;
    }

    public void setRelationTicketsSameAgent(HardMediumSoftLongScore relationTicketsSameAgent) {
        this.relationTicketsSameAgent = relationTicketsSameAgent;
    }

    public HardMediumSoftLongScore getTicketStartServiceTimeMatchExpected() {
        return ticketStartServiceTimeMatchExpected;
    }

    public void setTicketStartServiceTimeMatchExpected(HardMediumSoftLongScore ticketStartServiceTimeMatchExpected) {
        this.ticketStartServiceTimeMatchExpected = ticketStartServiceTimeMatchExpected;
    }

    public HardMediumSoftLongScore getAgentQualificationLevelsMatchTicket() {
        return agentQualificationLevelsMatchTicket;
    }

    public void setAgentQualificationLevelsMatchTicket(HardMediumSoftLongScore agentQualificationLevelsMatchTicket) {
        this.agentQualificationLevelsMatchTicket = agentQualificationLevelsMatchTicket;
    }

    public HardMediumSoftLongScore getAgentIsVirtual() {
        return agentIsVirtual;
    }

    public void setAgentIsVirtual(HardMediumSoftLongScore agentIsVirtual) {
        this.agentIsVirtual = agentIsVirtual;
    }

    public HardMediumSoftLongScore getAgentMaxTicket() {
        return agentMaxTicket;
    }

    public void setAgentMaxTicket(HardMediumSoftLongScore agentMaxTicket) {
        this.agentMaxTicket = agentMaxTicket;
    }

    public HardMediumSoftLongScore getSameDepo() {
        return sameDepo;
    }

    public void setSameDepo(HardMediumSoftLongScore sameDepo) {
        this.sameDepo = sameDepo;
    }

    public HardMediumSoftLongScore getBalanceAgentLoadingRatio() {
        return balanceAgentLoadingRatio;
    }

    public void setBalanceAgentLoadingRatio(HardMediumSoftLongScore balanceAgentLoadingRatio) {
        this.balanceAgentLoadingRatio = balanceAgentLoadingRatio;
    }

    public HardMediumSoftLongScore getBalanceAgentWorkingTime() {
        return balanceAgentWorkingTime;
    }

    public void setBalanceAgentWorkingTime(HardMediumSoftLongScore balanceAgentWorkingTime) {
        this.balanceAgentWorkingTime = balanceAgentWorkingTime;
    }
}
