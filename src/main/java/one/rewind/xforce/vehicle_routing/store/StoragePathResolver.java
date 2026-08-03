package one.rewind.xforce.vehicle_routing.store;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

public final class StoragePathResolver {

    private StoragePathResolver() {}

    public static Path resolve(String configuredDir) {
        Path workingDir = Paths.get(System.getProperty("user.dir", "."))
                .toAbsolutePath()
                .normalize();
        return resolve(configuredDir, workingDir);
    }

    public static Path resolve(String configuredDir, Path workingDir) {
        Path configuredPath = Paths.get(configuredDir);
        if (configuredPath.isAbsolute()) {
            return configuredPath.normalize();
        }

        Path normalizedWorkingDir = workingDir.toAbsolutePath().normalize();
        Path projectRoot = findProjectRoot(normalizedWorkingDir);
        return projectRoot.resolve(configuredPath).normalize();
    }

    static Path findProjectRoot(Path start) {
        for (Path current = start; current != null; current = current.getParent()) {
            if (looksLikeProjectRoot(current)) {
                return current;
            }
        }
        return start;
    }

    private static boolean looksLikeProjectRoot(Path candidate) {
        return Files.exists(candidate.resolve("settings.gradle.kts"))
                || Files.exists(candidate.resolve("build.gradle.kts"))
                || Files.exists(candidate.resolve("gradlew"))
                || Files.exists(candidate.resolve("gradlew.bat"))
                || Files.isDirectory(candidate.resolve(".git"));
    }
}
