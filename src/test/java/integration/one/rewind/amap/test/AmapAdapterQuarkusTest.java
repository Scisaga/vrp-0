package one.rewind.amap.test;

import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import com.fasterxml.jackson.core.JsonProcessingException;
import one.rewind.amap.AmapAdapter;
import one.rewind.amap.RateLimitExecutor;
import one.rewind.xforce.geo.POI;
import one.rewind.xforce.json.OM;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.util.List;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeoutException;

@QuarkusTest
@Tag("external")
public class AmapAdapterQuarkusTest {

    @BeforeAll
    static void requireExternalTestsEnabled() {
        one.rewind.xforce.test.support.ExternalTestSupport.requireExternalTestsEnabled();
    }

    @Inject
    AmapAdapter aa;

    @Test
    public void testFetch0() throws IOException, JsonProcessingException, RateLimitExecutor.QuotaExhaustedException, ExecutionException, InterruptedException, TimeoutException {

        List<POI> pois = AmapAdapter.get()
                .fetchPOI("小区", "120000", "110101", 20, 1);

        pois.forEach(poi -> {
            try {
                System.out.println(OM.toJson(poi));
            } catch (JsonProcessingException e) {
                throw new RuntimeException(e);
            }
        });
    }
}
