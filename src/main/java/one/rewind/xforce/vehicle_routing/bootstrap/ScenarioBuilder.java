package one.rewind.xforce.vehicle_routing.bootstrap;

import com.fasterxml.jackson.core.JsonProcessingException;
import one.rewind.amap.AmapAdapter;
import one.rewind.amap.RateLimitExecutor;
import one.rewind.xforce.geo.POI;
import one.rewind.xforce.geo.POIStore;
import one.rewind.xforce.geo.transit.TransitMatrix;
import one.rewind.xforce.json.OM;
import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.domain.agent.Agent;
import one.rewind.xforce.vehicle_routing.domain.agent.AgentEachDay;
import one.rewind.xforce.vehicle_routing.domain.agent.Depo;
import one.rewind.xforce.vehicle_routing.domain.ticket.Ticket;
import one.rewind.xforce.vehicle_routing.domain.ticket.TimeWindow;
import one.rewind.xforce.vehicle_routing.exception.POINoWhereException;
import org.apache.commons.collections4.CollectionUtils;
import org.apache.commons.math3.distribution.ExponentialDistribution;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import java.io.IOException;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeoutException;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import java.util.stream.Stream;

import one.rewind.xforce.vehicle_routing.db.dto.Scenario;

import static one.rewind.xforce.vehicle_routing.bootstrap.GeoUtil.buildMatrix;
import static one.rewind.xforce.vehicle_routing.bootstrap.GeoUtil.buildPOI;
import static one.rewind.xforce.vehicle_routing.bootstrap.Sampler.sample;

/**
 * 仿真场景生成器
 */
public class ScenarioBuilder {

    public final static Logger logger = LogManager.getLogger(ScenarioBuilder.class.getName());

    //
    public POIStore Ticket_POI_Store;

    public POIStore Agent_Inst_POI_Store;

    public POIStore Depo_POI_Store;

    int planning_interval_days = 1;

    // 规划天数
    int schedule_interval_days = 1;

    // 仓库数量
    int depo_num = 2;

    // 初始货车数量
    int agent_delv_num = 40;

    //车辆类型
    Agent.VehicleType vehicleType = Agent.VehicleType.CAR;

    // 货车具有安装技能比例
    float agent_delv_with_inst_rate = 0.5F;

    // 单独安装工程师数量
    int agent_inst_num = 40;

    // 车辆装载容量分布
    LinkedHashMap<Agent.Capacity, Double> agent_capacity_distribution = new LinkedHashMap<>(Map.of(
            new Agent.Capacity(2.5, 4), 0.2,
            new Agent.Capacity(8, 14), 0.8));
    // 车辆尺寸
    int size = 3;
    double height = 2.5;
    double width = 2.8;

    LocalTime shift_start_time_delv = LocalTime.of(6, 0);
    LocalTime shift_off_time_delv = LocalTime.of(21, 0);

    float on_duty_ratio_delv = 29f/30;

    LocalTime shift_start_time_inst = LocalTime.of(7, 30);
    LocalTime shift_off_time_inst = LocalTime.of(21, 30);

    float on_duty_ratio_inst = 6f/7;

    // 每日工单数
    int ticket_per_day = 200;

    // 每日工单最早生成时间
    LocalTime ticket_init_time = LocalTime.of(9, 0);

    // 每日工单最晚生成时间
    LocalTime ticket_last_time = LocalTime.of(18, 0);

    // 订单信息
    SKUSupplier skuSupplier = new SKUSupplier(false);

    // 配送时间窗
    TimeWindowSupplier timeWindowSupplier = new TimeWindowSupplier(TimeWindowSupplier.Type.Next_1D);

    boolean gen_inst_tickets = true;

    // 以天为单位的工单改约概率
    double ticket_reassign_rate = 0.01d;

    // 工单改约分布，以分钟为单位
    ExponentialDistribution ticket_reassign_ed = new ExponentialDistribution(1440 / ticket_reassign_rate);

    // 以天为单位的工单取消概率
    double ticket_cancel_rate = 0.01d;

    // 工单取消分布，以分钟为单位
    ExponentialDistribution ticket_cancel_ed = new ExponentialDistribution(1440 / ticket_cancel_rate);

    /**
     *
     */
    public ScenarioBuilder() throws JsonProcessingException {

        Ticket_POI_Store = new POIStore("data/public-demo/pois_ticket.json");

        Agent_Inst_POI_Store = new POIStore("data/public-demo/pois_agent_inst.json");

        Depo_POI_Store = new POIStore("data/public-demo/pois_depo.json");

        logger.info("Ticket POI Store: {}", Ticket_POI_Store.poi_map.size());
        logger.info("Depo POI Store: {}", Depo_POI_Store.poi_map.size());
        logger.info("Agent(Inst) POI Store: {}", Agent_Inst_POI_Store.poi_map.size());
    }

    /**
     *
     * @param ticket_per_day 每日ticker数量
     * @param depo_num 仓库数量
     * @param agent_delv_num 车数量
     * @param agent_delv_with_inst_rate 车同时可安装概率
     * @param agent_inst_num  安装工程师数量
     */
    public ScenarioBuilder(int ticket_per_day, int depo_num, int agent_delv_num, float agent_delv_with_inst_rate, int agent_inst_num) throws JsonProcessingException {
        this(ticket_per_day, depo_num, agent_delv_num, agent_delv_with_inst_rate, agent_inst_num, true);
    }

    /**
     *
     * @param ticket_per_day 每日ticker数量
     * @param depo_num 仓库数量
     * @param agent_delv_num 车数量
     * @param agent_delv_with_inst_rate 车同时可安装概率
     * @param agent_inst_num  安装工程师数量
     * @param gen_inst_tickets 是否生成安装工单
     */
    public ScenarioBuilder(int ticket_per_day, int depo_num, int agent_delv_num, float agent_delv_with_inst_rate, int agent_inst_num, boolean gen_inst_tickets) throws JsonProcessingException {
        this();
        this.ticket_per_day = ticket_per_day;
        this.depo_num = depo_num;
        this.agent_delv_num = agent_delv_num;
        this.agent_delv_with_inst_rate = agent_delv_with_inst_rate;
        this.agent_inst_num = agent_inst_num;
        this.gen_inst_tickets = gen_inst_tickets;
    }

    /**
     * 生成场景
     * @param name 场景名称
     * @return 场景对象
     */
    public Scenario build(String name, String desc) throws POINoWhereException, IOException, RateLimitExecutor.QuotaExhaustedException, ExecutionException, InterruptedException, TimeoutException {
        return build(name, desc, LocalDate.now());
    }

    /**
     * 生成场景
     * @param name 场景名称
     * @param planning_date 规划日期
     * @return 场景对象
     */
    public Scenario build(String name, String desc, LocalDate planning_date) throws POINoWhereException, IOException, RateLimitExecutor.QuotaExhaustedException, ExecutionException, InterruptedException, TimeoutException {

        Scenario scn = new Scenario(name, desc, planning_date, schedule_interval_days);

        scn.getPlan().setSkus(new LinkedList<>(SKUSupplier.sku_distribution.keySet()));

        initDepos(scn);

        initAgents(scn);

        initTickets(scn);

        buildPOI(scn.getPlan());

        buildMatrix(scn.getPlan(), GeoUtil.MatrixMode.ROUTING);

        return scn;
    }

    /**
     * 初始化仓库
     * @param scn 场景对象
     */
    public void initDepos(Scenario scn) {
        var depo_pois = Depo_POI_Store.select(depo_num);
        for(int i=0; i<depo_num; i++) {
            Depo depo = new Depo("depo-" + i, "Depo-" + i, depo_pois.get(i));
            scn.getPlan().getDepos().add(depo);
        }
    }

    /**
     * 初始化 Agent / AgentEachDay
     * @param scn 场景对象
     */
    public void initAgents(Scenario scn) {

        List<Agent> rawAgents = new ArrayList<>();

        // A 生成车辆基础信息
        int agent_delv_with_inst_num = Math.round(agent_delv_num * agent_delv_with_inst_rate);

        for(int i=0; i<agent_delv_num; i++) {

            // 指定初始位置
            POI depo_poi = scn.getPlan().getDepos().get(i % depo_num).getLoc();

            // 技能设置
            List<String> skills = new ArrayList<>(){{
                add("Delv");
            }};
            if(i < agent_delv_with_inst_num) skills.add("Inst");

            var c = sample(agent_capacity_distribution);
            //车辆创建
            Agent agent1 = new Agent("agent-" + i, "Agent-" + i, null, depo_poi, skills, c.weight(), c.vol());
            agent1.setVehicleType(vehicleType);
            agent1.setSize(size);
            agent1.setHeight(height);
            agent1.setWidth(width);
            rawAgents.add(agent1);
        }

        // B 生成安装工程师基础信息
        var agent_inst_pois = Agent_Inst_POI_Store.select(agent_inst_num);

        for(int i=agent_delv_num; i<agent_delv_num + agent_inst_num; i++) {
            Agent agent = new Agent("agent-" + i, "Agent-" + i, null, agent_inst_pois.get(i-agent_delv_num),
                    new ArrayList<>(){{
                        add("Delv");
            }}, 0, 0);
            rawAgents.add(agent);
        }

        // C 生成 AgentEachDay
        // C1 车辆 车辆平均30天检修一次 --> 车辆有1/30概率不工作
        List<Agent> agents_delv = rawAgents.stream().filter(a -> a.getSkills().contains("Delv")).collect(Collectors.toList());
        int agent_delv_avg_on_duty = Math.round((float) agents_delv.size() * (on_duty_ratio_delv)); // TODO

        for(int i=1; i<planning_interval_days + schedule_interval_days; i++) {

            LocalDate date = scn.getPlanningDate().plusDays(i);
            List<Agent> agents_delv_on_duty = sample(agents_delv, agent_delv_avg_on_duty);

            for(Agent a : agents_delv_on_duty) {
                AgentEachDay ad = new AgentEachDay(a, date, shift_start_time_delv, shift_off_time_delv);
                scn.getPlan().getAgents().add(ad);
            }
        }

        // C2 工程师 工程师每7天休息1天 --> 安装工程师有1/7概率不工作
        List<Agent> agents_inst = rawAgents.stream().filter(a -> a.getCapacity().zero()).collect(Collectors.toList());
        int agent_inst_avg_on_duty = Math.round((float) agents_inst.size() * (on_duty_ratio_inst)); // TODO

        for(int i=1; i<planning_interval_days + schedule_interval_days; i++) {
            LocalDate date = scn.getPlanningDate().plusDays(i);
            List<Agent> agents_inst_on_duty = sample(agents_inst, agent_inst_avg_on_duty);

            for(Agent a : agents_inst_on_duty) {
                AgentEachDay ad = new AgentEachDay(a, date, shift_start_time_inst, shift_off_time_inst);
                scn.getPlan().getAgents().add(ad);
            }
        }

        for(var a : scn.getPlan().getAgents()) {
            logger.info(a);
        }
    }

    /**
     * 初始化工单
     * @param scn 场景对象
     */
    public void initTickets(Scenario scn) {

        for (int i = 0; i < planning_interval_days; i++) {

            // 当前日期
            LocalDate date = scn.getPlanningDate().plusDays(i);
            String yyMMdd = date.format(DateTimeFormatter.ofPattern("yyMMdd"));

            // 生成工单创建时间点
            long gap_in_minutes = ticket_init_time.until(ticket_last_time, ChronoUnit.MINUTES);
            List<Integer> ticket_time_points = sample(ticket_per_day, (int) gap_in_minutes);

            List<POI> pois = Ticket_POI_Store.select(ticket_per_day);

            for (int j = 0; j < ticket_per_day; j++) {

                // 防止pois数量不足，取余操作
                POI poi = pois.get(j % pois.size());

                // 工单通用标题
                String ticket_id_prefix = "ticket-" + yyMMdd + "-" + j;

                List<SKUSupplier.Item> items = skuSupplier.get();

                // 模拟工单开始时间

                LocalDateTime ticket_create_time = date.atTime(ticket_init_time).plusMinutes(ticket_time_points.get(j));

                // 预期到达客户时间窗口
                LocalDateTime ticket_min_start_time = date.plusDays(1).atStartOfDay();
                LocalDateTime ticket_max_end_time = date.plusDays(schedule_interval_days).atTime(22, 00);
                if (new Random().nextDouble() < 0.5) {
                    TimeWindow tw = sample(timeWindowSupplier.get());
                    ticket_min_start_time = date.plusDays(tw.delay_days).atTime(tw.st);
                    ticket_max_end_time = date.plusDays(tw.delay_days).atTime(tw.et);
                }

                // 预期改约时间，如果改约时间 > 实际到达客户时间，则不触发改约事件
                LocalDateTime ticket_reassign_time = ticket_create_time.plusMinutes((long) ticket_reassign_ed.sample());

                // 预期取消时间，如果取消时间 > 实际到达客户时间，则不触发取消事件
                LocalDateTime ticket_cancel_time = ticket_create_time.plusMinutes((long) ticket_cancel_ed.sample());

                // 工单创建
                Ticket t1 = new Ticket(ticket_id_prefix + "-d", null, false, Ticket.Type.Delv,
                        new ArrayList<>(){{
                            add("Delv");
                }}, items, poi, ticket_create_time, ticket_min_start_time, ticket_max_end_time);
                t1.setReassignTime(ticket_reassign_time);
                t1.setCancelTime(ticket_cancel_time);
                //
                scn.getPlan().getTickets().add(t1);

                if (gen_inst_tickets) {

                    Ticket t2 = new Ticket(ticket_id_prefix + "-i", null, false, Ticket.Type.Inst,
                            new ArrayList<>(){{
                                add("Inst");
                    }}, items, poi, ticket_create_time, ticket_min_start_time, ticket_max_end_time);
                    t2.setReassignTime(ticket_reassign_time);
                    t2.setCancelTime(ticket_cancel_time);

                    t1.getRefTickets().add(t2);
                    t2.getDepTickets().add(t1);

                    scn.getPlan().getTickets().add(t2);
                }

            }
        }

        // 打印Ticket 看
        scn.getPlan().getTickets().stream()
                .collect(Collectors.groupingBy(t -> t.getMinStartTime().toLocalDate()))
                .forEach((d, tickets) -> {
                    logger.info("Date {}", d.format(DateTimeFormatter.ofPattern("yyMMdd")));
                    for (Ticket t : tickets) {
                        logger.info(t);
                    }
                });
    }



}
