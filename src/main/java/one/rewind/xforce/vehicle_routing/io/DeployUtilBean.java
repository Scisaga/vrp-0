package one.rewind.xforce.vehicle_routing.io;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import com.sun.management.OperatingSystemMXBean;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Metrics;
import io.micrometer.core.instrument.binder.BaseUnits;
import io.quarkus.runtime.Startup;
import io.quarkus.runtime.annotations.RegisterForReflection;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import one.rewind.xforce.json.OM;
import one.rewind.xforce.vehicle_routing.db.repository.SolverJobRepository;
import one.rewind.xforce.vehicle_routing.db.repository.ScenarioRepository;
import one.rewind.xforce.vehicle_routing.solver.Status;
import org.optaplanner.core.config.solver.SolverConfig;

import java.io.File;
import java.io.IOException;
import java.lang.management.ManagementFactory;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@RegisterForReflection(serialization = true)
@ApplicationScoped
public class DeployUtilBean {

    public static String infoPath = "deploy_info.json";

    public static SolverConfig sc = SolverConfig.createFromXmlResource(
            "solverConfig.xml");

    @Inject
    SolverJobRepository solverJobRepository;
    @Inject
    ScenarioRepository scenarioRepository;

    @JsonFormat(pattern="yyyy-MM-dd HH:mm:ss")
    public LocalDateTime deployTime = LocalDateTime.now();

    @JsonFormat(pattern="yyyy-MM-dd HH:mm:ss")
    public LocalDateTime startTime = LocalDateTime.now();

    public Duration maxSolveTime = sc.getTerminationConfig().getSpentLimit();

    public String moveThreadCount = sc.getMoveThreadCount();

    MeterRegistry registry = Metrics.globalRegistry;

    public DeployUtilBean() {}

    /**
     *
     * @throws JsonProcessingException
     */
    @Startup(1)
    void init() throws JsonProcessingException {

        File f = new File(infoPath);

        try {
            if (f.exists()) {
                String json = Files.readString(Path.of(infoPath), StandardCharsets.UTF_8);
                var b = OM.fromJson(json, DeployUtilBean.class);
                deployTime = b.deployTime;
            }

            Path target = Path.of(infoPath);
            Path parent = target.getParent();
            if (parent != null) {
                Files.createDirectories(parent);
            }
            Files.write(target, OM.toJson(this).getBytes(StandardCharsets.UTF_8));
        } catch (IOException e) {
            throw new RuntimeException("Error read/write deploy info", e);
        }

        // 节点重启后 一致化RoutePlan状态
        solverJobRepository.resetStatus(
                Status.NOT_SOLVING,
                new ArrayList<>() {{
                    add(Status.SOLVING_SCHEDULED);
                    add(Status.SOLVING_ACTIVE);
                }}
        );
    }

    /**
     *
     */
    @Startup(2)
    void setUpMeterRegistry() {

        Gauge.builder("node.mem.total", () -> (double) ((OperatingSystemMXBean) ManagementFactory.getOperatingSystemMXBean()).getTotalMemorySize())
                .baseUnit(BaseUnits.BYTES)
                .description("节点内存")
                .register(registry);

        Gauge.builder("node.mem.free", () -> (double) ((OperatingSystemMXBean) ManagementFactory.getOperatingSystemMXBean()).getFreeMemorySize())
                .baseUnit(BaseUnits.BYTES)
                .description("节点空闲内存")
                .register(registry);

        Gauge.builder("node.disk.total", () -> new File("/").getTotalSpace())
                .baseUnit(BaseUnits.BYTES)
                .description("磁盘容量")
                .register(registry);

        Gauge.builder("node.disk.free", () -> new File("/").getFreeSpace())
                .baseUnit(BaseUnits.BYTES)
                .description("磁盘空闲容量")
                .register(registry);

        Gauge.builder("node.deploy", () -> this.deployTime.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli())
                .baseUnit(BaseUnits.MILLISECONDS)
                .description("节点部署时间")
                .register(registry);

        Gauge.builder("node.start.duration", () -> System.currentTimeMillis() - this.startTime.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli())
                .baseUnit(BaseUnits.MILLISECONDS)
                .description("节点运行时长")
                .register(registry);

        Gauge.builder("node.solver.move", () -> {
                    if(this.moveThreadCount.equals("AUTO")) return -1;
                    return Integer.parseInt(this.moveThreadCount);
                })
                .baseUnit(BaseUnits.THREADS)
                .description("求解器线程数")
                .register(registry);

        Gauge.builder("node.solver.maxSolveTime", () -> this.maxSolveTime.toMillis())
                .baseUnit(BaseUnits.MILLISECONDS)
                .description("最大求解时间")
                .register(registry);

        Gauge.builder("node.solver.parallelSolve", () -> 1)
                .baseUnit(BaseUnits.OPERATIONS)
                .description("并发求解数")
                .register(registry);

        Gauge.builder("node.solver.queueLength", () -> solverJobRepository.countByStatus(Status.SOLVING_SCHEDULED))
                .baseUnit(BaseUnits.OPERATIONS)
                .description("求解队列任务数")
                .register(registry);

        Gauge.builder("node.scenario", () -> scenarioRepository.count())
                .baseUnit(BaseUnits.ROWS)
                .description("场景数")
                .register(registry);

        Gauge.builder("node.solverJob", () -> solverJobRepository.count())
                .baseUnit(BaseUnits.ROWS)
                .description("求解任务数")
                .register(registry);
    }
}
