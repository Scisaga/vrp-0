package one.rewind.xforce.json;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;
import org.optaplanner.core.api.score.buildin.hardmediumsoftlong.HardMediumSoftLongScore;

import java.io.IOException;

/**
 * @author Yang Zhongwei
 * @date 2025/6/5
 * @description HardMediumSoftLongScore.class 反序列化器
 */
public class HardMediumSoftLongScoreDeserializer extends JsonDeserializer<HardMediumSoftLongScore> {
    @Override
    public HardMediumSoftLongScore deserialize(JsonParser p, DeserializationContext ctxt) throws IOException {
        String text = p.getText();
        return HardMediumSoftLongScore.parseScore(text);
    }
}