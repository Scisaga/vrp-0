package one.rewind.xforce.vehicle_routing.bootstrap;

import one.rewind.amap.AmapAdapter;
import one.rewind.amap.RateLimitExecutor;
import one.rewind.here.HereAdapter;
import one.rewind.xforce.geo.POI;
import one.rewind.xforce.geo.Route;
import one.rewind.xforce.geo.map.MapAdapter;
import one.rewind.xforce.geo.map.MapProvider;
import one.rewind.xforce.geo.transit.AmapTransitCalculator;
import one.rewind.xforce.geo.transit.TransitMatrix;
import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.domain.agent.Agent;
import one.rewind.xforce.vehicle_routing.domain.agent.AgentEachDay;
import one.rewind.xforce.vehicle_routing.domain.agent.Depo;
import one.rewind.xforce.vehicle_routing.domain.ticket.Ticket;
import one.rewind.xforce.vehicle_routing.exception.POINoWhereException;
import org.apache.commons.collections4.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import java.io.IOException;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.stream.Stream;


public class GeoUtil {

    public final static Logger logger = LogManager.getLogger(GeoUtil.class.getName());

    public enum MatrixMode {
        ROUTING,
        MANHATTAN,
        /** @deprecated accepted only to preserve existing callers; normalized to ROUTING. */
        @Deprecated AMAP;

        public static MatrixMode normalize(MatrixMode mode) {
            return mode == AMAP ? ROUTING : mode;
        }
    }

    private static ExecutorService buildMatrixExecutor = Executors.newFixedThreadPool(3);

    /**
     *
     * @param poi
     * @param poiCache
     * @return
     * @throws IOException
     * @throws RateLimitExecutor.QuotaExhaustedException
     * @throws ExecutionException
     * @throws InterruptedException
     * @throws TimeoutException
     */
    private static POI queryPOIWithCache(POI poi, Map<String, POI> poiCache, String alternativeType, MapAdapter adapter) throws IOException, RateLimitExecutor.QuotaExhaustedException, ExecutionException, InterruptedException, TimeoutException, POINoWhereException {

        // POI信息已经补全，直接返回
        if(!poi.isRaw()) return poi;

        // 已缓存，直接返回
        if(poiCache.containsKey(poi.address)) {
            return poiCache.get(poi.address);
        }
        // 未缓存，使用高德接口查询
        else {
            POI poi_new = adapter.query(poi.cityname, poi.address);
            if(poi_new == POI.NoWhere) {
                poi_new = adapter.query(poi.cityname, alternativeType, poi.address);
            }

            logger.info("{} --> {}", poi.address, poi_new);
            if(poi_new == POI.NoWhere) throw new POINoWhereException();

            poiCache.put(poi.address, poi_new);
            return poi_new;
        }
    }

    /**
     *
     * @param rp
     * @throws POINoWhereException
     * @throws IOException
     * @throws RateLimitExecutor.QuotaExhaustedException
     * @throws ExecutionException
     * @throws InterruptedException
     * @throws TimeoutException
     */
    public static void buildPOI(RoutePlan rp) throws POINoWhereException, IOException, RateLimitExecutor.QuotaExhaustedException, ExecutionException, InterruptedException, TimeoutException {
        buildPOI(rp, "");
    }

    /**
     * 补全RoutePlan中的POI信息
     * @param rp RoutePlan
     * @throws IOException
     * @throws RateLimitExecutor.QuotaExhaustedException
     * @throws ExecutionException
     * @throws InterruptedException
     * @throws TimeoutException
     */
    public static void buildPOI(RoutePlan rp, String alternativeType) throws IOException, RateLimitExecutor.QuotaExhaustedException, ExecutionException, InterruptedException, TimeoutException, POINoWhereException {
        buildPOI(rp, alternativeType, AmapAdapter.get());
    }

    public static void buildPOI(RoutePlan rp, MapAdapter adapter) throws IOException, RateLimitExecutor.QuotaExhaustedException, ExecutionException, InterruptedException, TimeoutException, POINoWhereException {
        buildPOI(rp, "", adapter);
    }

    public static void buildPOI(RoutePlan rp, String alternativeType, MapAdapter adapter) throws IOException, RateLimitExecutor.QuotaExhaustedException, ExecutionException, InterruptedException, TimeoutException, POINoWhereException {

        // POI缓存，减少搜索次数
        Map<String, POI> poiCache = new HashMap<>();

        if (rp.getDepos() != null) {
            for(Depo depo : rp.getDepos()) {

                var poi = depo.getLoc();
                if(poi.isRaw()){
                    depo.setLoc(queryPOIWithCache(poi, poiCache, alternativeType, adapter));
                }
            }
        }

        if (rp.getAgents() != null) {
            for(AgentEachDay a : rp.getAgents()) {

                var poi = a.getStartLoc();
                if(poi.isRaw()){
                    a.setStartLoc(queryPOIWithCache(poi, poiCache, alternativeType, adapter));
                }
            }
        }

        if (rp.getTickets() != null) {
            for(Ticket t : rp.getTickets()) {

                var poi = t.getLoc();
                if(poi.isRaw()){
                    t.setLoc(queryPOIWithCache(poi, poiCache, alternativeType, adapter));
                }
            }
        }

        List<POI> depo_pois = rp.getDepos() == null ? new LinkedList<>() : rp.getDepos().stream().map(Depo::getLoc).distinct().collect(Collectors.toList());
        List<POI> agent_pois = rp.getAgents() == null ? new LinkedList<>() : rp.getAgents().stream().map(Agent::getStartLoc).distinct().collect(Collectors.toList());
        List<POI> ticket_pois = rp.getTickets() == null ? new LinkedList<>() : rp.getTickets().stream().map(Ticket::getLoc).distinct().collect(Collectors.toList());

        List<POI> new_pois = new ArrayList<>(Stream.of(depo_pois, agent_pois, ticket_pois)
                .flatMap(Collection::stream)
                .distinct()
                .collect(Collectors.toList()));

        rp.setPois(new_pois);
    }

    /**
     * 基于RoutePlan中现有路线相关POI，补全/更新在途矩阵中的相关度量值和具体路线
     * @param plan RoutePlan
     * @throws POINoWhereException POI不存在
     */
    public static void populateMatrixWithExistRoute(RoutePlan plan) throws POINoWhereException {
        populateMatrixWithExistRoute(plan, AmapAdapter.get());
    }

    public static void populateMatrixWithExistRoute(RoutePlan plan, MapAdapter adapter) throws POINoWhereException {

        List<POI> depo_pois = plan.getDepos() == null ? new LinkedList<>() : plan.getDepos().stream().map(Depo::getLoc).distinct().collect(Collectors.toList());
        List<POI> agent_pois = plan.getAgents() == null ? new LinkedList<>() : plan.getAgents().stream().map(Agent::getStartLoc).distinct().collect(Collectors.toList());
        List<POI> ticket_pois = plan.getTickets() == null ? new LinkedList<>() : plan.getTickets().stream().map(Ticket::getLoc).distinct().collect(Collectors.toList());

        List<POI> new_pois = new ArrayList<>(Stream.of(depo_pois, agent_pois, ticket_pois)
                .flatMap(Collection::stream)
                .distinct()
                .collect(Collectors.toList()));

        // 异常检测
        if(new_pois.stream().anyMatch(poi -> poi.equals(POI.NoWhere)))
            throw new POINoWhereException();

        // 如果距离矩阵不包含已有POI的度量值，对其进行初始化
        if(plan.getMatrix() == null ||
            // TODO 必要性？
            ! plan.getMatrix().data.keySet().containsAll(new_pois.stream().map(poi -> poi.id).collect(Collectors.toSet())))
        {
            plan.setMatrix(TransitMatrix.init(new_pois));
        }

        //
        if (plan.getAgents() != null) {

            for(AgentEachDay a : plan.getAgents()) {

                int ticket_size = a.getTickets().size();

                List<Route> routes = new LinkedList<>();

                for(int i=0; i<ticket_size; i++) {

                    Ticket t = a.getTickets().get(i);
                    // 第一条 仓库到第一个客户
                    if(i == 0) {
                        Route r = adapter.routing(a, a.getStartLoc(), t.getLoc());
                        routes.add(r);
                        plan.getMatrix().put(a.getStartLoc().id, t.getLoc().id, r.transit);
                    }
                    // 客户到客户
                    else {
                        Ticket t_last = a.getTickets().get(i-1);
                        Route r = adapter.routing(a, t_last.getLoc(), t.getLoc());
                        routes.add(r);
                        plan.getMatrix().put(t_last.getLoc().id, t.getLoc().id, r.transit);
                    }
                    // 最后一条 返仓
                    if(i == ticket_size - 1) {
                        Route r_b = adapter.routing(a, t.getLoc(), a.getStartLoc());
                        routes.add(r_b);
                        plan.getMatrix().put(t.getLoc().id, a.getStartLoc().id, r_b.transit);
                    }
                }

                a.setRoutes(routes);
            }
        }

        plan.setPois(new_pois);
    }

    /**
     * 基于变动的Ticket，更新在途矩阵
     * @param plan
     * @throws POINoWhereException
     */
    public static void populateMatrixWithChangingTickets(RoutePlan plan) throws POINoWhereException {
        populateMatrixWithChangingTickets(plan, AmapAdapter.get());
    }

    public static void populateMatrixWithChangingTickets(RoutePlan plan, MapAdapter adapter) throws POINoWhereException {

        List<POI> depo_pois = plan.getDepos() == null ? new LinkedList<>() : plan.getDepos().stream().map(Depo::getLoc).distinct().collect(Collectors.toList());
        List<POI> agent_pois = plan.getAgents() == null ? new LinkedList<>() : plan.getAgents().stream().map(Agent::getStartLoc).distinct().collect(Collectors.toList());
        List<POI> ticket_pois = plan.getTickets() == null ? new LinkedList<>() : plan.getTickets().stream().map(Ticket::getLoc).distinct().collect(Collectors.toList());

        List<POI> new_pois = new ArrayList<>(Stream.of(depo_pois, agent_pois, ticket_pois)
                .flatMap(Collection::stream)
                .distinct()
                .collect(Collectors.toList()));

        // 异常检测
        if(new_pois.stream().anyMatch(poi -> poi.equals(POI.NoWhere)))
            throw new POINoWhereException();

        if (plan.getMatrix() == null || plan.getMatrix().data == null) {
            plan.setMatrix(TransitMatrix.init(new_pois));
        }
        plan.setPois(new_pois);

        //
        if (plan.getAgents() != null) {

            for(AgentEachDay a : plan.getAgents()) {

                int ticket_size = a.getTickets().size();

                for(int i=0; i<ticket_size; i++) {

                    Ticket t = a.getTickets().get(i);
                    if (t.isMoved()) {
                        if (i == 0) {
                            Route r = adapter.routing(a, a.getStartLoc(), t.getLoc());
                            plan.getMatrix().put(a.getStartLoc().id, t.getLoc().id, r.transit);
                        } else {
                            Ticket t_last = a.getTickets().get(i - 1);
                            Route r = adapter.routing(a, t_last.getLoc(), t.getLoc());
                            plan.getMatrix().put(t_last.getLoc().id, t.getLoc().id, r.transit);
                            // 最后一条 返仓
                            if (i == ticket_size - 1) {
                                Route r_b = adapter.routing(a, t.getLoc(), a.getStartLoc());
                                plan.getMatrix().put(t.getLoc().id, a.getStartLoc().id, r_b.transit);
                            }
                        }
                    }
                }
            }
        }
    }

    /**
     *
     * @param plan
     * @throws POINoWhereException
     */
    public static void buildMatrix(RoutePlan plan) throws POINoWhereException {
        buildMatrix(plan, MatrixMode.MANHATTAN);
    }

    /**
     * 考虑增量更新情况的在途矩阵计算
     * @param plan 规划方案
     * @throws POINoWhereException POI不存在
     */
    public static void buildMatrix(RoutePlan plan, MatrixMode matrixMode) throws POINoWhereException {
        buildMatrix(plan, matrixMode, AmapAdapter.get());
    }

    public static void buildMatrix(RoutePlan plan, MatrixMode matrixMode, MapAdapter adapter) throws POINoWhereException {
        matrixMode = MatrixMode.normalize(matrixMode);
        // 1.1 POI 去重
        List<POI> new_pois = Stream.of(
                        plan.getDepos().stream().map(Depo::getLoc),
                        plan.getAgents().stream().map(Agent::getStartLoc),
                        plan.getTickets().stream().map(Ticket::getLoc)
                )
                .flatMap(Function.identity())
                .distinct()
                .collect(Collectors.toList());

        // 1.2 异常检测
        if(new_pois.stream().anyMatch(poi -> poi.equals(POI.NoWhere)))
            throw new POINoWhereException();

        // plan.pois 包含 POI 而 matrix 中没有对应索引，也需要重新计算
        // 1.3 获取已在矩阵中索引的POI
        var exist_pois = plan.getPois() == null ? new LinkedList<>() : plan.getPois().stream().filter(p -> {
            if (plan.getMatrix() != null && plan.getMatrix().data != null) {
                return plan.getMatrix().data.containsKey(p.id);
            }
            return false;
        }).collect(Collectors.toList());

        // 1.4 计算 新增POI / 无效POI
        var pois_to_add = new ArrayList<>((CollectionUtils.removeAll(new_pois, exist_pois)));

        //
        logger.info("POI size: {}, New added POI size: {}", new_pois.size(), pois_to_add.size());

        // 1.5 初始化距离矩阵
        TransitMatrix matrix_new = TransitMatrix.init(new_pois);

        AtomicInteger i = new AtomicInteger(0);
        // 2. 距离修正
        List<Future<?>> futures = new ArrayList<>();
        if (MatrixMode.MANHATTAN.equals(matrixMode)) {
            // 不做任何操作，TransitMatrix.init(new_pois) 已是曼哈顿距离估算
            logger.info("Build ticket matrix by manhattan...");
        }
        else if (adapter instanceof HereAdapter hereAdapter && hereAdapter.isMatrixRoutingEnabled()) {
            plan.setPois(new_pois);
            plan.setMatrix(hereAdapter.matrixRouting(new_pois));
            return;
        } else {
            for (Ticket t : plan.getTickets()) {
                futures.add(buildMatrixExecutor.submit(() ->
                        buildTicketMatrixByRouting(plan, t, pois_to_add, matrix_new, i.incrementAndGet(), adapter)));
            }
        }

        // TODO 推荐使用 ForkJoinPool
        // 阻塞直到所有任务完成
        for (Future<?> future : futures) {
            try {
                try {
                    future.get(); // 阻塞直到任务完成
                } catch (InterruptedException e) {
                    throw new RuntimeException(e);
                }
            } catch (ExecutionException e) {
                // 处理任务执行过程中抛出的异常
                logger.error("Task execution error", e.getCause());
            }
        }

        // 赋值
        plan.setPois(new_pois);
        plan.setMatrix(matrix_new);
    }

    private static void buildTicketMatrixByRouting(RoutePlan plan, Ticket t, List<POI> pois_to_add, TransitMatrix matrix_new, int ticketIndex, MapAdapter adapter) {

        logger.info("Ticket-{}", ticketIndex);

        POI ticket_poi = t.getLoc();
        // 多仓指派情况，如果ticket的depoId已经指定，则只计算关联在途信息
        List<POI> depo_pois = plan.getDepos().stream()
                .filter(d -> StringUtils.isBlank(t.getDepoId()) || t.getDepoId().equals(d.getId()))
                .map(Depo::getLoc)
                .collect(Collectors.toList());

        // 2.1 工单 到 仓库
        for(POI depo_poi : depo_pois) {

            // 仓库 或 ticket 是新增的，需要重新计算；否则复制前值
            boolean useRouting = pois_to_add.contains(depo_poi) || pois_to_add.contains(ticket_poi);
            // 回程赋值
            matrix_new.put(ticket_poi.id, depo_poi.id, useRouting ? transit(adapter, ticket_poi, depo_poi) : plan.getMatrix().get(ticket_poi.id, depo_poi.id));
            // 去程赋值
            matrix_new.put(depo_poi.id, ticket_poi.id, useRouting ? transit(adapter, depo_poi, ticket_poi) : plan.getMatrix().get(depo_poi.id, ticket_poi.id));
        }

        // 2.2 工程师距离修正
        // 多仓指派筛选
        List<POI> agent_pois = plan.getAgents().stream()
                .filter(a -> StringUtils.isBlank(t.getDepoId()) || t.getDepoId().equals(a.getDepoId()))
                .map(Agent::getStartLoc)
                .collect(Collectors.toList());

        matrix_new.routingLinearTransform(ticket_poi, agent_pois, pois_to_add, Math.min(2, agent_pois.size()), (origin, destination) -> transit(adapter, origin, destination));

        // 2.3 工单距离修正
        List<POI> ticket_pois = plan.getTickets().stream()
                .filter(t1 -> StringUtils.isBlank(t.getDepoId()) || t.getDepoId().equals(t1.getDepoId()))
                .map(Ticket::getLoc)
                .collect(Collectors.toList());

        matrix_new.routingLinearTransform(ticket_poi, ticket_pois, pois_to_add, Math.min(5, ticket_pois.size()), (origin, destination) -> transit(adapter, origin, destination));
    }

    private static one.rewind.xforce.geo.transit.Transit transit(MapAdapter adapter, POI origin, POI destination) {
        if (adapter.provider() == MapProvider.AMAP) {
            return AmapTransitCalculator.inst().calc(origin, destination);
        }
        return adapter.routing(origin, destination).transit;
    }
}
