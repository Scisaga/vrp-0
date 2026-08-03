package one.rewind.xforce.vehicle_routing.db.dto;

import one.rewind.xforce.vehicle_routing.solver.Status;

import java.time.LocalDateTime;

/**
 * 求解任务列表的可选筛选条件。
 *
 * <p>所有字段均为 {@code null} 时表示不筛选，保持任务创建时间倒序的完整历史列表。</p>
 */
public record SolverJobListFilter(
        Status status,
        LocalDateTime createTimeFrom,
        LocalDateTime createTimeTo,
        Boolean buildTransitMatrix,
        String matrixMode,
        Boolean drawRoute
) {

    public static SolverJobListFilter all() {
        return new SolverJobListFilter(null, null, null, null, null, null);
    }
}
