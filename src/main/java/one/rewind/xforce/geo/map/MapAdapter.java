package one.rewind.xforce.geo.map;

import one.rewind.amap.RateLimitExecutor;
import one.rewind.xforce.geo.POI;
import one.rewind.xforce.geo.Route;
import one.rewind.xforce.vehicle_routing.domain.agent.Agent;

import java.io.IOException;
import java.util.List;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeoutException;

/** Provider-neutral surface used by the VRP business flow. */
public interface MapAdapter {

    MapProvider provider();

    boolean isEnabled();

    void requireEnabled();

    POI query(String city, String address) throws IOException, RateLimitExecutor.QuotaExhaustedException,
            ExecutionException, InterruptedException, TimeoutException;

    POI query(String city, String type, String address) throws IOException, RateLimitExecutor.QuotaExhaustedException,
            ExecutionException, InterruptedException, TimeoutException;

    List<POI> fetchPOI(String keywords, String types, String city, int offset, int page)
            throws IOException, RateLimitExecutor.QuotaExhaustedException, ExecutionException,
            InterruptedException, TimeoutException;

    List<POI> geocode(String address, String city) throws IOException, RateLimitExecutor.QuotaExhaustedException,
            ExecutionException, InterruptedException, TimeoutException;

    POI regeo(String location) throws IOException, RateLimitExecutor.QuotaExhaustedException,
            ExecutionException, InterruptedException, TimeoutException;

    Route routing(POI origin, POI destination);

    Route routing(Agent agent, POI origin, POI destination);
}
