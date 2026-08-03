package one.rewind.xforce.geo;

import com.fasterxml.jackson.annotation.*;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.micrometer.common.util.StringUtils;
import io.quarkus.runtime.annotations.RegisterForReflection;
import one.rewind.xforce.json.DeduplicateObjectIdResolver;
import org.eclipse.microprofile.openapi.annotations.media.Schema;

import java.io.Serializable;
import java.util.List;

/**
 * Amap POI对象封装
 */

@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonIdentityInfo(
        generator = ObjectIdGenerators.PropertyGenerator.class,
        property = "id",
        resolver = DeduplicateObjectIdResolver.class
)
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@RegisterForReflection(serialization = true)
public class POI implements Serializable {

    public static POI NoWhere = new POI("NoWhere");

    // B0FFFF40KD
    public String id;

    // 国瑞城
    public String name;

    // 116.422577,39.898286
    @Schema(
            description = "经纬度"
    )
    public String location;

    public LOC loc;

    // 崇文门外大街18号(崇文门地铁站G东南口步行470米)
    @Schema(
            description = "详细地址"
    )
    public String address;

    // 110000
    @Schema(
            description = "所属省份编码"
    )
    public String pcode;

    // 商务住宅;住宅区;住宅小区
    @Schema(
            description = "所属类型"
    )
    public String type;

    @Schema(
            description = " poi 图片相关信息"
    )
    public List<Photo> photos;

    // 5916637322
    @Schema(
            description = " poi 的地理格 id"
    )
    public String gridcode;

    // 120302
    @Schema(
            description = "分类编码"
    )
    public String typecode;

    // 010
    @Schema(
            description = "所属城市编码"
    )
    public String citycode;

    // 东城区
    @Schema(
            description = "所属区域名称"
    )
    public String adname;

    @Schema(
            description = "入口经纬度坐标"
    )
    public String entr_location;

    public LOC entr_loc;

    // 110101
    @Schema(
            description = "所属区域编码"
    )
    public String adcode;

    // 北京市
    @Schema(
            description = "所属省份名称"
    )
    public String pname;

    // 北京市
    @Schema(
            description = "所属城市名称"
    )
    public String cityname;

    public String getId() {
        return this.id;
    }

    public POI() {}

    /**
     *
     * @param id
     */
    public POI(String id) {
        this.id = id;
        this.name = id;
    }


    /**
     *
     * @param cityname
     * @param addr
     */
    public POI(String cityname, String addr) {
        this.cityname = cityname;
        this.address = addr;
    }

    /**
     *
     */
    @RegisterForReflection(serialization = true)
    public static class Photo {

        public Photo() {}

        public String title;
        public String url;
    }

    /**
     *
     * @param locStr
     * @return
     */
    public static LOC parseLoc(String locStr) {
        if(StringUtils.isBlank(locStr)) return null;

        String[] split = locStr.split(",");
        if(split.length != 2) return null;

        double lat = Double.parseDouble(split[0]);
        double lon = Double.parseDouble(split[1]);
        return new LOC(lat, lon);
    }

    /**
     *
     * @return 经纬度
     */
    public LOC getLoc(){

        if(this.loc == null) {
            loc = parseLoc(this.location);
        }

        return loc;
    }

    /**
     *
     * @return 入口经纬度
     */
    public LOC getEntrLoc(){
        if(this.entr_location == null) return getLoc();
        if(this.entr_loc == null) {
            entr_loc = parseLoc(entr_location);
        }
        return entr_loc;
    }

    /**
     *
     * @return
     */
    @JsonIgnore
    public boolean isNoWhere() {
        return this.equals(NoWhere);
    }

    /**
     *
     * @return
     */
    @JsonIgnore
    public boolean isRaw() {
        return StringUtils.isBlank(id);
    }

    /**
     * 获取与另外一个POI的角度关系
     * @param poi 另一个POI
     * @return 角度
     */
    @JsonIgnore
    public double getAngle(POI poi) {
        // Euclidean distance (Pythagorean theorem) - not correct when the surface is a sphere
        double latitudeDifference = poi.getEntrLoc().lat - getEntrLoc().lat;
        double longitudeDifference = poi.getEntrLoc().lon - getEntrLoc().lon;
        return Math.atan2(latitudeDifference, longitudeDifference);
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
            if (this.id != null) {
                if(this.id.equals(poi2.id)) return true;
            }
            else {
                if(this.cityname.equals(poi2.cityname) && this.address.equals(poi2.address)) return true;
            }

        }
        else {
            return false;
        }

        return false;
    }


    @Override
    public int hashCode() {
        return id.hashCode();
    }

    public String toString() {
        return this.id + " " + this.name + " " + this.cityname + this.adname + this.address;
    }

}
