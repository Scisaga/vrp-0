package one.rewind.xforce.json;

import com.fasterxml.jackson.databind.MapperFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.quarkus.jackson.ObjectMapperCustomizer;
import jakarta.inject.Singleton;

@Singleton
public class OMRegister implements ObjectMapperCustomizer {

    public void customize(ObjectMapper om) {
        // for JsonView work properly
        om.configure(MapperFeature.DEFAULT_VIEW_INCLUSION, false);
        OM.config(om);
    }
}