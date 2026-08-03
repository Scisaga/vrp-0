package one.rewind.xforce.vehicle_routing.domain.ticket;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIdentityInfo;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.ObjectIdGenerators;
import io.quarkus.runtime.annotations.RegisterForReflection;
import one.rewind.xforce.geo.POI;
import org.eclipse.microprofile.openapi.annotations.media.Schema;

import java.io.Serializable;
import java.time.Duration;
import java.time.temporal.ChronoUnit;
import java.util.Map;

/**
 * SKU
 */
@Schema(requiredProperties = {"id"})
@JsonIdentityInfo(generator = ObjectIdGenerators.PropertyGenerator.class, property = "id", scope = SKU.class)
@RegisterForReflection(serialization = true)
public class SKU implements Serializable {

    public String id;

    public String name;

    @Schema(
            description = "重量"
    )
    public float weight;

    @Schema(
            description = "体积"
    )
    public float vol;

    public SKU() {}

    @JsonCreator
    public SKU(@JsonProperty("id") String id) {
        this.id = id;
    }

    public SKU(String id, String name, float weight, float vol) {
        this.id = id;
        this.name = name;
        this.weight = weight;
        this.vol = vol;
    }

    /**
     *
     * @param another
     * @return
     */
    public boolean equals(Object another) {

        //先判断是不是自己,提高运行效率
        if (this == another)
            return true;

        //再判断是不是Person类,提高代码的健壮性
        if (another instanceof POI) {

            //向下转型,父类无法调用子类的成员和方法
            POI poi2 = (POI) another;

            //最后判断类的所有属性是否相等，其中String类型和Object类型可以用相应的equals()来判断
            if (this.id.equals(poi2.id))
                return true;
        } else {
            return false;
        }

        return false;
    }


    @Override
    public int hashCode() {
        return id.hashCode();
    }
}
