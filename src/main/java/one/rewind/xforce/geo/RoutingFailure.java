package one.rewind.xforce.geo;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.quarkus.runtime.annotations.RegisterForReflection;
import org.eclipse.microprofile.openapi.annotations.media.Schema;

import java.io.Serializable;

/**
 * A sanitized failure returned while obtaining one route segment.
 */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@RegisterForReflection(serialization = true)
@Schema(description = "路径服务失败信息")
public class RoutingFailure implements Serializable {

    @Schema(description = "请求路径服务时使用的车辆类型")
    public String vehicleType;

    @Schema(description = "不含查询参数和密钥的路径服务接口标识")
    public String endpoint;

    @Schema(description = "路径服务或客户端的错误码")
    public String code;

    @Schema(description = "脱敏后的错误原因")
    public String message;

    public RoutingFailure() {
    }

    public RoutingFailure(String vehicleType, String endpoint, String code, String message) {
        this.vehicleType = vehicleType;
        this.endpoint = endpoint;
        this.code = code;
        this.message = message;
    }
}
