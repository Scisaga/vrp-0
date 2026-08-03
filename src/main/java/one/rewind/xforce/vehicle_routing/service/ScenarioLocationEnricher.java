package one.rewind.xforce.vehicle_routing.service;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import one.rewind.amap.AmapAdapter;
import one.rewind.xforce.geo.LOC;
import one.rewind.xforce.geo.POI;
import one.rewind.xforce.geo.map.MapAdapter;
import one.rewind.xforce.geo.map.MapAdapterSelector;
import one.rewind.xforce.vehicle_routing.db.dto.Scenario;
import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.domain.agent.AgentEachDay;
import one.rewind.xforce.vehicle_routing.domain.agent.Depo;
import one.rewind.xforce.vehicle_routing.domain.ticket.Ticket;
import org.apache.commons.lang3.StringUtils;
import org.jboss.logging.Logger;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 补齐场景中尚未完整的地理位置数据。
 *
 * <p>已有坐标的 POI 仅在地址或城市缺失时执行逆地理解析，并且只补齐这两个字段；
 * 无坐标但有地址的 POI 保持既有的正向解析行为。解析失败仅记录告警，从而保证 REST、
 * MCP 和控制台导入都可以保存原始业务数据。</p>
 */
@ApplicationScoped
public class ScenarioLocationEnricher {

    private static final Logger LOGGER = Logger.getLogger(ScenarioLocationEnricher.class);

    @Inject
    MapAdapterSelector mapAdapterSelector;

    /** Kept package-visible only for existing isolated tests; production uses the selector. */
    @Deprecated
    AmapAdapter amapAdapter;

    public void enrich(Scenario scenario) {
        if (scenario == null || scenario.getPlan() == null) {
            return;
        }

        RoutePlan plan = scenario.getPlan();
        Map<String, Resolution> cache = new HashMap<>();
        for (Depo depo : safeList(plan.getDepos())) {
            if (depo != null) {
                enrichPoi(depo.getLoc(), cache);
            }
        }
        for (AgentEachDay agent : safeList(plan.getAgents())) {
            if (agent != null) {
                enrichPoi(agent.getStartLoc(), cache);
            }
        }
        for (Ticket ticket : safeList(plan.getTickets())) {
            if (ticket != null) {
                enrichPoi(ticket.getLoc(), cache);
            }
        }
    }

    private void enrichPoi(POI target, Map<String, Resolution> cache) {
        if (target == null || "NoWhere".equals(target.id)) {
            return;
        }

        String coordinate = coordinate(target);
        Resolution resolution;
        if (coordinate != null) {
            if (!needsReverseGeocoding(target)) {
                return;
            }
            resolution = resolve(cache, "coordinate:" + coordinate, () -> mapAdapter().regeo(coordinate));
            if (resolution.poi != null) {
                copyMissingAddressAndCity(target, resolution.poi);
            }
        } else if (StringUtils.isNotBlank(target.address)) {
            String city = StringUtils.defaultString(target.cityname);
            resolution = resolve(cache, "address:" + city + "\u0000" + target.address,
                    () -> first(mapAdapter().geocode(target.address, city)));
            if (resolution.poi != null) {
                copyMissingForwardGeocodedFields(target, resolution.poi);
            }
        } else {
            return;
        }
    }

    private Resolution resolve(Map<String, Resolution> cache, String key, PoiLookup lookup) {
        Resolution cached = cache.get(key);
        if (cached != null) {
            return cached;
        }

        Resolution resolved;
        try {
            POI poi = lookup.lookup();
            resolved = new Resolution(poi == null || "NoWhere".equals(poi.id) ? null : poi);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            LOGGER.warnf(error, "Automatic scenario location enrichment interrupted: %s", key);
            resolved = Resolution.NOT_FOUND;
        } catch (Exception error) {
            LOGGER.warnf(error, "Automatic scenario location enrichment failed: %s", key);
            resolved = Resolution.NOT_FOUND;
        }
        cache.put(key, resolved);
        return resolved;
    }

    private static POI first(List<POI> pois) {
        return pois == null || pois.isEmpty() ? null : pois.getFirst();
    }

    private MapAdapter mapAdapter() {
        return amapAdapter != null ? amapAdapter : mapAdapterSelector.adapter();
    }

    private static boolean needsReverseGeocoding(POI poi) {
        return missing(poi.address) || missing(poi.cityname);
    }

    private static void copyMissingAddressAndCity(POI target, POI source) {
        target.address = missing(target.address) ? source.address : target.address;
        target.cityname = missing(target.cityname) ? source.cityname : target.cityname;
    }

    private static void copyMissingForwardGeocodedFields(POI target, POI source) {
        target.id = missing(target.id) ? source.id : target.id;
        target.name = missing(target.name) ? source.name : target.name;
        target.location = missing(target.location) ? source.location : target.location;
        target.loc = target.loc == null ? coordinateObject(source) : target.loc;
        target.address = missing(target.address) ? source.address : target.address;
        target.pcode = missing(target.pcode) ? source.pcode : target.pcode;
        target.type = missing(target.type) ? source.type : target.type;
        target.photos = (target.photos == null || target.photos.isEmpty()) ? source.photos : target.photos;
        target.gridcode = missing(target.gridcode) ? source.gridcode : target.gridcode;
        target.typecode = missing(target.typecode) ? source.typecode : target.typecode;
        target.citycode = missing(target.citycode) ? source.citycode : target.citycode;
        target.adname = missing(target.adname) ? source.adname : target.adname;
        target.entr_location = missing(target.entr_location) ? source.entr_location : target.entr_location;
        target.entr_loc = target.entr_loc == null ? entranceCoordinateObject(source) : target.entr_loc;
        target.adcode = missing(target.adcode) ? source.adcode : target.adcode;
        target.pname = missing(target.pname) ? source.pname : target.pname;
        target.cityname = missing(target.cityname) ? source.cityname : target.cityname;
    }

    private static boolean missing(String value) {
        return StringUtils.isBlank(value);
    }

    private static String coordinate(POI poi) {
        Coordinate parsed = parseCoordinate(poi.location);
        if (parsed != null) {
            return parsed.text();
        }
        // JSON 导入有时把“经度,纬度”直接放在地址字段中；它仍是用户输入，
        // 只用于选择逆地理编码路径，绝不回写该地址字段。
        parsed = parseCoordinate(poi.address);
        if (parsed != null) {
            return parsed.text();
        }
        if (poi.loc != null && validCoordinate(poi.loc.lon, poi.loc.lat)) {
            return formatCoordinate(poi.loc.lon, poi.loc.lat);
        }
        return null;
    }

    private static LOC coordinateObject(POI poi) {
        if (poi == null) {
            return null;
        }
        if (poi.loc != null && validCoordinate(poi.loc.lon, poi.loc.lat)) {
            return new LOC(poi.loc.lat, poi.loc.lon);
        }
        Coordinate coordinate = parseCoordinate(poi.location);
        return coordinate == null ? null : new LOC(coordinate.lat, coordinate.lng);
    }

    private static LOC entranceCoordinateObject(POI poi) {
        if (poi == null) {
            return null;
        }
        if (poi.entr_loc != null && validCoordinate(poi.entr_loc.lon, poi.entr_loc.lat)) {
            return new LOC(poi.entr_loc.lat, poi.entr_loc.lon);
        }
        Coordinate coordinate = parseCoordinate(poi.entr_location);
        return coordinate == null ? coordinateObject(poi) : new LOC(coordinate.lat, coordinate.lng);
    }

    private static Coordinate parseCoordinate(String value) {
        if (StringUtils.isBlank(value)) {
            return null;
        }
        String[] parts = value.split(",", -1);
        if (parts.length != 2) {
            return null;
        }
        try {
            double lng = Double.parseDouble(parts[0].trim());
            double lat = Double.parseDouble(parts[1].trim());
            return validCoordinate(lng, lat) ? new Coordinate(lng, lat) : null;
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    private static boolean validCoordinate(double lng, double lat) {
        return Double.isFinite(lng) && Double.isFinite(lat)
                && lng >= -180D && lng <= 180D && lat >= -90D && lat <= 90D;
    }

    private static String formatCoordinate(double lng, double lat) {
        return Double.toString(lng) + "," + Double.toString(lat);
    }

    private static <T> List<T> safeList(List<T> values) {
        return values == null ? List.of() : values;
    }

    @FunctionalInterface
    private interface PoiLookup {
        POI lookup() throws Exception;
    }

    private record Resolution(POI poi) {
        private static final Resolution NOT_FOUND = new Resolution(null);
    }

    private record Coordinate(double lng, double lat) {
        private String text() {
            return formatCoordinate(lng, lat);
        }
    }
}
