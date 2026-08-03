package one.rewind.xforce.vehicle_routing.db.repository;

import io.quarkus.runtime.annotations.RegisterForReflection;
import jakarta.annotation.PostConstruct;
import jakarta.enterprise.context.ApplicationScoped;
import one.rewind.xforce.geo.transit.TransitMatrix;
import one.rewind.xforce.vehicle_routing.db.dto.SolutionMetrics;
import one.rewind.xforce.vehicle_routing.db.dto.SolverJob;
import one.rewind.xforce.vehicle_routing.db.dto.SolverJobListFilter;
import one.rewind.xforce.vehicle_routing.db.dto.SolverJobSummary;
import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.solver.Status;
import one.rewind.xforce.vehicle_routing.store.FileStoreUtil;
import one.rewind.xforce.vehicle_routing.store.StoragePathResolver;
import org.apache.commons.lang3.StringUtils;
import org.apache.logging.log4j.core.impl.ThrowableProxy;
import org.optaplanner.core.api.score.buildin.hardmediumsoftlong.HardMediumSoftLongScore;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.io.IOException;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.locks.ReentrantReadWriteLock;

import static one.rewind.xforce.vehicle_routing.domain.RoutePlan.logger;

@ApplicationScoped
public class SolverJobRepository {

    @ConfigProperty(name = "vrp.solverjob.store.dir", defaultValue = "./data/solver_jobs/")
    String baseDir;

    private Path basePath;

    private final ReentrantReadWriteLock lock = new ReentrantReadWriteLock();

    private volatile boolean legacySummaryScoresChecked;

    @PostConstruct
    void init() {
        basePath = StoragePathResolver.resolve(baseDir);
    }

    public SolverJob getCurrent() {
        lock.readLock().lock();
        try {
            SolverJobIndex index = loadIndex();
            if (index.latestJobId == null) {
                return null;
            }
            return readJob(jobDir(index.latestJobId));
        } catch (IOException e) {
            throw new RuntimeException("Load current solver job failed", e);
        } finally {
            lock.readLock().unlock();
        }
    }

    public SolverJob saveCurrent(SolverJob job) {
        lock.writeLock().lock();
        try {
            return saveJob(job, true);
        } catch (IOException e) {
            throw new RuntimeException("Save current solver job failed", e);
        } finally {
            lock.writeLock().unlock();
        }
    }

    public SolverJob save(SolverJob job) {
        return saveCurrent(job);
    }

    public SolverJob save(SolverJob job, Status status) {
        job.setStatus(status);
        job.setUpdateTime(LocalDateTime.now());
        return saveCurrent(job);
    }

    public SolverJob findById(UUID id) {
        if (id == null) {
            return getCurrent();
        }
        lock.readLock().lock();
        try {
            return readJob(jobDir(id));
        } catch (IOException e) {
            throw new RuntimeException("Load solver job failed: " + id, e);
        } finally {
            lock.readLock().unlock();
        }
    }

    public List<SolverJobSummary> listAll() {
        return listAll(SolverJobListFilter.all());
    }

    public List<SolverJobSummary> listAll(SolverJobListFilter filter) {
        backfillLegacySummaryScores();
        lock.readLock().lock();
        try {
            SolverJobListFilter effectiveFilter = filter == null ? SolverJobListFilter.all() : filter;
            return new ArrayList<>(loadIndex().sortedItems().stream()
                    .filter(item -> matchesFilter(item, effectiveFilter))
                    .toList());
        } catch (IOException e) {
            throw new RuntimeException("List solver jobs failed", e);
        } finally {
            lock.readLock().unlock();
        }
    }

    private void backfillLegacySummaryScores() {
        if (legacySummaryScoresChecked) {
            return;
        }

        lock.writeLock().lock();
        try {
            if (legacySummaryScoresChecked) {
                return;
            }

            SolverJobIndex index = loadIndex();
            boolean changed = false;
            for (SolverJobSummary item : new ArrayList<>(index.items)) {
                if (item == null || item.getId() == null || item.getScore() != null) {
                    continue;
                }
                SolverJob job = FileStoreUtil.readJson(jobPath(jobDir(item.getId())), SolverJob.class);
                if (job == null || job.getScore() == null) {
                    continue;
                }
                item.setScore(job.getScore().toString());
                changed = true;
            }
            if (changed) {
                persistIndex(index);
            }
            legacySummaryScoresChecked = true;
        } catch (IOException e) {
            logger.warn("Backfill legacy solver job summary scores failed", e);
        } finally {
            lock.writeLock().unlock();
        }
    }

    private boolean matchesFilter(SolverJobSummary item, SolverJobListFilter filter) {
        if (filter.status() != null && filter.status() != item.getStatus()) {
            return false;
        }
        if (filter.createTimeFrom() != null && (item.getCreateTime() == null || item.getCreateTime().isBefore(filter.createTimeFrom()))) {
            return false;
        }
        if (filter.createTimeTo() != null && (item.getCreateTime() == null || item.getCreateTime().isAfter(filter.createTimeTo()))) {
            return false;
        }
        if (filter.buildTransitMatrix() != null && !filter.buildTransitMatrix().equals(item.getBuildTransitMatrix())) {
            return false;
        }
        if (filter.matrixMode() != null && !filter.matrixMode().equalsIgnoreCase(StringUtils.defaultString(item.getMatrixMode()))) {
            return false;
        }
        return filter.drawRoute() == null || filter.drawRoute().equals(item.getDrawRoute());
    }

    public void updateJob(UUID jobId, RoutePlan plan, Status status) {
        updateJob(jobId, plan, status, null);
    }

    public SolverJob updateJob(UUID jobId, RoutePlan plan, Status status, String scoreExplanation) {
        return updateJob(jobId, plan, status, scoreExplanation, inferRecordType(status));
    }

    public SolverJob updateJob(UUID jobId, RoutePlan plan, Status status, String scoreExplanation, SolutionMetrics.RecordType recordType) {
        lock.writeLock().lock();
        try {
            SolverJob job = requireJob(jobId);
            logger.info("SolverJob: " + job);
            updateJobFields(job, plan, status, scoreExplanation);
            SolutionMetrics metrics = job.getSolutionMetrics(recordType);
            if (metrics != null) {
                appendSolutionMetrics(job, metrics);
            }
            return saveJob(job, true);
        } catch (IOException e) {
            throw new RuntimeException("Update solver job failed: " + jobId, e);
        } finally {
            lock.writeLock().unlock();
        }
    }

    /**
     * 原子地更新当前最优方案。重复得分不产生新的曲线事件，倒退得分不覆盖已知最优方案。
     */
    public BestSolutionUpdate updateBestSolution(
            UUID jobId,
            RoutePlan plan,
            long recordedAtMillis,
            long elapsedMillis
    ) {
        lock.writeLock().lock();
        try {
            SolverJob job = requireJob(jobId);
            HardMediumSoftLongScore candidateScore = plan == null ? null : plan.getScore();
            HardMediumSoftLongScore previousBestScore = latestBestScore(job);
            if (candidateScore != null && previousBestScore != null) {
                int comparison = candidateScore.compareTo(previousBestScore);
                if (comparison < 0) {
                    logger.warn("Ignore regressed best solution, jobId=" + jobId
                            + ", candidate=" + candidateScore + ", recordedBest=" + previousBestScore);
                    return new BestSolutionUpdate(job, BestSolutionWriteResult.REJECTED);
                }
                updateJobFields(job, plan, Status.SOLVING_ACTIVE, null);
                if (comparison == 0) {
                    return new BestSolutionUpdate(saveJob(job, true), BestSolutionWriteResult.DUPLICATE);
                }
            } else {
                updateJobFields(job, plan, Status.SOLVING_ACTIVE, null);
            }

            SolutionMetrics metrics = job.getSolutionMetrics(SolutionMetrics.RecordType.BEST_SOLUTION);
            if (metrics != null) {
                stampMetric(metrics, recordedAtMillis, elapsedMillis);
                appendSolutionMetrics(job, metrics);
            }
            return new BestSolutionUpdate(saveJob(job, true), BestSolutionWriteResult.APPENDED);
        } catch (IOException e) {
            throw new RuntimeException("Update best solver solution failed: " + jobId, e);
        } finally {
            lock.writeLock().unlock();
        }
    }

    /**
     * 搜索快照不携带 RoutePlan，只追加进度记录，避免采样线程覆盖 Best 回调写入的方案。
     */
    public boolean appendSearchSample(UUID jobId, SolutionMetrics sample) {
        if (sample == null || sample.getRecordType() != SolutionMetrics.RecordType.SEARCH_SAMPLE) {
            return false;
        }
        lock.writeLock().lock();
        try {
            SolverJob job = readJob(jobDir(jobId));
            if (job == null || job.getStatus() != Status.SOLVING_ACTIVE) {
                return false;
            }
            appendSolutionMetrics(job, sample);
            job.setUpdateTime(LocalDateTime.now());
            saveJob(job, true);
            return true;
        } catch (IOException e) {
            throw new RuntimeException("Append solver search sample failed: " + jobId, e);
        } finally {
            lock.writeLock().unlock();
        }
    }

    public SolverJob finishJob(
            UUID jobId,
            RoutePlan plan,
            String scoreExplanation,
            long recordedAtMillis,
            long elapsedMillis
    ) {
        lock.writeLock().lock();
        try {
            SolverJob job = requireJob(jobId);
            updateJobFields(job, plan, Status.SOLVING_FINISHED, scoreExplanation);
            SolutionMetrics metrics = job.getSolutionMetrics(SolutionMetrics.RecordType.FINAL_SOLUTION);
            if (metrics != null) {
                stampMetric(metrics, recordedAtMillis, elapsedMillis);
                appendSolutionMetrics(job, metrics);
            }
            return saveJob(job, true);
        } catch (IOException e) {
            throw new RuntimeException("Finish solver job failed: " + jobId, e);
        } finally {
            lock.writeLock().unlock();
        }
    }

    public void updateJob(UUID jobId, Throwable e) {
        lock.writeLock().lock();
        try {
            SolverJob job = readJob(jobDir(jobId));
            if (job == null) {
                return;
            }
            logger.error("Error, ", e);
            job.setException(new ThrowableProxy(e));
            job.setStatus(Status.ERROR);
            job.setUpdateTime(LocalDateTime.now());
            saveJob(job, true);
        } catch (IOException ioException) {
            throw new RuntimeException("Update failed solver job failed: " + jobId, ioException);
        } finally {
            lock.writeLock().unlock();
        }
    }

    public boolean exists() {
        return count() > 0;
    }

    public boolean hasRunningJob() {
        lock.readLock().lock();
        try {
            return loadIndex().items.stream().anyMatch(item ->
                    item.getStatus() == Status.SOLVING_SCHEDULED || item.getStatus() == Status.SOLVING_ACTIVE
            );
        } catch (IOException e) {
            throw new RuntimeException("Check running solver job failed", e);
        } finally {
            lock.readLock().unlock();
        }
    }

    public long countByStatus(Status status) {
        lock.readLock().lock();
        try {
            return loadIndex().items.stream()
                    .filter(item -> item.getStatus() == status)
                    .count();
        } catch (IOException e) {
            throw new RuntimeException("Count solver jobs by status failed", e);
        } finally {
            lock.readLock().unlock();
        }
    }

    public void resetStatus(Status targetStatus, List<Status> fromStatuses) {
        lock.writeLock().lock();
        try {
            SolverJobIndex index = loadIndex();
            boolean changed = false;
            List<SolverJobSummary> snapshot = new ArrayList<>(index.items);
            for (SolverJobSummary item : snapshot) {
                if (item.getStatus() == null || !fromStatuses.contains(item.getStatus())) {
                    continue;
                }
                SolverJob job = readJob(jobDir(item.getId()));
                if (job == null) {
                    continue;
                }
                job.setStatus(targetStatus);
                job.setUpdateTime(LocalDateTime.now());
                persistJobFiles(jobDir(job.getId()), job);
                upsertSummary(index, SolverJobSummary.from(job));
                changed = true;
            }
            if (changed) {
                persistIndex(index);
            }
        } catch (IOException e) {
            throw new RuntimeException("Reset solver job status failed", e);
        } finally {
            lock.writeLock().unlock();
        }
    }

    public void deleteCurrent() {
        lock.writeLock().lock();
        try {
            SolverJobIndex index = loadIndex();
            if (index.latestJobId == null) {
                return;
            }
            deleteByIdWithoutLock(index.latestJobId);
        } catch (IOException e) {
            throw new RuntimeException("Delete current solver job failed", e);
        } finally {
            lock.writeLock().unlock();
        }
    }

    public void deleteById(UUID id) {
        lock.writeLock().lock();
        try {
            deleteByIdWithoutLock(id);
        } catch (IOException e) {
            throw new RuntimeException("Delete solver job failed: " + id, e);
        } finally {
            lock.writeLock().unlock();
        }
    }

    public void deleteAndRelatedItems(UUID id) {
        deleteById(id);
    }

    public long count() {
        lock.readLock().lock();
        try {
            return loadIndex().items.size();
        } catch (IOException e) {
            throw new RuntimeException("Count solver jobs failed", e);
        } finally {
            lock.readLock().unlock();
        }
    }

    public void clearAll() {
        deleteAll();
    }

    public void deleteAll() {
        lock.writeLock().lock();
        try {
            deleteChildren(basePath);
            Files.deleteIfExists(indexPath());
            legacySummaryScoresChecked = false;
        } catch (IOException e) {
            throw new RuntimeException("Delete all solver jobs failed", e);
        } finally {
            lock.writeLock().unlock();
        }
    }

    private SolverJob saveJob(SolverJob job, boolean markLatest) throws IOException {
        SolverJob existing = job.getId() == null ? null : readJob(jobDir(job.getId()));

        if (job.getId() == null) {
            job.setId(UUID.randomUUID());
        }
        if (job.getCreateTime() == null) {
            job.setCreateTime(existing != null && existing.getCreateTime() != null
                    ? existing.getCreateTime()
                    : LocalDateTime.now());
        }
        if (job.getUpdateTime() == null) {
            job.setUpdateTime(LocalDateTime.now());
        }

        Path dir = jobDir(job.getId());
        persistJobFiles(dir, job);

        SolverJobIndex index = loadIndex();
        upsertSummary(index, SolverJobSummary.from(job));
        if (markLatest) {
            index.latestJobId = job.getId();
        }
        persistIndex(index);
        return job;
    }

    private void persistJobFiles(Path dir, SolverJob job) throws IOException {
        FileStoreUtil.ensureDir(dir);

        RoutePlan plan = job.getPlan();
        TransitMatrix matrix = extractMatrix(plan);
        if (matrix != null && plan != null) {
            plan.setMatrix(null);
        }

        FileStoreUtil.writeJsonAtomic(jobPath(dir), job);
        FileStoreUtil.writeJsonAtomic(metaPath(dir), SolverJobMeta.from(job));

        if (matrix != null) {
            FileStoreUtil.writeGzipJsonAtomic(matrixPath(dir), matrix);
        } else {
            FileStoreUtil.deleteIfExists(matrixPath(dir));
        }

        if (matrix != null && plan != null) {
            plan.setMatrix(matrix);
        }
    }

    private SolverJob readJob(Path dir) throws IOException {
        if (!Files.exists(jobPath(dir))) {
            return null;
        }
        SolverJob job = FileStoreUtil.readJson(jobPath(dir), SolverJob.class);
        if (job == null) {
            return null;
        }

        SolverJobMeta meta = FileStoreUtil.readJson(metaPath(dir), SolverJobMeta.class);
        mergeMetaIntoJob(job, dir, meta);

        TransitMatrix matrix = FileStoreUtil.readGzipJson(matrixPath(dir), TransitMatrix.class);
        RoutePlan plan = job.getPlan();
        if (plan != null) {
            if (matrix != null) {
                plan.setMatrix(matrix);
            }
            plan.init();
        }
        return job;
    }

    private void mergeMetaIntoJob(SolverJob job, Path dir, SolverJobMeta meta) {
        if (job == null) {
            return;
        }

        if (job.getId() == null) {
            if (meta != null && meta.id != null) {
                job.setId(meta.id);
            } else {
                job.setId(parseJobId(dir));
            }
        }

        if (job.getStatus() == null && meta != null && meta.status != null) {
            job.setStatus(meta.status);
        }
        if (job.getCreateTime() == null && meta != null && meta.createTime != null) {
            job.setCreateTime(meta.createTime);
        }
        if (job.getUpdateTime() == null && meta != null && meta.updateTime != null) {
            job.setUpdateTime(meta.updateTime);
        }
    }

    private UUID parseJobId(Path dir) {
        if (dir == null || dir.getFileName() == null) {
            return null;
        }
        try {
            return UUID.fromString(dir.getFileName().toString());
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private void deleteByIdWithoutLock(UUID id) throws IOException {
        if (id == null) {
            return;
        }
        SolverJobIndex index = loadIndex();
        if (index.items.stream().noneMatch(item -> Objects.equals(item.getId(), id))) {
            return;
        }

        deleteDir(jobDir(id));
        index.items.removeIf(item -> Objects.equals(item.getId(), id));
        if (Objects.equals(index.latestJobId, id)) {
            index.latestJobId = index.sortedItems().stream()
                    .findFirst()
                    .map(SolverJobSummary::getId)
                    .orElse(null);
        }
        persistIndex(index);
    }

    private void upsertSummary(SolverJobIndex index, SolverJobSummary summary) {
        if (summary == null || summary.getId() == null) {
            return;
        }
        index.items.removeIf(item -> Objects.equals(item.getId(), summary.getId()));
        index.items.add(summary);
        index.items = new ArrayList<>(index.sortedItems());
    }

    private void persistIndex(SolverJobIndex index) throws IOException {
        if (index.items.isEmpty() && index.latestJobId == null) {
            FileStoreUtil.deleteIfExists(indexPath());
            return;
        }
        FileStoreUtil.writeJsonAtomic(indexPath(), index.normalized());
    }

    private SolverJobIndex loadIndex() throws IOException {
        SolverJobIndex index = FileStoreUtil.readJson(indexPath(), SolverJobIndex.class);
        return index == null ? new SolverJobIndex() : index.normalized();
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

    private SolutionMetrics.RecordType inferRecordType(Status status) {
        if (status == Status.SOLVING_FINISHED) {
            return SolutionMetrics.RecordType.FINAL_SOLUTION;
        }
        if (status == Status.SOLVING_ACTIVE) {
            return SolutionMetrics.RecordType.BEST_SOLUTION;
        }
        return null;
    }

    private void appendSolutionMetrics(SolverJob job, SolutionMetrics nextMetrics) {
        List<SolutionMetrics> metricsList = job.getSolutionMetricsList();
        if (nextMetrics == null) {
            return;
        }

        if (metricsList == null) {
            metricsList = new ArrayList<>();
            job.setSolutionMetricsList(metricsList);
        }

        metricsList.add(nextMetrics);
    }

    private SolverJob requireJob(UUID jobId) throws IOException {
        SolverJob job = readJob(jobDir(jobId));
        if (job == null) {
            throw new IllegalStateException("SolverJob not found: " + jobId);
        }
        return job;
    }

    private void updateJobFields(SolverJob job, RoutePlan plan, Status status, String scoreExplanation) {
        job.setPlan(plan);
        if (StringUtils.isNotBlank(scoreExplanation)) {
            job.setScoreExplanation(scoreExplanation);
        }
        job.setStatus(status);
        job.setUpdateTime(LocalDateTime.now());
    }

    private HardMediumSoftLongScore latestBestScore(SolverJob job) {
        if (job == null || job.getSolutionMetricsList() == null) {
            return null;
        }
        for (int index = job.getSolutionMetricsList().size() - 1; index >= 0; index--) {
            SolutionMetrics metric = job.getSolutionMetricsList().get(index);
            if (metric == null || metric.getRecordType() != SolutionMetrics.RecordType.BEST_SOLUTION
                    || metric.getMetrics() == null || metric.getMetrics().score() == null) {
                continue;
            }
            return metric.getMetrics().score();
        }
        return null;
    }

    private void stampMetric(SolutionMetrics metric, long recordedAtMillis, long elapsedMillis) {
        metric.setRecordedAtMillis(recordedAtMillis);
        metric.setElapsedMillis(elapsedMillis);
        metric.setCreateTime(LocalDateTime.ofInstant(Instant.ofEpochMilli(recordedAtMillis), ZoneId.systemDefault()));
    }

    public enum BestSolutionWriteResult {
        APPENDED,
        DUPLICATE,
        REJECTED
    }

    public record BestSolutionUpdate(SolverJob job, BestSolutionWriteResult result) {
    }

    private Path indexPath() {
        return basePath.resolve("index.json");
    }

    private Path jobsDir() {
        return basePath.resolve("jobs");
    }

    private Path jobDir(UUID id) {
        return jobsDir().resolve(String.valueOf(id));
    }

    private Path jobPath(Path dir) {
        return dir.resolve("job.json");
    }

    private Path metaPath(Path dir) {
        return dir.resolve("meta.json");
    }

    private Path matrixPath(Path dir) {
        return dir.resolve("matrix.json.gz");
    }

    private void deleteChildren(Path dir) throws IOException {
        if (!Files.exists(dir)) {
            return;
        }
        try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir)) {
            for (Path path : stream) {
                if (Files.isDirectory(path)) {
                    deleteDir(path);
                } else {
                    Files.deleteIfExists(path);
                }
            }
        }
    }

    private void deleteDir(Path dir) throws IOException {
        if (!Files.exists(dir)) {
            return;
        }
        try (DirectoryStream<Path> stream = Files.newDirectoryStream(dir)) {
            for (Path path : stream) {
                if (Files.isDirectory(path)) {
                    deleteDir(path);
                } else {
                    Files.deleteIfExists(path);
                }
            }
        }
        Files.deleteIfExists(dir);
    }

    @RegisterForReflection(serialization = true)
    private static class SolverJobMeta {
        public UUID id;
        public Status status;
        public String name;
        public String scenarioName;
        public String constraintConfigurationName;
        public LocalDateTime createTime;
        public LocalDateTime updateTime;

        public static SolverJobMeta from(SolverJob job) {
            SolverJobMeta meta = new SolverJobMeta();
            meta.id = job.getId();
            meta.status = job.getStatus();
            meta.name = job.getName();
            meta.scenarioName = job.getScenarioName();
            if (job.getPlan() != null && job.getPlan().getConstraintConfiguration() != null) {
                meta.constraintConfigurationName = job.getPlan().getConstraintConfiguration().getName();
            }
            meta.createTime = job.getCreateTime();
            meta.updateTime = job.getUpdateTime();
            return meta;
        }
    }

    @RegisterForReflection(serialization = true)
    private static class SolverJobIndex {
        public UUID latestJobId;
        public List<SolverJobSummary> items = new ArrayList<>();

        public SolverJobIndex normalized() {
            if (items == null) {
                items = new ArrayList<>();
            }
            items = new ArrayList<>(sortedItems());
            if (latestJobId != null && items.stream().noneMatch(item -> Objects.equals(item.getId(), latestJobId))) {
                latestJobId = null;
            }
            if (latestJobId == null && !items.isEmpty()) {
                latestJobId = items.get(0).getId();
            }
            return this;
        }

        public List<SolverJobSummary> sortedItems() {
            return items.stream()
                    .filter(Objects::nonNull)
                    .sorted(Comparator
                            .comparing(SolverJobSummary::getCreateTime, Comparator.nullsLast(Comparator.reverseOrder()))
                            .thenComparing(SolverJobSummary::getUpdateTime, Comparator.nullsLast(Comparator.reverseOrder())))
                    .collect(java.util.stream.Collectors.toCollection(ArrayList::new));
        }
    }
}
