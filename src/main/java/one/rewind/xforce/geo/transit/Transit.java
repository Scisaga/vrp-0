package one.rewind.xforce.geo.transit;

import com.fasterxml.jackson.annotation.JsonFormat;
import io.quarkus.runtime.annotations.RegisterForReflection;

import java.io.Serializable;
import java.text.DecimalFormat;
import java.time.LocalDateTime;

/**
 * 在途距离时间
 * @param distance
 * @param duration
 * @param create_time
 */
@RegisterForReflection(serialization = true)
public record Transit(long distance, long duration, @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss") LocalDateTime create_time) implements Serializable {

    public Transit(long distance, long duration) {
        this(distance, duration, LocalDateTime.now());
    }

    public static Transit ZERO = new Transit(0, 0);

    public static Transit MAX = new Transit(Long.MAX_VALUE, Long.MAX_VALUE);

    private static final DecimalFormat df = new DecimalFormat("#.0");

    public String toString() {
        return df.format((distance)/1000D) + "/" + df.format(duration/60D);
    }

}
