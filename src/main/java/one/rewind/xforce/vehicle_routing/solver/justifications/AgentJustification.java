package one.rewind.xforce.vehicle_routing.solver.justifications;

import one.rewind.xforce.vehicle_routing.domain.agent.Agent;
import org.optaplanner.core.api.score.stream.ConstraintJustification;

import java.time.Duration;
import java.util.List;
import java.util.Map;

public class AgentJustification {

    /**
     * @author Yang Zhongwei
     * @date 2025/3/13
     * @description
     */
    public record IsVirtual(String ticketId, String agentId, String description) implements ConstraintJustification {

        public IsVirtual(String ticketId, String agentId) {
            this(ticketId, agentId, "Ticket '%s' 's agent '%s' is virtual.".formatted(ticketId, agentId));
        }
    }

    /**
     *
     * @param agentId
     * @param capacity
     * @param transitLoading
     * @param description
     */
    public record Capacity(String agentId, Agent.Capacity capacity, Agent.Capacity transitLoading, String description) implements ConstraintJustification {

        public Capacity(String agentId, Agent.Capacity capacity, Agent.Capacity transitLoading) {
            this(agentId, capacity, transitLoading, "Vehicle '%s' exceeded its max capacity by %s."
                    .formatted(agentId, capacity.getPenalty(transitLoading)));
        }
    }

    /**
     *
     * @param agentId
     * @param maxTicketNumber
     * @param ticketNumber
     * @param description
     */
    public record MaxTicket(String agentId, int maxTicketNumber, long ticketNumber, String description) implements ConstraintJustification {

        public MaxTicket(String agentId, int maxTicketNumber, long ticketNumber) {
            this(agentId, maxTicketNumber, ticketNumber, "Agent '%s' exceeded its max ticket number [%s] by %s."
                    .formatted(agentId, maxTicketNumber, ticketNumber));
        }
    }


    /**
     *
     * @param agentName
     * @param totalDrivingTimeSeconds
     * @param description
     */
    public record MinimizeTravelTime(String agentName, long totalDrivingTimeSeconds, String description) implements ConstraintJustification {

        public MinimizeTravelTime(String agentName, long totalDrivingTimeSeconds) {
            this(agentName, totalDrivingTimeSeconds, "Agent '%s' total travel time is %s."
                    .formatted(agentName, formatDrivingTime(totalDrivingTimeSeconds)));
        }

        private static String formatDrivingTime(long drivingTimeSeconds) {
            Duration drivingTime = Duration.ofSeconds(drivingTimeSeconds);
            return "%s hours %s minutes".formatted(drivingTime.toHours(),
                    drivingTime.toSecondsPart() >= 30 ? drivingTime.toMinutesPart() + 1 : drivingTime.toMinutesPart());
        }
    }

    /**
     *
     * @param ticketId
     * @param agentId
     * @param ticketQualificationLevelsRequired
     * @param agentQualificationLevels
     * @param description
     */
    public record QualificationLevelsMatchTicket(String ticketId, String agentId,
                                                 Map<String, Double> ticketQualificationLevelsRequired,
                                                 Map<String, Double> agentQualificationLevels,
                                                 String description) implements ConstraintJustification {

        public QualificationLevelsMatchTicket(String ticketId, String agentId,
                                              Map<String, Double> ticketQualificationLevelsRequired,
                                              Map<String, Double> agentQualificationLevels) {
            this(ticketId, agentId, ticketQualificationLevelsRequired, agentQualificationLevels,
                    "Agent '%s' 's qualification levels '%s' not match ticket '%s' 's qualification levels '%s'."
                            .formatted(agentId, agentQualificationLevels, ticketId, ticketQualificationLevelsRequired));
        }
    }

    /**
     *
     * @param ticketId
     * @param agentId
     * @param ticketSkillsRequired
     * @param agentSkills
     * @param description
     */
    public record SkillsNotMatchTicketSkillsRequired(String ticketId, String agentId,
                                                          List<String> ticketSkillsRequired,
                                                          List<String> agentSkills, String description) implements ConstraintJustification {

        public SkillsNotMatchTicketSkillsRequired(String ticketId, String agentId, List<String> ticketSkillsRequired, List<String> agentSkills) {
            this(ticketId, agentId, ticketSkillsRequired, agentSkills,
                    "Agent '%s' 's skills '%s' not contains all ticket '%s' required skills '%s'."
                            .formatted(agentId, agentSkills, ticketId, ticketSkillsRequired));
        }
    }

    /**
     * @author Yang Zhongwei
     * @date 2025/3/13
     * @description
     */
    public record TicketChanging(String ticketId, String originalAgentId, String agentId,
                                         Integer originalOrder, Integer order, String description) implements ConstraintJustification {

        public TicketChanging(String ticketId, String originalAgentId, String agentId,
                                      Integer originalOrder, Integer order) {
            this(ticketId, originalAgentId, agentId, originalOrder, order,
                    "Ticket '%s' has been changed: original agent id '%s', current agent '%s', original order '%d', current order '%d'."
                            .formatted(ticketId, originalAgentId, agentId, originalOrder, order));
        }
    }
}
