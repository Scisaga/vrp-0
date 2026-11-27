package one.rewind.xforce.geo.map;

/** Internal key for default-driving matrix requests; never contains credentials. */
public record MatrixRoutingKey(MapProvider provider, String profile, Point origin, Point destination) {

    public record Point(double longitude, double latitude, String routingId) {

        public static Point fromLocation(String location, String routingId) {
            if (location == null) {
                throw new IllegalArgumentException("Matrix route coordinate is missing");
            }
            String[] values = location.split(",", -1);
            if (values.length != 2) {
                throw new IllegalArgumentException("Invalid matrix route coordinate, expected lng,lat");
            }
            return new Point(Double.parseDouble(values[0].trim()), Double.parseDouble(values[1].trim()), routingId);
        }
    }
}
