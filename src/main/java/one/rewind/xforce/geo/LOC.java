package one.rewind.xforce.geo;

import com.fasterxml.jackson.annotation.JsonInclude;
import io.quarkus.runtime.annotations.RegisterForReflection;

import java.io.Serializable;

/**
 * 原Amap基础坐标类
 * @author guohongyun
 */
@RegisterForReflection(serialization = true)
public class LOC implements Serializable {
    public double lat;
    public double lon;

    public LOC() {
        lat = lon = 0.0;
    }
    public LOC(double lat, double lon) {
        this.lat = lat;
        this.lon = lon;
    }

    public double getLat() {
        return lat;
    }

    public void setLat(double lat) {
        this.lat = lat;
    }

    public double getLon() {
        return lon;
    }

    public void setLon(double lon) {
        this.lon = lon;
    }

    public String toString() {
        return "lat=" + lat + ", lon=" + lon;
    }
}
