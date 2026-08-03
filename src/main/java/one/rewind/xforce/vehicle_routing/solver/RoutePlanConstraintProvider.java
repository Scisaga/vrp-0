package one.rewind.xforce.vehicle_routing.solver;

import one.rewind.xforce.vehicle_routing.domain.agent.Agent;
import one.rewind.xforce.vehicle_routing.domain.agent.AgentEachDay;
import one.rewind.xforce.vehicle_routing.domain.ticket.Ticket;
import one.rewind.xforce.vehicle_routing.solver.justifications.*;
import org.apache.commons.lang3.ObjectUtils;
import org.apache.commons.lang3.StringUtils;
import org.optaplanner.core.api.score.stream.Constraint;
import org.optaplanner.core.api.score.stream.ConstraintFactory;
import org.optaplanner.core.api.score.stream.ConstraintProvider;

import java.time.Duration;
import java.time.temporal.ChronoUnit;
import java.util.*;

import static org.optaplanner.core.api.score.stream.Joiners.equal;

public class RoutePlanConstraintProvider implements ConstraintProvider {


    // Agent相关
    public static final String AGENT_CAPACITY = "agentCapacity";

    public static final String AGENT_MAX_TICKET = "agentMaxTicket";

    public static final String AGENT_SKILLS_ACCORD_WITH_TICKET_SKILLS = "agentSkillsAccordWithTicketSkills";

    public static final String AGENT_QUALIFICATION_LEVELS_MATCH_TICKET = "agentQualificationLevelsMatchTicket";

    // 工单
    public static final String REF_TICKET_AFTER_DEP_TICKET = "refTicketAfterDepTicket";

    public static final String REF_TICKET_SAME_AGENT_WITH_DEP_TICKET = "refTicketSameAgentWithDepTicket";

    public static final String SERVICE_FINISHED_AFTER_MAX_END_TIME = "serviceFinishedAfterMaxEndTime";

    public static final String TICKET_START_SERVICE_TIME_MATCH_EXPECTED = "ticketStartServiceTimeMatchExpected";

    public static final String TICKET_ARRIVAL_TIME_SAME_DATE_WITH_PLAN_TIME = "ticketArrivalTimeSameDateWithPlanTime";

    public static final String RELATION_TICKETS_SAME_AGENT = "relationTicketsSameAgent";


    // 目标函数
    public static final String MINIMIZE_TRAVEL_TIME = "minimizeTravelTime";

    public static final String MINIMIZE_TRAVEL_DISTANCE = "minimizeTravelDistance";

    public static final String MINIMIZE_AGENT_FIXED_COST = "minimizeAgentFixedCost";

    // 高级
    public static final String SAME_DEPO = "sameDepo";

    public static final String BALANCE_AGENT_LOADING = "balanceAgentLoading";

    public static final String BALANCE_AGENT_LOADING_RATIO = "balanceAgentLoadingRatio";

    public static final String BALANCE_AGENT_WORKING_TIME = "balanceAgentWorkingTime";

    public static final String MINIMIZE_TICKET_CHANGING = "minimizeTicketChanging";

    public static final String AGENT_IS_VIRTUAL = "agentIsVirtual";


    @Override
    public Constraint[] defineConstraints(ConstraintFactory fac) {
        return new Constraint[]{
                agentCapacity(fac),
                agentMaxTicket(fac),
                agentSkillsAccordWithTicketSkills(fac),
                agentQualificationLevelsMatchTicket(fac),
                refTicketMustAfterDepTicket(fac),
                refTicketSameAgentWithDepTicket(fac),
                serviceFinishedAfterMaxEndTime(fac),
                ticketStartServiceTimeMatchExpected(fac),
                ticketArrivalTimeSameDateWithPlanTime(fac),
                relationTicketsSameAgent(fac),
                minimizeTravelTime(fac),
                minimizeTravelDistance(fac),
                minimizeAgentFixedCost(fac),
                sameDepo(fac),
                balanceAgentLoading(fac),
                balanceAgentLoadingRatio(fac),
                balanceAgentWorkingTime(fac),
                minimizeTicketChanging(fac),
                agentIsVirtual(fac)
        };
    }

    /**
     * 车辆装载容量限制
     * 确保每个Agent在每一天的运输负荷（transitLoading）不超过其过载容量（overloadCapacity）。如果运输负荷超过了容量，就会进行惩罚，并且提供相关的正当性解释。
     * @param factory OptaPlanner 的工厂类，用于构建约束。
     * @return Constraint对象，表示一个约束
     */
    protected Constraint agentCapacity(ConstraintFactory factory) {

        return factory
                // 遍历AgentEachDay 实体
                .forEach(AgentEachDay.class)
                // 过滤负载超出的Agent
                .filter(a -> !a.isVirtual() && a.getTransitLoading().gt(a.getOverloadCapacity()))
                // 设定惩罚值
                .penalizeConfigurableLong(
                        a -> (long) Math.ceil(a.getTransitLoading().getPenalty(a.getOverloadCapacity()))
                )
                // 提供对应解释
                .justifyWith(
                        (a, score) -> new AgentJustification.Capacity(
                                a.getId(), a.getTransitLoading(), a.getOverloadCapacity()))
                .asConstraint(AGENT_CAPACITY);
    }


    /**
     * 接单数不能大于最大接单数
     * @param factory
     * @return
     */
    protected Constraint agentMaxTicket(ConstraintFactory factory) {
        return factory.forEach(AgentEachDay.class)
                .filter(a -> !a.isVirtual() && a.getMaxTicketNum() > 0)
                .penalizeConfigurableLong(
                        a -> a.getTickets().size() > a.getMaxTicketNum() ? a.getTickets().size() - a.getMaxTicketNum() : 0
                )
                .justifyWith(
                        (a, score) -> new AgentJustification.MaxTicket(
                                a.getId(), a.getMaxTicketNum(), a.getTickets().size()))
                .asConstraint(AGENT_MAX_TICKET);
    }

    /**
     * 高等级工单给到高等级工程师
     *
     * @param factory
     * @return
     */
    protected Constraint agentQualificationLevelsMatchTicket(ConstraintFactory factory) {
        return factory.forEach(Ticket.class)
                .filter(ticket -> ticket.getAgent() != null &&
                        !ticket.getAgent().isVirtual() &&
                        ticket.getQualificationLevelsRequired() != null &&
                        !ticket.getQualificationLevelsRequired().isEmpty())
                .penalizeConfigurableLong(
                        (ticket) -> {
                            for (Map.Entry<String, Double> qualificationAndLevelRequired : ticket.getQualificationLevelsRequired().entrySet()) {
                                Double agentLevel = ticket.getAgent().getQualificationLevels().get(qualificationAndLevelRequired.getKey());
                                if (agentLevel == null || agentLevel < qualificationAndLevelRequired.getValue()) {
                                    return 1L;
                                }
                            }
                            return 0L;
                        }
                )
                .justifyWith(
                        (ticket, score) -> new AgentJustification.QualificationLevelsMatchTicket(
                                ticket.getId(), ticket.getAgent().getId(), ticket.getQualificationLevelsRequired(), ticket.getAgent().getQualificationLevels()
                        )
                )
                .asConstraint(AGENT_QUALIFICATION_LEVELS_MATCH_TICKET);
    }

    /**
     * 工单指派的工程师的技能，是否包含了工单所需技能
     *
     * @param factory
     * @return
     */
    protected Constraint agentSkillsAccordWithTicketSkills(ConstraintFactory factory) {
        return factory.forEach(Ticket.class)
                .filter(ticket -> ticket.getAgent() != null && !ticket.getAgent().isVirtual() && ticket.getSkillsRequired() != null)
                .penalizeConfigurableLong(
                        (ticket) -> {
                            // 如果工单所属工程师技能为空，则一定不具备工单所需技能
                            if (ticket.getAgent().getSkills() == null || ticket.getAgent().getSkills().isEmpty()) {
                                return 1L;
                            }
                            if (new HashSet<>(ticket.getAgent().getSkills()).containsAll(ticket.getSkillsRequired())) {
                                return 0L;
                            } else {
                                return 1L;
                            }
                        }
                )
                .justifyWith(
                        (ticket, score) -> new AgentJustification.SkillsNotMatchTicketSkillsRequired(
                                ticket.getId(), ticket.getAgent().getId(), ticket.getSkillsRequired(), ticket.getAgent().getSkills()
                        )
                )
                .asConstraint(AGENT_SKILLS_ACCORD_WITH_TICKET_SKILLS);
    }


    /**
     * 下一级Ticket的完成时间必须晚于上一级Ticket
     *
     * @param factory
     * @return
     */
    protected Constraint refTicketMustAfterDepTicket(ConstraintFactory factory) {

        return factory.forEach(Ticket.class)
                .filter(t -> !t.getDepTickets().isEmpty() && t.getArrivalTime() != null)
                .join(Ticket.class, equal(Ticket::getId, Ticket::getId))
                .flattenLast(Ticket::getDepTickets)
                .filter((t, d_t) -> d_t.getArrivalTime() != null && t.getArrivalTime().isBefore(d_t.getArrivalTime()))
                .penalizeConfigurableLong(
                        (t, d_t) -> ChronoUnit.MINUTES.between(t.getArrivalTime(), d_t.getArrivalTime())
                )
                .asConstraint(REF_TICKET_AFTER_DEP_TICKET);
    }

    /**
     * 下一级Ticket和上一级Ticket必须分配给相同的Agent
     *
     * @param factory
     * @return
     */
    protected Constraint refTicketSameAgentWithDepTicket(ConstraintFactory factory) {

        return factory.forEach(Ticket.class)
                .filter(t -> !t.getDepTickets().isEmpty() && t.getArrivalTime() != null)
                .join(Ticket.class, equal(Ticket::getId, Ticket::getId))
                .flattenLast(Ticket::getDepTickets)
                .filter((t, d_t) -> d_t.getArrivalTime() != null && !t.getAgent().equals(d_t.getAgent()))
                .penalizeConfigurableLong(
                        (t, d_t) -> 1
                )
                .asConstraint(REF_TICKET_SAME_AGENT_WITH_DEP_TICKET);
    }


    /**
     * 服务必须在截止时间前完成
     *
     * @param factory
     * @return
     */
    protected Constraint serviceFinishedAfterMaxEndTime(ConstraintFactory factory) {
        return factory.forEach(Ticket.class)
                .filter(Ticket::isServiceFinishedAfterMaxEndTime)
                .penalizeConfigurableLong(
                        Ticket::getServiceFinishedDelayInMinutes
                )
                .justifyWith(
                        (t, score) -> new TicketJustification.ServiceFinishedAfterMaxEndTime(t.getId(),
                                t.getServiceFinishedDelayInMinutes()))
                .asConstraint(SERVICE_FINISHED_AFTER_MAX_END_TIME);
    }


    /**
     * 最小化 所有工单的如下累加值
     * 如果 startServiceTime 大于 maxEndTime，则累加 startServiceTime - maxEndTime
     *
     * @param factory
     * @return
     */
    protected Constraint ticketStartServiceTimeMatchExpected(ConstraintFactory factory) {
        return factory.forEach(Ticket.class)
                .filter(ticket -> ticket.getAgent() != null && !ticket.getAgent().isVirtual())
                .penalizeConfigurableLong(
                        (ticket) -> {
                            if (ticket.getAgent() != null &&
                                    ticket.getStartServiceTime() != null &&
                                    ticket.getMaxEndTime() != null) {
                                if (ticket.getStartServiceTime().isAfter(ticket.getMaxEndTime())) {
                                    return Duration.between(ticket.getMaxEndTime(), ticket.getStartServiceTime()).toMinutes();
                                }
                            }
                            return 0L;
                        }
                )
                .justifyWith(
                        (ticket, score) -> new TicketJustification.StartServiceTimeMatchExpected(
                                ticket.getId(), ticket.getStartServiceTime(), ticket.getMinStartTime(), ticket.getMaxEndTime()
                        )
                )
                .asConstraint(TICKET_START_SERVICE_TIME_MATCH_EXPECTED);
    }

    /**
     * 当日工单必须在当日指派工程师，否则视为派单失败
     * 最小化 所有工单 Math.sum(Date.diff(工单预期时间，实际指派时间))
     *
     * @param factory
     * @return
     */
    protected Constraint ticketArrivalTimeSameDateWithPlanTime(ConstraintFactory factory) {
        return factory.forEach(Ticket.class)
                .filter(t ->
                    t.getAgent() != null && !t.getAgent().isVirtual() &&
                            t.getArrivalTime() != null && t.getMinStartTime() != null
                )
                .penalizeConfigurableLong(
                        (ticket) -> {
                            if (ticket.getArrivalTime().getDayOfYear() == ticket.getMinStartTime().getDayOfYear()) {
                                return 0L;
                            } else {
                                return 1L;
                            }
                        }
                )
                .justifyWith(
                        (ticket, score) -> new TicketJustification.ArrivalTimeNotSameDateWithPlanTime(
                                ticket.getId(), ticket.getArrivalTime(), ticket.getMinStartTime()
                        )
                )
                .asConstraint(TICKET_ARRIVAL_TIME_SAME_DATE_WITH_PLAN_TIME);
    }

    /**
     * 关联工单派发给同一工程师
     *
     * @param factory
     * @return
     */
    protected Constraint relationTicketsSameAgent(ConstraintFactory factory) {
        return factory.forEach(Ticket.class)
                .join(Ticket.class, equal(Ticket::getId, Ticket::getId)) // Join所有Ticket
                .flattenLast(Ticket::getRefTickets) // 展开 refTickets 列表
                .filter((ticket, refTicket) ->
                        // 确保当前工单和关联工单都有有效的工程师
                        ticket.getAgent() != null && !ticket.getAgent().isVirtual() &&
                                refTicket.getAgent() != null && !refTicket.getAgent().isVirtual() &&
                                // 检查工程师是否不同
                                !Objects.equals(ticket.getAgent().getId(), refTicket.getAgent().getId())
                )
                .penalizeConfigurableLong((ticket, refTicket) -> 1L) // 每有一次不匹配就惩罚一次
                .justifyWith(
                        (ticket,  refTicket, score) -> new TicketJustification.RelationTicketsSameAgent(
                                ticket.getId(), ticket.getAgent().getId(), refTicket.getId()
                        )
                )
                .asConstraint(RELATION_TICKETS_SAME_AGENT);
    }


    /**
     * 最小总体运输时间
     *
     * @param factory
     * @return
     */
    protected Constraint minimizeTravelTime(ConstraintFactory factory) {
        return factory.forEach(AgentEachDay.class)
                .filter(agent -> !agent.isVirtual())
                .penalizeConfigurableLong(
                        AgentEachDay::getTotalDrivingTimeSeconds
                )
                .justifyWith(
                        (a, score) -> new AgentJustification.MinimizeTravelTime(
                                a.getId(),
                                a.getTotalDrivingTimeSeconds()
                        )
                )
                .asConstraint(MINIMIZE_TRAVEL_TIME);
    }

    /**
     * 固定成本 + 限行费
     *
     * @param factory
     * @return
     */
    protected Constraint minimizeAgentFixedCost(ConstraintFactory factory) {
        return factory.forEach(AgentEachDay.class)
                .filter(agent -> !agent.isVirtual())
                .penalizeConfigurableLong(
                        a -> (long) a.getFixCostDaily() + (a.isRestrict() ? 100 * a.getTotalDrivingTimeSeconds() / 7200 : 0) // 固定成本 + 限行费
                )
                .asConstraint(MINIMIZE_AGENT_FIXED_COST);
    }

    /**
     *
     * @param factory
     * @return
     */
    protected Constraint minimizeTravelDistance(ConstraintFactory factory) {
        return factory.forEach(AgentEachDay.class)
                .filter(agent -> !agent.isVirtual())
                .penalizeConfigurableLong(
                        AgentEachDay::getTotalDrivingDistanceMeters
                )
                .asConstraint(MINIMIZE_TRAVEL_DISTANCE);
    }

    /**
     *
     * @param factory
     * @return
     */
    protected Constraint sameDepo(ConstraintFactory factory) {

        return factory.forEach(Ticket.class)
                .filter(ticket ->
                        StringUtils.isNoneBlank(ticket.getDepoId())
                                && ticket.getAgent() != null
                                && !ticket.getAgent().isVirtual()
                                && StringUtils.isNoneBlank(ticket.getAgent().getDepoId())
                )
                .penalizeConfigurableLong(
                        (ticket) -> ticket.getDepoId().equals(ticket.getAgent().getDepoId()) ? 0 : 1
                )
                .justifyWith(
                        (ticket, score) -> new TicketJustification.NotSameDepo(
                                ticket.getId(), ticket.getAgent().getId()
                        )
                )
                .asConstraint(SAME_DEPO);
    }

    /**
     * 负载均衡（工单）
     *
     * @param factory
     * @return
     */
    protected Constraint balanceAgentLoading(ConstraintFactory factory) {
        return factory.forEach(AgentEachDay.class)
                .filter(agent -> !agent.isVirtual())
                .penalizeConfigurableLong(
                        // 基于订单量的均衡
                        a -> (long) Math.pow(a.getTickets().size(), 2)
                )
                .asConstraint(BALANCE_AGENT_LOADING);
    }


    /**
     * 负载均衡（负载比例）
     *
     * @param factory
     * @return
     */
    protected Constraint balanceAgentLoadingRatio(ConstraintFactory factory) {
        return factory.forEach(AgentEachDay.class)
                .filter(agent -> !agent.isVirtual())
                .penalizeConfigurableLong(
                        // 基于负载比例的均衡
                        a -> {
                            Agent.Capacity c = a.getTickets().stream().filter(t -> t.getType() == Ticket.Type.Delv)
                                    .map(t -> new Agent.Capacity(t.getWeight(), t.getVol())).reduce(new Agent.Capacity(0, 0), Agent.Capacity::add);

                            return (long) Math.pow(Math.max(10 * (c.weight() / a.getWeight() + c.vol() / a.getVol()), 1), 2);
                        }
                )
                .asConstraint(BALANCE_AGENT_LOADING_RATIO);
    }


    /**
     * 负载均衡（在途时间 + 工单服务时长）
     *
     * @param factory
     * @return
     */
    protected Constraint balanceAgentWorkingTime(ConstraintFactory factory) {
        return factory.forEach(AgentEachDay.class)
                .filter(agent -> !agent.isVirtual())
                .penalizeConfigurableLong(
                        // 基于工作时长的均衡 总在途时间 + 总工单服务时长
                        a -> (long) Math.pow((
                                Math.ceil((double) (a.getTotalDrivingTimeSeconds() + a.getTickets().stream().map(t -> t.getDuration().toSeconds()).mapToLong(Long::longValue).sum()) / 3600)), 2)
                )
                .asConstraint(BALANCE_AGENT_WORKING_TIME);
    }



    /**
     * 最小工单分派改动
     * 工单变动可能导致工作环境变得更加复杂
     *
     * @param factory
     * @return
     */
    protected Constraint minimizeTicketChanging(ConstraintFactory factory) {
        return factory.forEach(Ticket.class)
                .filter(Ticket::isMoved)
                .penalizeConfigurableLong(
                        t -> t.isMoved() ? 1L : 0L
                )
                .justifyWith(
                        (ticket, score) -> new AgentJustification.TicketChanging(
                                ticket.getId(), ticket.getOriginalAgent().getId(), ticket.getAgent().getId(),
                                ticket.getOriginalOrder(), ticket.getAgent().getTickets().indexOf(ticket)
                        )
                )
                .asConstraint(MINIMIZE_TICKET_CHANGING);
    }

    /**
     * 虚拟工程师约束
     *
     * @param factory
     * @return
     */
    protected Constraint agentIsVirtual(ConstraintFactory factory) {
        return factory.forEach(Ticket.class)
                .filter(ticket -> ticket.getAgent() != null && ticket.getAgent().isVirtual())
                .penalizeConfigurableLong(
                        (ticket) -> 1L
                )
                .justifyWith((ticket, score) -> new AgentJustification.IsVirtual(ticket.getId(), ticket.getAgent().getId()))
                .asConstraint(AGENT_IS_VIRTUAL);
    }
}
