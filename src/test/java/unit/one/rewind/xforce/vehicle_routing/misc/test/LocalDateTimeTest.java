package one.rewind.xforce.vehicle_routing.misc.test;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.LocalDateTime;

import static org.junit.jupiter.api.Assertions.assertEquals;

public class LocalDateTimeTest {

    @Test
    public void test() {
        LocalDateTime t1 = LocalDateTime.of(2026, 1, 1, 0, 0);
        LocalDateTime t2 = t1.plus(Duration.ofHours(72));
        long days = Duration.between(t1, t2).toDays();
        assertEquals(3, days);
    }
}
