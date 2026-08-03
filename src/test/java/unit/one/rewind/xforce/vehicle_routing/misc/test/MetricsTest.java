package one.rewind.xforce.vehicle_routing.misc.test;

import org.junit.jupiter.api.Test;

import java.io.File;

import static org.junit.jupiter.api.Assertions.assertTrue;

public class MetricsTest {

    @Test
    public void test() {
        File root = new File("/");
        double diskTotal = (double)root.getTotalSpace() /1073741824;
        double diskFree = (double)root.getFreeSpace() /1073741824;
        assertTrue(diskTotal > 0);
        assertTrue(diskFree >= 0);
        assertTrue(diskFree <= diskTotal);
    }
}
