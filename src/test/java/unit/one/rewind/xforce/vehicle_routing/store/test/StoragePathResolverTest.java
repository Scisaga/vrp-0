package one.rewind.xforce.vehicle_routing.store.test;

import one.rewind.xforce.vehicle_routing.store.StoragePathResolver;
import org.junit.jupiter.api.Test;

import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;

class StoragePathResolverTest {

    @Test
    void resolveRelativePathAgainstProjectRootWhenRunningFromBuildClasses() {
        Path projectRoot = Path.of("").toAbsolutePath().normalize();
        Path start = projectRoot.resolve("build/classes/java/main");

        Path resolved = StoragePathResolver.resolve("data/scenarios", start);

        assertEquals(projectRoot.resolve("data/scenarios").normalize(), resolved);
    }

    @Test
    void keepAbsolutePathUntouched() {
        Path absolute = Path.of("build/tmp/vrp-data").toAbsolutePath().normalize();

        Path resolved = StoragePathResolver.resolve(absolute.toString());

        assertEquals(absolute, resolved);
    }
}
