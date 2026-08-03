package one.rewind.xforce.vehicle_routing.service;

import com.google.common.util.concurrent.ThreadFactoryBuilder;
import io.quarkus.runtime.Startup;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.ws.rs.core.Response;
import one.rewind.xforce.json.OM;
import one.rewind.xforce.http.HttpRequester;
import one.rewind.xforce.vehicle_routing.bootstrap.GeoUtil;
import one.rewind.xforce.geo.map.MapAdapterSelector;
import one.rewind.xforce.vehicle_routing.db.dto.SolutionMetrics;
import one.rewind.xforce.vehicle_routing.db.dto.SolverJob;
import one.rewind.xforce.vehicle_routing.db.repository.SolverJobRepository;
import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.exception.POINoWhereException;
import one.rewind.xforce.vehicle_routing.io.DeployUtilBean;
import one.rewind.xforce.vehicle_routing.rest.exception.SolverJobException;
import one.rewind.xforce.vehicle_routing.solver.RouteScheduleInitializer;
import one.rewind.xforce.vehicle_routing.solver.Status;
import org.apache.commons.lang3.StringUtils;
import org.apache.logging.log4j.core.impl.ThrowableProxy;
import org.optaplanner.core.api.score.buildin.hardmediumsoftlong.HardMediumSoftLongScore;
import org.optaplanner.core.api.solver.SolutionManager;
import org.optaplanner.core.api.solver.SolverManager;
import org.optaplanner.core.api.solver.SolverStatus;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.*;

import static one.rewind.xforce.vehicle_routing.domain.RoutePlan.logger;

@Startup(2)
@ApplicationScoped
public class SolverService {

    private static final long PROGRESS_SAMPLE_INTERVAL_MILLIS = SolverSearchProgressTracker.SAMPLE_INTERVAL_MILLIS;

    @Inject
    SolverJobRepository solverJobRepository;

    @Inject
    DeployUtilBean deployUtilBean;

    @Inject
    MapAdapterSelector mapAdapterSelector;

    private final SolverManager<RoutePlan, UUID> solverManager;

    private final SolutionManager<RoutePlan, HardMediumSoftLongScore> solutionManager;

    private final SolverSearchProgressTracker searchProgressTracker;

    // 线程池
    ScheduledExecutorService ses = Executors.newScheduledThreadPool(
            1, new ThreadFactoryBuilder().setNameFormat("SolverJobScheduler-%d").build());

    ConcurrentHashMap<UUID, ScheduledFuture<?>> scheduledFutures = new ConcurrentHashMap<>();
    ConcurrentHashMap<UUID, ScheduledFuture<?>> progressSamplingFutures = new ConcurrentHashMap<>();


    @Inject
    public SolverService(
            SolverManager<RoutePlan, UUID> solverManager,
            SolutionManager<RoutePlan, HardMediumSoftLongScore> solutionManager,
            SolverSearchProgressTracker searchProgressTracker
    ) {
        this.solverManager = solverManager;
        this.solutionManager = solutionManager;
        this.searchProgressTracker = searchProgressTracker;
    }

    public SolverService(SolverManager<RoutePlan, UUID> solverManager, SolutionManager<RoutePlan, HardMediumSoftLongScore> solutionManager) {
        this(solverManager, solutionManager, new SolverSearchProgressTracker());
    }

    /**
     * 根据 id 查询求解任务，并进行初步处理
     * @param id 求解任务ID
     * @return 求解任务
     */
    public SolverJob getSolverJobAndCheckForExceptions(UUID id) {
        SolverJob job = solverJobRepository.findById(id);
        if (id == null) {
            job = solverJobRepository.getCurrent();
        }

        if(job == null) {
            throw new SolverJobException(id, Response.Status.NOT_FOUND, VrpErrorCode.SOLVER_JOB_NOT_FOUND,
                    Map.of(), "No SolverJob found", false);
        }

        // 可能不需要这个判断
        if(job.getException() != null) {
            throw new SolverJobException(id, Response.Status.INTERNAL_SERVER_ERROR, VrpErrorCode.SOLVER_JOB_FAILED,
                    Map.of(), readThrowableProxyMessage(job.getException()), true);
        }

        return job;
    }

    public SolverJob getCurrentSolverJobAndCheckForExceptions() {
        return getSolverJobAndCheckForExceptions(null);
    }

    private static String readThrowableProxyMessage(ThrowableProxy exception) {
        if (exception == null) {
            return "Solver job failed with unknown exception";
        }
        if (exception.getCauseProxy() != null && StringUtils.isNotBlank(exception.getCauseProxy().getMessage())) {
            return exception.getCauseProxy().getMessage();
        }
        if (StringUtils.isNotBlank(exception.getMessage())) {
            return exception.getMessage();
        }
        return "Solver job failed but exception message is empty";
    }

    /**
     * TODO 可能不需要
     * @param job
     * @return
     */
    public SolverJob solve(SolverJob job, boolean drawRoute, String callback) {

        if (job.getPlan() != null) {
            job.getPlan().init();
            RouteScheduleInitializer.initializePreassignedRoutes(job.getPlan());
        }

        if (job.getId() == null) {
            job.setId(UUID.randomUUID());
        }
        if (job.getCreateTime() == null) {
            job.setCreateTime(LocalDateTime.now());
        }
        if (job.getUpdateTime() == null) {
            job.setUpdateTime(LocalDateTime.now());
        }

        final UUID jobId = job.getId();
        logger.info("SolverJob: " + jobId);

        // 先保存任务，再启动求解，避免求解器快速回调 BEST_SOLUTION 时仓库里还找不到 job。
        job.setStatus(Status.SOLVING_SCHEDULED);
        job.setUpdateTime(LocalDateTime.now());
        solverJobRepository.saveCurrent(job);
        scheduleProgressSampling(jobId);
        scheduleEarlyTermination(jobId, job.getSolveTime());

        try {
            solverManager.solveAndListen(
                    job.getId(),
                    id -> {
                        searchProgressTracker.markSearchStarted(jobId, System.currentTimeMillis());
                        return job.getPlan();
                    },
                    // 搜索到更优解
                    newBestSolution -> {
                    logger.info(">>>" + newBestSolution.getScore());
                    long recordedAtMillis = System.currentTimeMillis();
                    SolverJobRepository.BestSolutionUpdate update = solverJobRepository.updateBestSolution(
                            jobId,
                            newBestSolution,
                            recordedAtMillis,
                            searchProgressTracker.elapsedMillis(jobId, recordedAtMillis)
                    );
                    if (update.result() != SolverJobRepository.BestSolutionWriteResult.REJECTED) {
                        searchProgressTracker.recordBestScore(jobId, newBestSolution.getScore());
                    }
                    },
                    // 已搜索的最优解，求解结束时回调
                    finalBestSolution -> {

                    logger.info(">>>>>>" + finalBestSolution.getScore());
                    SolverSearchProgressTracker.SearchEnd searchEnd = finishProgressTracking(jobId, System.currentTimeMillis());
                    HardMediumSoftLongScore score = HardMediumSoftLongScore.parseScore(finalBestSolution.getScore().toString());

                    try {

                        long t1 = System.currentTimeMillis();
                        if(drawRoute) {
                            GeoUtil.populateMatrixWithExistRoute(finalBestSolution, mapAdapterSelector.adapter());
                        }
                        else {
                            GeoUtil.populateMatrixWithChangingTickets(finalBestSolution, mapAdapterSelector.adapter());
                        }

                        logger.info("Populate matrix / routes in " + (System.currentTimeMillis() - t1) + "ms");

                        String summary = solutionManager.explain(finalBestSolution).getSummary();
                        finalBestSolution.setScore(score);

                        var sj = solverJobRepository.finishJob(
                                jobId,
                                finalBestSolution,
                                summary,
                                searchEnd.recordedAtMillis(),
                                searchEnd.elapsedMillis()
                        );

                        // 求解完成回调
                        if(StringUtils.isNoneBlank(callback)) {
                            Map<String, String> headers = new HashMap<>();
                            headers.put("Content-Type", "application/json");
                            removeMatrixFromSolverJob(sj);
                            String text = new HttpRequester().req(callback, "POST", headers, OM.toJson(sj).getBytes(StandardCharsets.UTF_8))
                                    .orElseThrow(() -> new IOException("Callback request failed: " + callback)).getText();
                            logger.info("Gateway response: " + text);
                        }

                    }
                    catch (Throwable e) {
                        try {
                            logger.error("Error update job, id=" + jobId, e);
                            finishProgressTracking(jobId, System.currentTimeMillis());
                            solverJobRepository.updateJob(jobId, e);
                        } finally {
                            logger.info("Error call back: " + callback);
                            // 发生异常仍然触发回调，返回异常信息
                            if (StringUtils.isNoneBlank(callback)) {
                                Map<String, String> headers = new HashMap<>();
                                headers.put("Content-Type", "application/json");
                                String encodedErrorMsg = URLEncoder.encode("Error update job: " + e.getMessage(), StandardCharsets.UTF_8);
                                String callback_url = callback + "?is_error=true&error_msg=" + encodedErrorMsg;
                                try {
                                    removeMatrixFromSolverJob(job);
                                    String text = new HttpRequester().req(callback_url, "POST", headers, OM.toJson(job).getBytes(StandardCharsets.UTF_8))
                                            .orElseThrow(() -> new IOException("Callback request failed: " + callback)).getText();
                                    logger.info("Gateway response: " + text);
                                } catch (IOException ex) {
                                }
                            }
                        }
                    }
                    },
                    // 异常处理
                    (id, e) -> {
                    try {
                        logger.error("FinalBestSolution error", e);
                        finishProgressTracking(jobId, System.currentTimeMillis());
                        solverJobRepository.updateJob(jobId, e);
                    } finally {
                        logger.info("Error call back: " + callback);
                        // 发生异常仍然触发回调，返回异常信息
                        if (StringUtils.isNoneBlank(callback)) {
                            Map<String, String> headers = new HashMap<>();
                            headers.put("Content-Type", "application/json");
                            String encodedErrorMsg = URLEncoder.encode("FinalBestSolution error: " + e.getMessage(), StandardCharsets.UTF_8);
                            String callback_url = callback + "?is_error=true&error_msg=" + encodedErrorMsg;
                            try {
                                removeMatrixFromSolverJob(job);
                                String text = new HttpRequester().req(callback_url, "POST", headers, OM.toJson(job).getBytes(StandardCharsets.UTF_8))
                                        .orElseThrow(() -> new IOException("Callback request failed: " + callback)).getText();
                                logger.info("Gateway response: " + text);
                            } catch (IOException ex) {
                            }
                        }
                    }
                    });
        } catch (RuntimeException e) {
            // solveAndListen 也可能在注册阶段同步失败；此时不会进入错误回调，必须主动释放定时任务和采集上下文。
            finishProgressTracking(jobId, System.currentTimeMillis());
            solverJobRepository.updateJob(jobId, e);
            throw e;
        }

        return job;
    }

    private void scheduleEarlyTermination(UUID jobId, Duration solveTime) {
        // 在注册求解回调之前安排提前终止，保证极短任务的结束回调可以取消该 future，
        // 不会留下一个已经结束任务的延迟终止器。
        if (solveTime == null || solveTime.compareTo(deployUtilBean.maxSolveTime) >= 0) {
            return;
        }
        ScheduledFuture<?> future = ses.schedule(() -> {
            try {
                solverManager.terminateEarly(jobId);
            } finally {
                scheduledFutures.remove(jobId);
            }
        }, solveTime.toSeconds(), TimeUnit.SECONDS);
        scheduledFutures.put(jobId, future);
    }

    private void scheduleProgressSampling(UUID jobId) {
        cancelProgressSampling(jobId);

        ScheduledFuture<?> future = ses.scheduleAtFixedRate(() -> {
            try {
                if (!recordSearchSample(jobId)) {
                    cancelProgressSampling(jobId);
                }
            } catch (Throwable e) {
                logger.warn("Record solver progress failed, jobId=" + jobId, e);
            }
        }, PROGRESS_SAMPLE_INTERVAL_MILLIS, PROGRESS_SAMPLE_INTERVAL_MILLIS, TimeUnit.MILLISECONDS);

        progressSamplingFutures.put(jobId, future);
    }

    private void cancelProgressSampling(UUID jobId) {
        ScheduledFuture<?> future = progressSamplingFutures.remove(jobId);
        if (future != null) {
            future.cancel(false);
        }
    }

    private boolean recordSearchSample(UUID jobId) {
        SolverStatus solverStatus = solverManager.getSolverStatus(jobId);
        if (solverStatus == SolverStatus.SOLVING_SCHEDULED) {
            return true;
        }
        if (solverStatus != SolverStatus.SOLVING_ACTIVE) {
            return false;
        }

        var sample = searchProgressTracker.capture(jobId, System.currentTimeMillis());
        if (sample.isEmpty()) {
            return true;
        }

        SolverJob current = solverJobRepository.findById(jobId);
        if (current == null) {
            return false;
        }
        if (current.getStatus() == Status.SOLVING_SCHEDULED) {
            return true;
        }
        if (current.getStatus() != Status.SOLVING_ACTIVE) {
            return false;
        }
        solverJobRepository.appendSearchSample(jobId, sample.get());
        return true;
    }

    private SolverSearchProgressTracker.SearchEnd finishProgressTracking(UUID jobId, long finishedAtMillis) {
        cancelProgressSampling(jobId);
        ScheduledFuture<?> termination = scheduledFutures.remove(jobId);
        if (termination != null) {
            termination.cancel(false);
        }
        return searchProgressTracker.finish(jobId, finishedAtMillis);
    }

    private void removeMatrixFromSolverJob(SolverJob sj) {
        // 去除 sj 中的 route plan 的 matrix（在回调保存结果时调用本方法）
        // FIXME 临时解决方案。一共导致两个问题：1. 大场景下，触发了 MongoDB 单 Document 最大 16MB 的硬性限制；2. 导致序列化时间过长
        sj.getPlan().setMatrix(null);
    }

    /**
     *
     * @param id
     * @return
     */
    public SolverJob stop(UUID id) {

        SolverStatus solverStatus = solverManager.getSolverStatus(id);
        if(solverStatus == SolverStatus.NOT_SOLVING) throw new SolverJobException(id, Response.Status.BAD_REQUEST,
                VrpErrorCode.SOLVER_NOT_RUNNING, Map.of(), "RoutePlan not solving", true);

        // TODO: Replace with .terminateEarlyAndWait(... [, timeout]); see https://github.com/TimefoldAI/timefold-solver/issues/77
        // TODO: 需要检查返回对象的状态字段
        solverManager.terminateEarly(id);
        return getSolverJobAndCheckForExceptions(id);
    }

    public SolverJob stopCurrent() {
        SolverJob current = getCurrentSolverJobAndCheckForExceptions();
        return stop(current.getId());
    }


    /**
     *
     * @param id
     */
    public void delete(UUID id) {

        SolverStatus solverStatus = solverManager.getSolverStatus(id);
        if(solverStatus == SolverStatus.SOLVING_SCHEDULED || solverStatus == SolverStatus.SOLVING_ACTIVE)
            throw new SolverJobException(id, Response.Status.BAD_REQUEST, VrpErrorCode.SOLVER_JOB_MUST_TERMINATE,
                    Map.of(), "Terminate SolverJob first", true);

        solverJobRepository.deleteAndRelatedItems(id);
    }

    public void deleteCurrent() {
        SolverJob current = getCurrentSolverJobAndCheckForExceptions();
        delete(current.getId());
    }

    public boolean hasRunningJob() {
        SolverJob current = solverJobRepository.getCurrent();
        if (current == null) {
            return false;
        }
        if (current.getStatus() == Status.SOLVING_SCHEDULED || current.getStatus() == Status.SOLVING_ACTIVE) {
            return true;
        }
        UUID currentId = current.getId();
        if (currentId == null) {
            return false;
        }
        SolverStatus solverStatus = solverManager.getSolverStatus(currentId);
        return solverStatus == SolverStatus.SOLVING_SCHEDULED || solverStatus == SolverStatus.SOLVING_ACTIVE;
    }
}
