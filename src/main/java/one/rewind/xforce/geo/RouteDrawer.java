package one.rewind.xforce.geo;

import one.rewind.amap.AmapAdapter;
import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.domain.agent.Agent;
import org.apache.commons.lang3.tuple.ImmutablePair;
import org.apache.commons.lang3.tuple.Pair;

import java.awt.*;
import java.util.*;
import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * https://lbs.amap.com/api/javascript-api/reference/overlay#marker
 */
public class RouteDrawer {

    public static final List<Color> colorPalette = Arrays.asList(
            new Color(0x0C89DF), new Color(0xff7f0e), new Color(0x31ED31),
            new Color(0xFA6263), new Color(0xA865EF), new Color(0x9E7167),
            new Color(0xe377c2), new Color(0x7f7f7f), new Color(0xBDBD5B),
            new Color(0x17becf)
    );

    public static String[] colors = colorPalette.stream().map(color -> String.format("#%02x%02x%02x",
            color.getRed(),
            color.getGreen(),
            color.getBlue()
    )).toArray(String[]::new);

    public static String tpl = """
        <!doctype html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta http-equiv="X-UA-Compatible" content="IE=edge">
            <meta name="viewport" content="initial-scale=1.0, user-scalable=no, width=device-width">
            <title>配送路径</title>
            <link rel="stylesheet" href="https://a.amap.com/jsapi_demos/static/demo-center/css/demo-center.css"/>
            <style>
                html, body, #container {
                    height: 100%;
                    width: 100%;
                }
        
                .amap-icon img {
                    width: 25px;
                    height: 34px;
                }
        
                .input-card .btn {
                    width: 9rem;
                }
        
                .input-card .btn:first-child {
                    margin-right: 1.3rem;
                }
            </style>
        </head>
        <body>
        <div id="container"></div>
        <div class="input-card" style="width:auto; padding:0; font-family: monospace;">
            {buttons}
        </div>
        <script type="text/javascript"
                src="https://webapi.amap.com/maps?v=1.4.15&key={amap_key}"></script>
        <script type="text/javascript">
            // 创建地图实例
            var map = new AMap.Map("container", {
                zoom: {zoom},
                mapStyle: "amap://styles/grey",
                center: [{center_lat}, {center_lon}],
                resizeEnable: true
            });
        
        {cmd}
        </script>
        </body>
        </html>
        """;

    public static String marker_tpl = """
            new AMap.Marker({
                position: new AMap.LngLat({lat}, {lon}),
                content: '<div style="padding:0.25rem;color:{color};white-space:nowrap;font-weight:bold;">{text}</div>',
                offset: new AMap.Pixel(-12, -24)
            })
            """;

    public static String polyline_tpl = """
            new AMap.Polyline({
                strokeColor: "{color}",
                path: [
                    {path_str}
                ]
            })
            """;

    LOC center;

    int zoom;

    List<List<Pair<String, Route>>> routes;

    /**
     *
     * @param zoom
     * @param rp
     */
    public RouteDrawer(int zoom, RoutePlan rp) {
        this(
            zoom,
            rp.getAgents().stream()
                .map(a -> {
                    List<Pair<String, Route>> routePair = new LinkedList<>();
                    int i = 0;
                    for(Route route : a.getRoutes()) {
                        if(i < a.getTickets().size()) {
                            routePair.add(new ImmutablePair<>(a.getTickets().get(i).getId(), route));
                        }
                        else {
                            routePair.add(new ImmutablePair<>(a.getId(), route));
                        }
                        i++;
                    }
                    return routePair;
                })
                .toList()
        );
    }

    /**
     *
     * @param zoom
     * @param routes
     */
    public RouteDrawer(int zoom, List<List<Pair<String, Route>>> routes) {
        List<LOC> allLoc = routes.stream()
                .filter(list -> list != null && !list.isEmpty())
                .flatMap(l -> l.stream().map(Pair::getValue))
                .filter(r -> r.polyline != null)
                .map(r -> r.polyline)
                .flatMap(Collection::stream)
                .toList();
        LOC reduce = allLoc.stream().reduce(new LOC(0, 0), (l0, l) -> new LOC(l0.lat + l.lat, l0.lon + l.lon));
        reduce.lon = reduce.lon / allLoc.size();
        reduce.lat = reduce.lat / allLoc.size();

        this.center = reduce;
        this.zoom = zoom;
        this.routes = routes;
    }

    /**
     *
     * @param route
     * @param color
     * @return
     */
    public String generatePolyline(Route route, String color) {
        String path_str = route.polyline.stream().map(p -> "new AMap.LngLat(" + p.lat + ", " + p.lon + ")").collect(Collectors.joining(","));
        return polyline_tpl.replaceAll("\\{path_str}", path_str).replaceAll("\\{color}", color).replaceAll("\\n+|\\s+", " ");
    }

    /**
     *
     * @param p
     * @param text
     * @param color
     * @return
     */
    public String generateMarker(LOC p, String text, String color) {
        return marker_tpl.replaceAll("\\{lat}", String.valueOf(p.lat))
                .replaceAll("\\{lon}", String.valueOf(p.lon))
                .replaceAll("\\{color}", String.valueOf(color))
                .replaceAll("\\{text}", String.valueOf(text))
                .replaceAll("\\n+|\\s+", " ");
    }

    /**
     *
     * @return
     */
    public String generateButtons() {

        String buttons1 = "<div>";
        String buttons2 = "<div>";

        int i = 0;
        for(var routes_ : routes) {
            if(routes_.size() > 0) {
                String color = colors[i % colors.length];

                String og_name = "og_" + i;
                buttons1 += "<input id=\"add_" + og_name + "\" type=\"button\" style=\"color:" + color + ";background: #333;\" value=\"+" + i + "\"/>";
                buttons2 += "<input id=\"remove_" + og_name + "\" type=\"button\" style=\"color:" + color + ";background: #333;\" value=\"-" + i + "\"/>";
                i++;
            }
        }
        buttons1 += "<input id=\"add_all\" type=\"button\" style=\"color:#fff;background:#333;\" value=\"++\"/></div>";
        buttons2 += "<input id=\"remove_all\" type=\"button\" style=\"color:#fff;background:#333;\" value=\"--\"/></div>";

        return buttons1 + buttons2;
    }

    /**
     *
     * @return
     */
    public String generateCmd() {

        String cmd = "";

        List<String> ogs = new LinkedList<>();

        int i = 0;
        for(var routes_ : routes) {

            if(!routes_.isEmpty()) {

                String color = colors[i % colors.length];

                String og_name = "og_" + i;

                String og = "    var " + og_name + " = new AMap.OverlayGroup([";

                og += routes_.stream().map(routePair -> {
                    Route r = routePair.getValue();

                    LinkedList<String> list = new LinkedList<>();
                    // list.add(generateMarker(r.origin, String.valueOf(finalI), color));
                    if (r.polyline != null) {
                        list.add(generatePolyline(r, color));
                        list.add(generateMarker(r.destination, routePair.getKey(), color));
                    }
                    return list;
                }).flatMap(Collection::stream).collect(Collectors.joining(",")) + "]);\n";

                og += "    function add_" + og_name + "() { map.add(" + og_name + "); }\n";
                og += "    function remove_" + og_name + "() { map.remove(" + og_name + "); }\n";
                og += "    document.getElementById(\"add_" + og_name + "\").onclick = add_" + og_name +";\n";
                og += "    document.getElementById(\"remove_" + og_name + "\").onclick = remove_" + og_name +";\n";
                og += "    map.add(" + og_name + ");\n\n";

                ogs.add(og_name);
                cmd += og;

                i++;
            }
        }

        cmd += "    function add_all() {  map.add(" + ogs.stream().collect(Collectors.joining(",", "[", "]")) + "); }\n";
        cmd += "    function remove_all() { map.remove(" +  ogs.stream().collect(Collectors.joining(",", "[", "]")) + "); }\n";
        cmd += "    document.getElementById(\"add_all\").onclick = add_all;\n";
        cmd += "    document.getElementById(\"remove_all\").onclick = remove_all;\n";

        return cmd;
    }

    /**
     * 生成HTML
     * TODO 使用@Inject
     * @return
     */
    public String generateHtml() {

        String amap_key = AmapAdapter.get().getConf().key();

        String buttons = generateButtons();
        String cmd = generateCmd();

        return tpl.replaceAll("\\{center_lat}", String.valueOf(center.lat))
                .replaceAll("\\{center_lon}", String.valueOf(center.lon))
                .replaceAll("\\{zoom}", String.valueOf(zoom))
                .replaceAll("\\{amap_key}", amap_key)
                .replaceAll("\\{buttons}", buttons)
                .replaceAll("\\{cmd}", cmd);
    }
}
