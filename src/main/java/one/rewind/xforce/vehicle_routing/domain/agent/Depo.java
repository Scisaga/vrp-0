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
        requiredProperties = {"id"},
        properties = {
                @SchemaProperty(
                        name = "loc",
                        description = "位置。可传 plan.pois 中 POI 的 ID 字符串，或直接传 POI 对象。",
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
