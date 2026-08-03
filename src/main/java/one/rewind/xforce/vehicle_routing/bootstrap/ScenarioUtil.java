package one.rewind.xforce.vehicle_routing.bootstrap;

import one.rewind.xforce.geo.POI;
import one.rewind.xforce.vehicle_routing.domain.agent.Agent;
import one.rewind.xforce.vehicle_routing.domain.agent.AgentEachDay;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;

/**
 * 场景工具类
 */
public class ScenarioUtil {

    /**
     * 获取默认技能集合
     * @return 技能集合
     */
    public static List<String> getDefaultSkills() {
        return new ArrayList<>(){{
            add("Inst");
            add("Delv");
        }};
    }

    /**
     * 获取当日一个 4m2箱货
     * @param i 序号
     * @param startLoc 初始位置
     * @return AgentEachDay 对象
     */
    public static Agent get4m2Agent(int i, String name, String outletId, POI startLoc) {

        String id = "truck-" + i;
        Agent agent = new Agent(id, name, outletId, startLoc, getDefaultSkills(), 8.15, 18.5);
        agent.setSize(2);
        return new AgentEachDay(agent, LocalDate.now(), LocalTime.of(7, 0), LocalTime.of(20, 0));
    }
}
