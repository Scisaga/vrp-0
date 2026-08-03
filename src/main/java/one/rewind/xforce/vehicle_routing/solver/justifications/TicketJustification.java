package one.rewind.xforce.vehicle_routing.solver.justifications;

import one.rewind.xforce.vehicle_routing.domain.ticket.Ticket;
import org.optaplanner.core.api.score.stream.ConstraintJustification;

import java.time.LocalDateTime;
import java.util.List;

public class TicketJustification {

    /**
     *
     * @param ticketId
     * @param arrivalTime
     * @param planTimeBegin
     * @param description
     */
    public record ArrivalTimeNotSameDateWithPlanTime(String ticketId,
                                                           LocalDateTime arrivalTime, LocalDateTime planTimeBegin,
                                                           String description) implements ConstraintJustification {

        public ArrivalTimeNotSameDateWithPlanTime(String ticketId, LocalDateTime arrivalTime, LocalDateTime planTimeBegin) {
            this(ticketId, arrivalTime, planTimeBegin,
                    "Ticket '%s' 's arrival time '%s' not same date with plan time begin '%s'."
                            .formatted(ticketId, arrivalTime, planTimeBegin));
        }
    }

    /**
     *
     * @param ticketId
     * @param startServiceTime
     * @param planTimeStart
     * @param planTimeEnd
     * @param description
     */
    public record StartServiceTimeMatchExpected(String ticketId,
                                                LocalDateTime startServiceTime,
                                                LocalDateTime planTimeStart,
                                                LocalDateTime planTimeEnd,
                                                String description) implements ConstraintJustification {

        public StartServiceTimeMatchExpected(String ticketId,
                                             LocalDateTime startServiceTime,
                                             LocalDateTime planTimeStart,
                                             LocalDateTime planTimeEnd) {
            this(ticketId, startServiceTime, planTimeStart, planTimeEnd,
                    "Ticket '%s' 's ['%s': '%s'], start service time '%s' ."
                            .formatted(ticketId, startServiceTime, planTimeStart, planTimeEnd));
        }
    }

    /**
     *
     * @param ticketId
     * @param serviceFinishedDelayInMinutes
     * @param description
     */
    public record ServiceFinishedAfterMaxEndTime(String ticketId, long serviceFinishedDelayInMinutes, String description) implements ConstraintJustification {

        public ServiceFinishedAfterMaxEndTime(String ticketId, long serviceFinishedDelayInMinutes) {
            this(ticketId, serviceFinishedDelayInMinutes, "Ticket '%s' serviced with a %s-minute delay."
                    .formatted(ticketId, serviceFinishedDelayInMinutes));
        }
    }

    /**
     *
     * @param ticketId
     * @param agentId
     * @param description
     */
    public record NotSameDepo(String ticketId, String agentId, String description) implements ConstraintJustification {

        public NotSameDepo(String ticketId, String agentId) {
            this(ticketId, agentId,
                    "Agent '%s' Ticket '%s' not same depo."
                            .formatted(agentId, ticketId));
        }
    }

    /**
     *
     * @param ticketId
     * @param agentId
     * @param relationTicketId
     */
    public record RelationTicketsSameAgent(String ticketId, String agentId, String relationTicketId, String description) implements ConstraintJustification {

        public RelationTicketsSameAgent(String ticketId, String agentId, String relationTicketId) {
            this(ticketId, agentId, relationTicketId,
                    "Ticket '%s' 's agent id is '%s', relation tickets but not same agent: '%s'."
                            .formatted(ticketId, agentId,  relationTicketId));
        }
    }
}
