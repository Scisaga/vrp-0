package one.rewind.xforce.json;

import com.fasterxml.jackson.annotation.JsonValue;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;

/**
 * @author Yang Zhongwei
 * @date 2025/6/5
 * @description
 */
@JsonDeserialize(using = HardMediumSoftLongScoreDeserializer.class)
public abstract class HardMediumSoftLongScoreMixIn {
    @JsonValue
    public abstract String toString();
}
