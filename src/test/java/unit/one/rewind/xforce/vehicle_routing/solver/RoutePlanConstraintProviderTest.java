package one.rewind.xforce.vehicle_routing.solver;

import one.rewind.xforce.geo.POI;
import one.rewind.xforce.geo.transit.Transit;
import one.rewind.xforce.geo.transit.TransitMatrix;
import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.domain.agent.Agent;
import one.rewind.xforce.vehicle_routing.domain.agent.AgentEachDay;
import one.rewind.xforce.vehicle_routing.domain.cost.CostParameter;
import one.rewind.xforce.vehicle_routing.domain.ticket.Ticket;
import org.junit.jupiter.api.Test;
import org.optaplanner.test.api.score.stream.ConstraintVerifier;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;

class RoutePlanConstraintProviderTest {

    private final RoutePlanConstraintProvider constraints = new RoutePlanConstraintProvider();

    private final ConstraintVerifier<RoutePlanConstraintProvider, RoutePlan> constraintVerifier =
            ConstraintVerifier.build(constraints, RoutePlan.class, AgentEachDay.class, Ticket.class);

    @Test
    void agentCapacityPenalizesTransitLoadAboveOverloadCapacity() {
        AgentEachDay agent = agent("agent-1", "depo-a", List.of("Delv"));
        agent.setWeight(5);
        agent.setVol(10);
        agent.costParameter = new CostParameter();

        Ticket ticket = ticket("ticket-1", "depo-a", Ticket.Type.Delv, List.of("Delv"));
        ticket.setWeight(8);
        ticket.setVol(1);
        ticket.setAgent(agent);
        agent.getTickets().add(ticket);

        constraintVerifier.verifyThat(RoutePlanConstraintProvider::agentCapacity)
                .given(agent)
                .penalizesBy(2);
    }

    @Test
    void agentMaxTicketPenalizesTicketsAboveConfiguredLimit() {
        AgentEachDay agent = agent("agent-1", "depo-a", List.of("Delv"));
        agent.setMaxTicketNum(2);
        assignedTicket("ticket-1", agent);
        assignedTicket("ticket-2", agent);
        assignedTicket("ticket-3", agent);

        constraintVerifier.verifyThat(RoutePlanConstraintProvider::agentMaxTicket)
                .given(agent)
                .penalizesBy(1);
    }

    @Test
    void agentSkillConstraintPenalizesMissingTicketSkill() {
        AgentEachDay agent = agent("agent-1", "depo-a", List.of("Delv"));
        Ticket ticket = ticket("ticket-1", "depo-a", Ticket.Type.Inst, List.of("Inst"));
        ticket.setAgent(agent);

        constraintVerifier.verifyThat(RoutePlanConstraintProvider::agentSkillsAccordWithTicketSkills)
                .given(ticket)
                .penalizesBy(1);
    }

    @Test
    void agentSkillConstraintPenalizesEmptyAgentSkillsWhenTicketRequiresSkills() {
        AgentEachDay agent = agent("agent-1", "depo-a", List.of());
        Ticket ticket = ticket("ticket-1", "depo-a", Ticket.Type.Inst, List.of("Inst"));
        ticket.setAgent(agent);

        constraintVerifier.verifyThat(RoutePlanConstraintProvider::agentSkillsAccordWithTicketSkills)
                .given(ticket)
                .penalizesBy(1);
    }

    @Test
    void agentSkillConstraintDoesNotPenalizeEmptyRequirementsForAgentWithoutSkills() {
        AgentEachDay agent = agent("agent-1", "depo-a", List.of());
        Ticket ticket = ticket("ticket-1", "depo-a", Ticket.Type.Inst, List.of());
        ticket.setAgent(agent);

        constraintVerifier.verifyThat(RoutePlanConstraintProvider::agentSkillsAccordWithTicketSkills)
                .given(ticket)
                .penalizesBy(0);
    }

    @Test
    void qualificationConstraintPenalizesInsufficientAgentLevel() {
        AgentEachDay agent = agent("agent-1", "depo-a", List.of("Inst"));
        agent.setQualificationLevels(Map.of("install", 1.0));

        Ticket ticket = ticket("ticket-1", "depo-a", Ticket.Type.Inst, List.of("Inst"));
        ticket.setQualificationLevelsRequired(Map.of("install", 2.0));
        ticket.setAgent(agent);

        constraintVerifier.verifyThat(RoutePlanConstraintProvider::agentQualificationLevelsMatchTicket)
                .given(ticket)
                .penalizesBy(1);
    }

    @Test
    void refTicketAfterDepTicketPenalizesChildArrivingBeforeDependency() {
        AgentEachDay agent = agent("agent-1", "depo-a", List.of("Delv"));
        Ticket dependency = assignedTicket("ticket-parent", agent);
        dependency.setArrivalTime(LocalDateTime.of(2026, 1, 2, 10, 0));
        Ticket child = assignedTicket("ticket-child", agent);
        child.setArrivalTime(LocalDateTime.of(2026, 1, 2, 9, 15));
        child.getDepTickets().add(dependency);

        constraintVerifier.verifyThat(RoutePlanConstraintProvider::refTicketMustAfterDepTicket)
                .given(child, dependency)
                .penalizesBy(45);
    }

    @Test
    void refTicketSameAgentWithDepTicketPenalizesDifferentAgents() {
        AgentEachDay parentAgent = agent("agent-parent", "depo-a", List.of("Delv"));
        AgentEachDay childAgent = agent("agent-child", "depo-a", List.of("Delv"));
        Ticket dependency = assignedTicket("ticket-parent", parentAgent);
        dependency.setArrivalTime(LocalDateTime.of(2026, 1, 2, 9, 0));
        Ticket child = assignedTicket("ticket-child", childAgent);
        child.setArrivalTime(LocalDateTime.of(2026, 1, 2, 10, 0));
        child.getDepTickets().add(dependency);

        constraintVerifier.verifyThat(RoutePlanConstraintProvider::refTicketSameAgentWithDepTicket)
                .given(child, dependency)
                .penalizesBy(1);
    }

    @Test
    void serviceFinishedAfterMaxEndTimePenalizesDelayMinutes() {
        AgentEachDay agent = agent("agent-1", "depo-a", List.of("Delv"));
        Ticket ticket = assignedTicket("ticket-1", agent);
        ticket.setArrivalTime(LocalDateTime.of(2026, 1, 2, 12, 0));
        ticket.setDuration(Duration.ofMinutes(30));
        ticket.setMaxEndTime(LocalDateTime.of(2026, 1, 2, 12, 10));

        constraintVerifier.verifyThat(RoutePlanConstraintProvider::serviceFinishedAfterMaxEndTime)
                .given(ticket)
                .penalizesBy(20);
    }

    @Test
    void ticketStartServiceTimeMatchExpectedPenalizesLateStart() {
        AgentEachDay agent = agent("agent-1", "depo-a", List.of("Delv"));
        Ticket ticket = assignedTicket("ticket-1", agent);
        ticket.setMinStartTime(LocalDateTime.of(2026, 1, 2, 8, 0));
        ticket.setMaxEndTime(LocalDateTime.of(2026, 1, 2, 10, 0));
        ticket.setArrivalTime(LocalDateTime.of(2026, 1, 2, 11, 30));

        constraintVerifier.verifyThat(RoutePlanConstraintProvider::ticketStartServiceTimeMatchExpected)
                .given(ticket)
                .penalizesBy(90);
    }

    @Test
    void ticketArrivalTimeSameDateWithPlanTimePenalizesDifferentDate() {
        AgentEachDay agent = agent("agent-1", "depo-a", List.of("Delv"));
        Ticket ticket = assignedTicket("ticket-1", agent);
        ticket.setMinStartTime(LocalDateTime.of(2026, 1, 2, 8, 0));
        ticket.setArrivalTime(LocalDateTime.of(2026, 1, 3, 8, 0));

        constraintVerifier.verifyThat(RoutePlanConstraintProvider::ticketArrivalTimeSameDateWithPlanTime)
                .given(ticket)
                .penalizesBy(1);
    }

    @Test
    void relationTicketsSameAgentPenalizesDifferentAgents() {
        AgentEachDay firstAgent = agent("agent-1", "depo-a", List.of("Delv"));
        AgentEachDay secondAgent = agent("agent-2", "depo-a", List.of("Delv"));
        Ticket first = assignedTicket("ticket-1", firstAgent);
        Ticket related = assignedTicket("ticket-2", secondAgent);
        first.getRefTickets().add(related);

        constraintVerifier.verifyThat(RoutePlanConstraintProvider::relationTicketsSameAgent)
                .given(first, related)
                .penalizesBy(1);
    }

    @Test
    void minimizeTravelTimePenalizesAgentRoundTripDrivingTime() {
        AgentEachDay agent = agent("agent-1", "depo-a", List.of("Delv"));
        Ticket ticket = assignedTicket("ticket-1", agent);
        agent.matrix = new TransitMatrix()
                .put(agent.getStartLoc().id, ticket.getLoc().id, new Transit(1_000, 600))
                .put(ticket.getLoc().id, agent.getStartLoc().id, new Transit(500, 300));

        constraintVerifier.verifyThat(RoutePlanConstraintProvider::minimizeTravelTime)
                .given(agent)
                .penalizesBy(900);
    }

    @Test
    void minimizeTravelDistancePenalizesAgentRoundTripDistance() {
        AgentEachDay agent = agent("agent-1", "depo-a", List.of("Delv"));
        Ticket ticket = assignedTicket("ticket-1", agent);
        agent.matrix = new TransitMatrix()
                .put(agent.getStartLoc().id, ticket.getLoc().id, new Transit(1_000, 600))
                .put(ticket.getLoc().id, agent.getStartLoc().id, new Transit(500, 300));

        constraintVerifier.verifyThat(RoutePlanConstraintProvider::minimizeTravelDistance)
                .given(agent)
                .penalizesBy(1_500);
    }

    @Test
    void minimizeAgentFixedCostIncludesTrafficRestrictionCharge() {
        AgentEachDay agent = agent("agent-1", "depo-a", List.of("Delv"));
        agent.setFixCostDaily(50);
        agent.setRestrict(true);
        Ticket ticket = assignedTicket("ticket-1", agent);
        agent.matrix = new TransitMatrix()
                .put(agent.getStartLoc().id, ticket.getLoc().id, new Transit(1_000, 3_600))
                .put(ticket.getLoc().id, agent.getStartLoc().id, new Transit(1_000, 3_600));

        constraintVerifier.verifyThat(RoutePlanConstraintProvider::minimizeAgentFixedCost)
                .given(agent)
                .penalizesBy(150);
    }

    @Test
    void sameDepoConstraintPenalizesDifferentDepoAssignment() {
        AgentEachDay agent = agent("agent-1", "depo-b", List.of("Delv"));
        Ticket ticket = ticket("ticket-1", "depo-a", Ticket.Type.Delv, List.of("Delv"));
        ticket.setAgent(agent);

        constraintVerifier.verifyThat(RoutePlanConstraintProvider::sameDepo)
                .given(ticket)
                .penalizesBy(1);
    }

    @Test
    void balanceAgentLoadingPenalizesSquaredTicketCount() {
        AgentEachDay agent = agent("agent-1", "depo-a", List.of("Delv"));
        assignedTicket("ticket-1", agent);
        assignedTicket("ticket-2", agent);
        assignedTicket("ticket-3", agent);

        constraintVerifier.verifyThat(RoutePlanConstraintProvider::balanceAgentLoading)
                .given(agent)
                .penalizesBy(9);
    }

    @Test
    void balanceAgentLoadingRatioPenalizesPayloadUsageRatio() {
        AgentEachDay agent = agent("agent-1", "depo-a", List.of("Delv"));
        agent.setWeight(10);
        agent.setVol(10);
        Ticket ticket = assignedTicket("ticket-1", agent);
        ticket.setWeight(2);
        ticket.setVol(3);

        constraintVerifier.verifyThat(RoutePlanConstraintProvider::balanceAgentLoadingRatio)
                .given(agent)
                .penalizesBy(25);
    }

    @Test
    void balanceAgentWorkingTimePenalizesSquaredRoundedWorkingHours() {
        AgentEachDay agent = agent("agent-1", "depo-a", List.of("Delv"));
        Ticket ticket = assignedTicket("ticket-1", agent);
        ticket.setDuration(Duration.ofMinutes(120));

        constraintVerifier.verifyThat(RoutePlanConstraintProvider::balanceAgentWorkingTime)
                .given(agent)
                .penalizesBy(4);
    }

    @Test
    void minimizeTicketChangingPenalizesChangedAgentAssignment() {
        AgentEachDay originalAgent = agent("agent-original", "depo-a", List.of("Delv"));
        AgentEachDay newAgent = agent("agent-new", "depo-a", List.of("Delv"));
        Ticket ticket = assignedTicket("ticket-1", newAgent);
        ticket.setOriginalAgent(originalAgent);
        ticket.setOriginalOrder(0);

        constraintVerifier.verifyThat(RoutePlanConstraintProvider::minimizeTicketChanging)
                .given(ticket)
                .penalizesBy(1);
    }

    @Test
    void agentIsVirtualConstraintIgnoresUnassignedTicketsAndPenalizesVirtualAgent() {
        Ticket unassignedTicket = ticket("ticket-unassigned", "depo-a", Ticket.Type.Delv, List.of("Delv"));

        AgentEachDay virtualAgent = agent("agent-virtual", "depo-a", List.of("Delv"));
        virtualAgent.setVirtual(true);
        Ticket virtualAssignedTicket = ticket("ticket-virtual", "depo-a", Ticket.Type.Delv, List.of("Delv"));
        virtualAssignedTicket.setAgent(virtualAgent);

        constraintVerifier.verifyThat(RoutePlanConstraintProvider::agentIsVirtual)
                .given(unassignedTicket, virtualAssignedTicket)
                .penalizesBy(1);
    }

    private static AgentEachDay agent(String id, String depoId, List<String> skills) {
        Agent agent = new Agent(id, id, depoId, new POI("start-" + id), skills, 10, 10);
        AgentEachDay agentEachDay = new AgentEachDay(agent, LocalDate.of(2026, 1, 2), LocalTime.of(8, 0), LocalTime.of(18, 0));
        agentEachDay.costParameter = new CostParameter();
        return agentEachDay;
    }

    private static Ticket assignedTicket(String id, AgentEachDay agent) {
        Ticket ticket = ticket(id, agent.getDepoId(), Ticket.Type.Delv, List.of("Delv"));
        ticket.setAgent(agent);
        agent.getTickets().add(ticket);
        return ticket;
    }

    private static Ticket ticket(String id, String depoId, Ticket.Type type, List<String> skills) {
        LocalDateTime createTime = LocalDateTime.of(2026, 1, 1, 9, 0);
        return new Ticket(
                id,
                depoId,
                false,
                type,
                skills,
                1,
                1,
                new POI("poi-" + id),
                createTime,
                createTime.plusHours(1),
                createTime.plusHours(8)
        );
    }
}
