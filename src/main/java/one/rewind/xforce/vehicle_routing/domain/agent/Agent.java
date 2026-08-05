package one.rewind.xforce.vehicle_routing.domain.agent;

import com.fasterxml.jackson.annotation.JsonIdentityReference;
import com.fasterxml.jackson.annotation.JsonIgnore;
import io.quarkus.runtime.annotations.RegisterForReflection;
import one.rewind.xforce.geo.POI;
import one.rewind.xforce.geo.Route;
import one.rewind.xforce.geo.transit.TransitMatrix;
import one.rewind.xforce.vehicle_routing.domain.cost.CostParameter;
import org.eclipse.microprofile.openapi.annotations.media.Schema;

import java.io.Serializable;
import java.text.DecimalFormat;
import java.util.*;

/**
 * Agent
 * 1. 具有技能、最大载重等属性
 * 2. 执行Ticket
 */
@RegisterForReflection(serialization = true)
public class Agent implements Serializable {

    @Schema(
            title = "燃料类型",
            description = "可选值：GAS_92（92 号汽油），按升/百公里核算燃油消耗；ELEC（电力），按千瓦时/百公里核算电耗。"
    )
    public enum FuelType {
        GAS_92,
        ELEC
    }

    @Schema(
            title = "车辆类型",
            description = "可选值：TRUCK（货车），按货车道路能力规划路线；CAR（汽车），按普通驾车能力规划路线；E_BIKE（电动自行车），按骑行能力规划路线。"
    )
    public enum VehicleType {
        TRUCK,
        CAR,
        E_BIKE
    }

    private static DecimalFormat df = new DecimalFormat("##.0");

    String id;

    private String name;

    @Schema(name = "depo_id", description = "网点ID")
    private String depoId;

    @JsonIdentityReference(alwaysAsId = false)
    @Schema(hidden = true)
    private POI startLoc;

    @Schema(description = "服务技能")
    private List<String> skills = new LinkedList<>();

    @Schema(name = "qualification_levels", description = "工程师资质等级")
    private Map<String, Double> qualificationLevels = new LinkedHashMap<>();

    @Schema(name = "vehicle_type", title = "车辆类型", description = "决定车辆执行工单时使用的道路路径规划方式。")
    private VehicleType vehicleType;

    @Schema(name = "fuel_type", title = "燃料类型", description = "决定车辆能耗及能源成本的核算口径。")
    private FuelType fuelType;

    @Schema(name = "fuel_consumption", description = "每百公里燃油/电能消耗：GAS_92 为 L/100km，ELEC 为 kWh/100km")
    private double fuelConsumption;

    @Schema(description = "是否租借")
    private boolean rented;

    @Schema(name = "fix_cost_daily", description = "每日固定成本，单位元/日")
    private double fixCostDaily;

    @Schema(description = "车辆大小")
    private int size;

    @Schema(description = "车辆高度")
    private double height;

    @Schema(description = "车辆宽度")
    private double width;

    @Schema(description = "核定载重，单位吨")
    private double weight;

    @Schema(description = "核定体积，单位立方米")
    private double vol;

    @Schema(description = "路线")
    private List<Route> routes;

    @Schema(description = "在途矩阵句柄")
    public transient TransitMatrix matrix;

    @Schema(name = "cost_parameter", description = "成本参数")
    public transient CostParameter costParameter;

    @Schema(hidden = true)
    private boolean isVirtual = false;

    public Agent() {}

    /**
     *
     * @param id ID
     * @param depoId 网点ID
     * @param name 名称
     * @param startLoc 开始POI
     * @param skills 技能列表
     * @param weight 最大载重
     * @param vol 最大容积
     */
    public Agent(String id, String name, String depoId, POI startLoc, List<String> skills, double weight, double vol) {
        this.setId(id);
        this.setDepoId(depoId);
        this.setName(name);
        this.setStartLoc(startLoc);
        this.setSkills(skills);
        this.weight = weight;
        this.vol = vol;
        this.costParameter = new CostParameter();
        this.vehicleType = VehicleType.CAR;
    }


    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getDepoId() {
        return depoId;
    }

    public void setDepoId(String depoId) {
        this.depoId = depoId;
    }

    public POI getStartLoc() {
        return startLoc;
    }

    public void setStartLoc(POI startLoc) {
        this.startLoc = startLoc;
    }

    public List<String> getSkills() {
        return skills;
    }

    public void setSkills(List<String> skills) {
        this.skills = skills;
    }

    public VehicleType getVehicleType() {
        return vehicleType;
    }

    public void setVehicleType(VehicleType vehicleType) {
        this.vehicleType = vehicleType;
    }

    public FuelType getFuelType() {
        return fuelType;
    }

    public void setFuelType(FuelType fuelType) {
        this.fuelType = fuelType;
    }

    public double getFuelConsumption() {
        return fuelConsumption;
    }

    public void setFuelConsumption(double fuelConsumption) {
        this.fuelConsumption = fuelConsumption;
    }

    public boolean isRented() {
        return rented;
    }

    public void setRented(boolean rented) {
        this.rented = rented;
    }

    public double getFixCostDaily() {
        return fixCostDaily;
    }

    public void setFixCostDaily(double fixCostDaily) {
        this.fixCostDaily = fixCostDaily;
    }

    public int getSize() {
        return size;
    }

    public void setSize(int size) {
        this.size = size;
    }

    public double getHeight() {
        return height;
    }

    public void setHeight(double height) {
        this.height = height;
    }

    public double getWidth() {
        return width;
    }

    public void setWidth(double width) {
        this.width = width;
    }

    public void setWeight(double weight) {
        this.weight = weight;
    }

    public double getWeight() {
        return this.weight;
    }

    public void setVol(double vol) {
        this.vol = vol;
    }

    public double getVol() {
        return this.vol;
    }

    @JsonIgnore
    public Capacity getCapacity() {
        return new Capacity(weight, vol);
    }

    @JsonIgnore
    public Capacity getOverloadCapacity() {
        return new Capacity(weight * this.costParameter.getMaxOverloadRatio(), vol);
    }

    public List<Route> getRoutes() {
        return routes;
    }

    public void setRoutes(List<Route> routes) {
        this.routes = routes;
    }

    public Map<String, Double> getQualificationLevels() {
        return qualificationLevels;
    }

    public void setQualificationLevels(Map<String, Double> qualificationLevels) {
        this.qualificationLevels = qualificationLevels;
    }

    @Schema(description = "是否虚拟工程师")
    public boolean isVirtual() {
        return isVirtual;
    }

    public void setVirtual(boolean virtual) {
        isVirtual = virtual;
    }

    public String toString() {
        return String.format("%s (%s) %s ", getName(), getStartLoc().getEntrLoc(), getSkills()) + "[w=" + df.format(this.weight) + ", v=" + df.format(this.vol) + "]";
    }

    /**
     * 载荷
     * @param weight 重量
     * @param vol 体积
     */
    public record Capacity(double weight, double vol) implements Serializable {

        private static final DecimalFormat df = new DecimalFormat("##.0");

        public Capacity add(Capacity c1) {
            return new Capacity(this.weight + c1.weight, this.vol + c1.vol);
        }

        public Capacity minus(Capacity c1) {
            return new Capacity(this.weight - c1.weight, this.vol - c1.vol);
        }

        public boolean zero() {
            return this.weight == 0 || this.vol == 0;
        }

        public boolean gt(Capacity c1){
            if(weight > c1.weight) return true;
            return vol > c1.vol;
        }

        public double getPenalty(Capacity agentCapacity) {
            return Math.max(weight - agentCapacity.weight, 0) + Math.max(vol - agentCapacity.vol, 0);
        }

        public String toString() {
            return String.format("[w=%s, v=%s]",  df.format(weight), df.format(vol));
        }
    }
}
