package one.rewind.xforce.json;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.core.Base64Variants;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.core.util.DefaultIndenter;
import com.fasterxml.jackson.core.util.DefaultPrettyPrinter;
import com.fasterxml.jackson.core.util.Separators;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;
// import io.hypersistence.utils.hibernate.type.util.ObjectMapperSupplier;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.apache.logging.log4j.core.impl.ExtendedStackTraceElement;
import org.apache.logging.log4j.core.impl.ThrowableProxy;
import org.optaplanner.core.api.score.buildin.hardmediumsoftlong.HardMediumSoftLongScore;

public class OM {

    private static ObjectMapper om;

    /**
     * 序列化方法
     * @param value
     * @return
     * @throws JsonProcessingException
     */
    public static String toJson(Object value) throws JsonProcessingException {
        if(om == null) om = prettyMapper();
        return om.writeValueAsString(value);
    }

    /**
     * 反序列化方法
     * @param json
     * @param clazz
     * @return
     * @param <T>
     * @throws JsonProcessingException
     */
    public static <T> T fromJson(String json, Class<T> clazz) throws JsonProcessingException {

        if(om == null) om = prettyMapper();

        return om.readValue(json, clazz);
    }

    /**
     *
     * @param json
     * @param tr
     * @return
     * @param <T>
     * @throws JsonProcessingException
     */
    public static <T> T fromJson(String json, TypeReference<T> tr) throws JsonProcessingException {

        if(om == null) om = prettyMapper();

        return om.readValue(json, tr);
    }

    /**
     *
     * @param om
     * @return
     */
    public static ObjectMapper config(ObjectMapper om) {

        om.findAndRegisterModules();

        om.configure(SerializationFeature.INDENT_OUTPUT, true);

        /**
         * Configure deserialization features
         */
        om.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        /**
         * https://github.com/FasterXML/jackson-module-kotlin/issues/378
         * https://github.com/FasterXML/jackson-databind/issues/3838
         *
         * POI灵活使用场景
         * 1. id已设置，序列化时使用id替换
         * 2. id未设置，只包含两个字段，代表用户手动输入
         *
         * 关联设置
         * 1. POI不能使用JsonCreator
         * 2. 所有POI类型地址字段：@JsonIdentityReference(alwaysAsId = false)
         * 3. RoutePlan中，pois必须前置序列化和反序列化，否则地址字段将不能正常使用引用id字符串
         */
        om.configure(DeserializationFeature.FAIL_ON_UNRESOLVED_OBJECT_IDS, false);

        /**
         * Register mixins
         */
        om.addMixIn(ThrowableProxy.class, ThrowableProxyWithStacktraceAsStringMixIn.class);

        // URL中Base64编码
        om.setBase64Variant(Base64Variants.MODIFIED_FOR_URL);


        // 换行缩进
        DefaultPrettyPrinter.Indenter indenter = new DefaultIndenter("  ", "\n");

        // 字段对象间 间隔设定
        DefaultPrettyPrinter printer = new DefaultPrettyPrinter().withSeparators(
                Separators.createDefaultInstance()
                        .withObjectFieldValueSeparator(':')
        );

        printer.indentObjectsWith(indenter); // 对象缩进设定
        printer.indentArraysWith(indenter); // 数组缩进设定

        om.setDefaultPrettyPrinter(printer);

        return om;
    }

    /**
     *
     * @return
     */
    public static ObjectMapper prettyMapper() {

        ObjectMapper om = JsonMapper.builder()
                .findAndAddModules()
                .addModule(new JavaTimeModule())
                .configure(SerializationFeature.INDENT_OUTPUT, true)
                .build();

        om.addMixIn(HardMediumSoftLongScore.class, HardMediumSoftLongScoreMixIn.class);

        return config(om);
    }

    /*@Override
    public ObjectMapper get() {
        if(om == null) om = prettyMapper();
        return om;
    }*/

}

abstract class ThrowableProxyWithStacktraceAsStringMixIn {
    @JsonProperty("cause")
    private ThrowableProxyWithStacktraceAsStringMixIn causeProxy;
    @JsonProperty
    private int commonElementCount;
    @JsonIgnore
    private ExtendedStackTraceElement[] extendedStackTrace;
    @JsonProperty
    private String localizedMessage;
    @JsonProperty
    private String message;
    @JsonProperty
    private String name;
    @JsonIgnore
    private transient Throwable throwable;

    ThrowableProxyWithStacktraceAsStringMixIn() {
    }

    @JsonIgnore
    public abstract String getCauseStackTraceAsString();

    @JsonProperty("extendedStackTrace")
    public abstract String getExtendedStackTraceAsString();

    @JsonIgnore
    public abstract StackTraceElement[] getStackTrace();

    @JsonProperty("suppressed")
    public abstract ThrowableProxy[] getSuppressedProxies();

    @JsonIgnore
    public abstract String getSuppressedStackTrace();

    @JsonIgnore
    public abstract Throwable getThrowable();
}


