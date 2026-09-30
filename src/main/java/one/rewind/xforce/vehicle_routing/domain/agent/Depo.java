package one.rewind.xforce.vehicle_routing.domain.agent;

import com.fasterxml.jackson.annotation.JsonIdentityInfo;
import com.fasterxml.jackson.annotation.JsonIdentityReference;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.ObjectIdGenerators;
import io.quarkus.runtime.annotations.RegisterForReflection;
import one.rewind.xforce.geo.POI;
import org.eclipse.microprofile.openapi.annotations.media.Schema;
import org.eclipse.microprofile.openapi.annotations.media.SchemaProperty;

import java.io.Serializable;
import java.util.List;

@Schema(
        requiredProperties = {"id", "loc"},
        properties = {
                @SchemaProperty(
                        name = "loc",
                        description = "必填仓库位置。可传 plan.pois 中 POI 的 ID 字符串，或直接传完整 POI 对象。"
                                + "使用字符串时 plan.pois 必须存在且非空，并包含该 ID 的完整 POI；"
                                + "仅当全部仓库 loc、车辆/工程师 start_loc 和工单 loc 都是完整内联对象时才可省略 plan.pois。"
                                + "完整 POI 的 ID 必须非空且唯一，并通过 location 或 loc 携带合法经纬度坐标。"
                                + "AI 客户端新建请求应首选集中式 plan.pois + ID 引用，同一请求不要混用两种形式。",
                        oneOf = {String.class, POI.class},
                        example = "B0G2X7N5D2"
                )
        }
)
@RegisterForReflection(serialization = true)
public class Depo implements Serializable {

    @Schema(
            description = "仓库id"
    )
    private String id;

    @Schema(
            description = "仓库名称"
    )
    private String name;

    @JsonIdentityReference(alwaysAsId = false)
    @Schema(hidden = true)
    private POI loc;

    public Depo() {}

    /**
     *
     * @param id
     * @param name
     * @param loc
     */
    public Depo(String id, String name, POI loc) {
        this.setId(id);
        this.setName(name);
        this.setLoc(loc);
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

    public POI getLoc() {
        return loc;
    }

    public void setLoc(POI loc) {
        this.loc = loc;
    }
}
