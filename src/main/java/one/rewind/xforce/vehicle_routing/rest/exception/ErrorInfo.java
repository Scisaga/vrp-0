package one.rewind.xforce.vehicle_routing.rest.exception;

import io.quarkus.runtime.annotations.RegisterForReflection;
import com.fasterxml.jackson.annotation.JsonProperty;
import org.eclipse.microprofile.openapi.annotations.media.Schema;

import java.util.Map;
import java.util.UUID;

@RegisterForReflection(serialization = true)
@Schema(description = "统一 REST 错误响应。网页客户端使用 error_code 和 error_params 本地化展示，message 仅保留给兼容客户端和诊断。")
public record ErrorInfo(
        UUID id,
        @JsonProperty("error_code") @Schema(description = "稳定、面向机器的错误码") String errorCode,
        @JsonProperty("error_params") @Schema(description = "错误码插值所需的非敏感参数") Map<String, String> errorParams,
        @Schema(description = "向后兼容的服务端诊断消息；网页不得直接展示") String message
) {
    public ErrorInfo {
        errorCode = errorCode == null || errorCode.isBlank() ? "internal_error" : errorCode;
        errorParams = errorParams == null ? Map.of() : Map.copyOf(errorParams);
    }

    /**
     * 保持原有 Java 调用点兼容；新调用点必须显式提供稳定错误码。
     */
    public ErrorInfo(UUID id, String message) {
        this(id, "internal_error", Map.of(), message);
    }
}
