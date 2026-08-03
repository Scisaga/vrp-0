package one.rewind.xforce.vehicle_routing.bootstrap;

import one.rewind.xforce.vehicle_routing.domain.ticket.Ticket;
import one.rewind.xforce.vehicle_routing.domain.ticket.TimeWindow;

import java.time.LocalTime;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Supplier;

/**
 * 时间窗定义
 */
public class TimeWindowSupplier implements Supplier<LinkedHashMap<TimeWindow, Double>> {

    enum Type {
        Next_1D,
        Next_1D_TW3,
        Next_3D,
        Next_3D_TW3
    }

    static LinkedHashMap<TimeWindow, Double> Next_1D = new LinkedHashMap<>(Map.of(
            new TimeWindow(1, LocalTime.of(9, 0), LocalTime.of(21, 0)), 1D
    ));

    static LinkedHashMap<TimeWindow, Double> Next_1D_TW3 = new LinkedHashMap<>(Map.of(
            new TimeWindow(1, LocalTime.of(9, 0), LocalTime.of(12, 0)), 1D / 3,
            new TimeWindow(1, LocalTime.of(13, 0), LocalTime.of(18, 0)), 1D / 3,
            new TimeWindow(1, LocalTime.of(19, 0), LocalTime.of(21, 0)), 1D / 3
    ));

    static LinkedHashMap<TimeWindow, Double> Next_3D = new LinkedHashMap<>(Map.of(
            new TimeWindow(1, LocalTime.of(9, 0), LocalTime.of(21, 0)), 1D / 3,
            new TimeWindow(2, LocalTime.of(9, 0), LocalTime.of(21, 0)), 1D / 3,
            new TimeWindow(3, LocalTime.of(9, 0), LocalTime.of(21, 0)), 1D / 3
    ));

    static LinkedHashMap<TimeWindow, Double> Next_3D_TW3 = new LinkedHashMap<>(Map.of(
            new TimeWindow(1, LocalTime.of(9, 0), LocalTime.of(12, 0)), 1D / 9,
            new TimeWindow(1, LocalTime.of(13, 0), LocalTime.of(18, 0)), 1D / 9,
            new TimeWindow(1, LocalTime.of(19, 0), LocalTime.of(21, 0)), 1D / 9,
            new TimeWindow(2, LocalTime.of(9, 0), LocalTime.of(12, 0)), 1D / 9,
            new TimeWindow(2, LocalTime.of(13, 0), LocalTime.of(18, 0)), 1D / 9,
            new TimeWindow(2, LocalTime.of(19, 0), LocalTime.of(21, 0)), 1D / 9,
            new TimeWindow(3, LocalTime.of(9, 0), LocalTime.of(12, 0)), 1D / 9,
            new TimeWindow(3, LocalTime.of(13, 0), LocalTime.of(18, 0)), 1D / 9,
            new TimeWindow(3, LocalTime.of(19, 0), LocalTime.of(21, 0)), 1D / 9
    ));

    private Type type = Type.Next_1D;

    public TimeWindowSupplier() {}

    public TimeWindowSupplier(Type type) {
        this.type = type;
    }

    @Override
    public LinkedHashMap<TimeWindow, Double> get() {
        return switch (type) {
            case Next_1D -> Next_1D;
            case Next_1D_TW3 -> Next_1D_TW3;
            case Next_3D -> Next_3D;
            case Next_3D_TW3 -> Next_3D_TW3;
            default -> Next_1D;
        };
    }
}
