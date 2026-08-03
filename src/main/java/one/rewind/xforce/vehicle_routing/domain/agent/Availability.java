package one.rewind.xforce.vehicle_routing.domain.agent;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;

/**
 * 描述Agent当日上班还是休假
 * 没用上
 */
@Deprecated
public class Availability {

    public String id;

    public String agent_id;

    public LocalDate date;

    public boolean on_duty;

    public Availability() {}

    /**
     *
     * @param agent_id
     * @param date
     * @param on_duty
     */
    public Availability(String agent_id, LocalDate date, boolean on_duty) {
        this.id = agent_id + "-" + date.format(DateTimeFormatter.ofPattern("yyMMdd"));
        this.agent_id = agent_id;
        this.date = date;
        this.on_duty = on_duty;
    }
}
