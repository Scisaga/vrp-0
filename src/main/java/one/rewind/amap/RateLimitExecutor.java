package one.rewind.amap;

import com.google.common.util.concurrent.*;
import io.github.bucket4j.Bucket;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Metrics;
import io.micrometer.core.instrument.binder.BaseUnits;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import java.time.Duration;
import java.util.concurrent.*;

/**
 * author: scisaga@qq.com
 * @param <T>
 */
public class RateLimitExecutor<T> {

    public static final Logger logger = LogManager.getLogger(RateLimitExecutor.class.getName());

    private String name = "Default";

    private int qps = 100;

    private Duration waitTimeout = Duration.ofSeconds(10);

    private long quota = 10000;

    private Duration interval = Duration.ofDays(1);

    private long lastExecTimestamp = 0L;

    private Bucket intervalBucket;

    private ThreadPoolExecutor executor;

    private ListeningExecutorService service;

    /*private ScheduledExecutorService scheduledExecutor;*/

    MeterRegistry registry = Metrics.globalRegistry;

    public RateLimitExecutor() {}

    /**
     * RateLimitExecutor 构造函数
     * @param name 名称标识
     * @param qps 每秒请求数
     * @param quota 计时周期内配额
     * @param interval 计时周期
     * @param waitTimeout 请求最大等待时间，当并发请求量超qps时，会进行排队，超过最大等待时间会抛出异常
     */
    public RateLimitExecutor(String name, int qps, long quota, Duration interval, Duration waitTimeout) {

        this.name = name;
        this.qps = qps;
        this.quota = quota;
        this.interval = interval;
        this.waitTimeout = waitTimeout;

        // Bucket定义
        this.intervalBucket = Bucket.builder()
                .addLimit(limit -> limit.capacity(quota).refillIntervally(quota, interval).initialTokens(quota))
                .build();

        // 执行器
        executor = new ThreadPoolExecutor(
                this.qps,
                this.qps * 2,
                0,
                TimeUnit.MICROSECONDS,
                new SynchronousQueue<>(),
                new ThreadFactoryBuilder()
                        .setNameFormat("RateLimitExecutor("+name+")-%d")
                        .build(),
                new ThreadPoolExecutor.CallerRunsPolicy()
        );

        // 可监听执行器封装
        service = MoreExecutors.listeningDecorator(executor);

        //
        /*scheduledExecutor = Executors.newScheduledThreadPool(2,
                new ThreadFactoryBuilder()
                        .setNameFormat("RateLimitExecutor("+name+")-s-%d")
                        .build()
        );*/

        Gauge.builder("rateLimit." + this.name + ".quota", () -> this.quota)
                .baseUnit(BaseUnits.OPERATIONS)
                .register(registry);

        Gauge.builder("rateLimit." + this.name + ".quota.available", this::getQuotaAvailable)
                .baseUnit(BaseUnits.OPERATIONS)
                .register(registry);
    }

    /**
     * 计算线程睡眠时间
     * @return
     */
    private synchronized long getSleepTime() {

        long current = System.currentTimeMillis();

        double gap = 1000D / qps;
        long sleepTime = 0;

        if(current - lastExecTimestamp < gap) {
            sleepTime = lastExecTimestamp + Math.round(gap) - current;
        }

        lastExecTimestamp = current + sleepTime;

        return sleepTime;
    }

    /**
     * 任务执行封装
     * @param task 提交任务
     * @return 原任务提交结果
     */
    public T exec(Callable<T> task) throws QuotaExhaustedException, InterruptedException, ExecutionException, TimeoutException {

        //
        Thread.sleep(getSleepTime());

        if(intervalBucket.tryConsume(1)) {

            ListenableFuture<T> f1 = service.submit(task);

            try {
                return f1.get(waitTimeout.toSeconds(), TimeUnit.SECONDS);
            }
            catch (ExecutionException | TimeoutException e) {
                f1.cancel(true);
                throw e;
            }
        }
        else {
            throw new QuotaExhaustedException(this.name, this.quota);
        }
    }

    /**
     * @return 获取当前统计周期的剩余配额
     */
    public long getQuotaAvailable() {
        return this.intervalBucket.getAvailableTokens();
    }

    /**
     * 超配额异常
     */
    public static class QuotaExhaustedException extends Exception {

        public QuotaExhaustedException() {}

        public QuotaExhaustedException(String key, long quota) {
            super(key + " quota[" + quota + "] exhausted.");
        }
    }
}
