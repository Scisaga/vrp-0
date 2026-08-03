package one.rewind.xforce.vehicle_routing.db.repository;

import io.quarkus.runtime.annotations.RegisterForReflection;
import jakarta.annotation.PostConstruct;
import jakarta.enterprise.context.ApplicationScoped;
import one.rewind.xforce.geo.transit.TransitMatrix;
import one.rewind.xforce.vehicle_routing.db.dto.Scenario;
import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.service.ScenarioReferenceNormalizer;
import one.rewind.xforce.vehicle_routing.store.FileStoreUtil;
import one.rewind.xforce.vehicle_routing.store.StoragePathResolver;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.io.IOException;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.locks.ReentrantReadWriteLock;

@ApplicationScoped
public class ScenarioRepository {

    @ConfigProperty(name = "vrp.scenario.store.dir", defaultValue = "./data/scenarios/")
    String baseDir;

    private Path basePath;

    private final ReentrantReadWriteLock lock = new ReentrantReadWriteLock();

    @PostConstruct
    void init() {
        basePath = StoragePathResolver.resolve(baseDir);
    }

    public Scenario getCurrent() {
        lock.readLock().lock();
        try {
            Path dir = currentDir();
            if (!Files.exists(scenarioPath(dir))) {
                return null;
            }
            Scenario scenario = FileStoreUtil.readJson(scenarioPath(dir), Scenario.class);
            if (scenario == null) {
                return null;
            }
            ScenarioMeta meta = FileStoreUtil.readJson(metaPath(dir), ScenarioMeta.class);
            if (meta != null) {
                scenario.setId(meta.id);
                if (scenario.getCreateTime() == null) {
                    scenario.setCreateTime(meta.createTime);
                }
                if (scenario.getUpdateTime() == null) {
                    scenario.setUpdateTime(meta.updateTime);
                }
            }
            ScenarioReferenceNormalizer.normalize(scenario);

            TransitMatrix matrix = FileStoreUtil.readGzipJson(matrixPath(dir), TransitMatrix.class);
            RoutePlan plan = scenario.getPlan();
            if (plan != null) {
                if (matrix != null) {
                    plan.setMatrix(matrix);
                }
                plan.init();
            }
            return scenario;
        } catch (IOException e) {
            throw new RuntimeException("Load current scenario failed", e);
        } finally {
            lock.readLock().unlock();
        }
    }

    public Scenario saveCurrent(Scenario scenario) {
        lock.writeLock().lock();
        try {
            ScenarioReferenceNormalizer.normalize(scenario);
            Scenario existing = loadCurrentWithoutLock();

            if (scenario.getId() == null) {
                scenario.setId(UUID.randomUUID());
            }
            if (scenario.getCreateTime() == null) {
                scenario.setCreateTime(existing != null && existing.getCreateTime() != null
                        ? existing.getCreateTime()
                        : LocalDateTime.now());
            }
            if (scenario.getUpdateTime() == null) {
                scenario.setUpdateTime(LocalDateTime.now());
            }

            Path dir = currentDir();
            FileStoreUtil.ensureDir(dir);

            RoutePlan plan = scenario.getPlan();
            TransitMatrix matrix = extractMatrix(plan);
            if (matrix != null && plan != null) {
                plan.setMatrix(null);
            }

            FileStoreUtil.writeJsonAtomic(scenarioPath(dir), scenario);
            FileStoreUtil.writeJsonAtomic(metaPath(dir), ScenarioMeta.from(scenario));

            if (matrix != null) {
                FileStoreUtil.writeGzipJsonAtomic(matrixPath(dir), matrix);
            } else {
                FileStoreUtil.deleteIfExists(matrixPath(dir));
            }

            if (matrix != null && plan != null) {
                plan.setMatrix(matrix);
            }

            return scenario;
        } catch (IOException e) {
            throw new RuntimeException("Save current scenario failed", e);
        } finally {
            lock.writeLock().unlock();
        }
    }

    public Scenario persist(Scenario scenario) {
        return saveCurrent(scenario);
    }

    public Scenario save(Scenario scenario) {
        return saveCurrent(scenario);
    }

    public Scenario findById(UUID id) {
        Scenario scenario = getCurrent();
        if (scenario == null) {
            return null;
        }
        if (id == null || Objects.equals(id, scenario.getId())) {
            return scenario;
        }
        return null;
    }

    public boolean exists() {
        lock.readLock().lock();
        try {
            return Files.exists(scenarioPath(currentDir()));
        } finally {
            lock.readLock().unlock();
        }
    }

    public boolean deleteCurrent() {
        lock.writeLock().lock();
        try {
            Path dir = currentDir();
            if (!Files.exists(dir)) {
                return false;
            }
            deleteDir(dir);
            return true;
        } catch (IOException e) {
            throw new RuntimeException("Delete current scenario failed", e);
        } finally {
            lock.writeLock().unlock();
        }
    }

    public boolean deleteById(UUID id) {
        Scenario current = getCurrent();
        if (current == null) {
            return false;
        }
        if (id != null && !Objects.equals(id, current.getId())) {
            return false;
        }
        return deleteCurrent();
    }

    public long count() {
        return exists() ? 1 : 0;
    }

    public void deleteAll() {
        lock.writeLock().lock();
        try {
            FileStoreUtil.ensureDir(basePath);
            try (DirectoryStream<Path> stream = Files.newDirectoryStream(basePath)) {
                for (Path path : stream) {
                    if (Files.isDirectory(path)) {
                        deleteDir(path);
                    } else {
                        Files.deleteIfExists(path);
                    }
                }
            }
        } catch (IOException e) {
            throw new RuntimeException("Delete all scenarios failed", e);
        } finally {
            lock.writeLock().unlock();
        }
    }

    private Scenario loadCurrentWithoutLock() throws IOException {
        Path dir = currentDir();
        if (!Files.exists(scenarioPath(dir))) {
            return null;
        }
        Scenario scenario = FileStoreUtil.readJson(scenarioPath(dir), Scenario.class);
        ScenarioMeta meta = FileStoreUtil.readJson(metaPath(dir), ScenarioMeta.class);
        if (scenario != null && meta != null) {
            scenario.setId(meta.id);
            scenario.setCreateTime(meta.createTime);
            scenario.setUpdateTime(meta.updateTime);
        }
        ScenarioReferenceNormalizer.normalize(scenario);
        return scenario;
    }

    private TransitMatrix extractMatrix(RoutePlan plan) {
        if (plan == null || plan.getMatrix() == null) {
            return null;
        }
        TransitMatrix matrix = plan.getMatrix();
        if (matrix.data == null || matrix.data.isEmpty()) {
            return null;
        }
        return matrix;
    }

    private Path currentDir() {
        return basePath.resolve("current");
    }

    private Path scenarioPath(Path dir) {
        return dir.resolve("scenario.json");
    }

    private Path metaPath(Path dir) {
        return dir.resolve("meta.json");
    }

    private Path matrixPath(Path dir) {
        return dir.resolve("matrix.json.gz");
    }

    private void deleteDir(Path dir) throws IOException {
        try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir)) {
            for (Path path : stream) {
                Files.deleteIfExists(path);
            }
        }
        Files.deleteIfExists(dir);
    }

    @RegisterForReflection(serialization = true)
    private static class ScenarioMeta {
        public UUID id;
        public String name;
        public LocalDateTime createTime;
        public LocalDateTime updateTime;

        public static ScenarioMeta from(Scenario scenario) {
            ScenarioMeta meta = new ScenarioMeta();
            meta.id = scenario.getId();
            meta.name = scenario.getName();
            meta.createTime = scenario.getCreateTime();
            meta.updateTime = scenario.getUpdateTime();
            return meta;
        }
    }
}
