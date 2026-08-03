package one.rewind.amap;

import one.rewind.xforce.geo.POI;

import java.io.IOException;
import java.util.List;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeoutException;

public interface POIInquirer {

    List<POI> query(String city, String addr) throws IOException, RateLimitExecutor.QuotaExhaustedException, ExecutionException, InterruptedException, TimeoutException;
}
