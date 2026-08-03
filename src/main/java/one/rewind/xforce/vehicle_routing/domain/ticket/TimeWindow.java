package one.rewind.xforce.vehicle_routing.domain.ticket;

import java.time.LocalTime;

/**
 * 时间窗类
 */
public class TimeWindow {

    public int delay_days;

    public LocalTime st;

    public LocalTime et;

    public TimeWindow() {}

    public TimeWindow(int delay_days, LocalTime st, LocalTime et) {
        this.delay_days = delay_days;
        this.st = st;
        this.et = et;
    }
}
