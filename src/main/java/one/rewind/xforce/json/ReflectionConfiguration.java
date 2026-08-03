package one.rewind.xforce.json;

import io.quarkus.runtime.annotations.RegisterForReflection;
import org.apache.logging.log4j.core.impl.ExtendedStackTraceElement;
import org.apache.logging.log4j.core.impl.ThrowableProxy;
import org.optaplanner.core.api.score.buildin.hardmediumsoftlong.HardMediumSoftLongScore;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedList;

@RegisterForReflection(serialization = true, targets = {
        HardMediumSoftLongScore.class,
        String.class,
        ArrayList.class,
        LinkedList.class,
        HashMap.class,
        LinkedHashMap.class,
        LocalDateTime.class,
        LocalDate.class,
        Duration.class,
        NoSuchMethodException.class,
        IllegalStateException.class,
        ThrowableProxy.class,
        ExtendedStackTraceElement.class
})
public class ReflectionConfiguration {

}
