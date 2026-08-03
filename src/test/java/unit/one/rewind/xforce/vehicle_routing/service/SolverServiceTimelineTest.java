package one.rewind.xforce.vehicle_routing.service;

import one.rewind.xforce.vehicle_routing.db.dto.SolutionMetrics;
import one.rewind.xforce.vehicle_routing.db.dto.SolverSearchProgress;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class SolverServiceTimelineTest {

    @Test
    void searchSampleKeepsOnlyRealSamplingDataWithoutSyntheticBestPoint() {
        SolutionMetrics sample = SolutionMetrics.searchSample(
                new SolverSearchProgress(
                        "0hard/0medium/-120soft",
                        "0hard/0medium/-100soft"
                ),
                1_760_000_000_000L,
                1_000L
        );

        assertEquals(SolutionMetrics.RecordType.SEARCH_SAMPLE, sample.getRecordType());
        assertEquals(1_000L, sample.getElapsedMillis());
        assertNull(sample.getMetrics());
        assertEquals("0hard/0medium/-120soft", sample.getSearchProgress().currentScore());
        assertEquals("0hard/0medium/-100soft", sample.getSearchProgress().bestScore());
    }
}
