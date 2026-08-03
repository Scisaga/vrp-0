package one.rewind.here;

import one.rewind.xforce.geo.LOC;

import java.util.ArrayList;
import java.util.List;

/** Small, dependency-free decoder for HERE Flexible Polyline 2D/3D payloads. */
final class FlexiblePolyline {

    private static final String DECODING_TABLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

    private FlexiblePolyline() {
    }

    static List<LOC> decode(String encoded) {
        if (encoded == null || encoded.isBlank()) {
            throw new IllegalArgumentException("HERE polyline is empty");
        }
        Cursor cursor = new Cursor(encoded);
        long version = cursor.readUnsigned();
        if (version != 1) {
            throw new IllegalArgumentException("Unsupported HERE flexible polyline version: " + version);
        }
        long header = cursor.readUnsigned();
        int precision = (int) (header & 15);
        int thirdDimension = (int) ((header >>> 4) & 7);
        double factor = Math.pow(10, precision);
        int dimensions = thirdDimension == 0 ? 2 : 3;
        long latitude = 0;
        long longitude = 0;
        List<LOC> points = new ArrayList<>();
        while (cursor.hasRemaining()) {
            latitude += cursor.readSigned();
            longitude += cursor.readSigned();
            if (dimensions == 3) {
                cursor.readSigned();
            }
            // LOC's historical wire convention stores longitude in lat and latitude in lon.
            points.add(new LOC(longitude / factor, latitude / factor));
        }
        if (points.isEmpty()) {
            throw new IllegalArgumentException("HERE polyline contains no coordinates");
        }
        return points;
    }

    private static final class Cursor {
        private final String value;
        private int index;

        private Cursor(String value) {
            this.value = value;
        }

        private boolean hasRemaining() {
            return index < value.length();
        }

        private long readUnsigned() {
            long result = 0;
            int shift = 0;
            while (true) {
                if (!hasRemaining()) {
                    throw new IllegalArgumentException("Truncated HERE flexible polyline");
                }
                int digit = DECODING_TABLE.indexOf(value.charAt(index++));
                if (digit < 0) {
                    throw new IllegalArgumentException("Invalid HERE flexible polyline character");
                }
                result |= (long) (digit & 31) << shift;
                if ((digit & 32) == 0) {
                    return result;
                }
                shift += 5;
                if (shift > 60) {
                    throw new IllegalArgumentException("Invalid HERE flexible polyline value");
                }
            }
        }

        private long readSigned() {
            long value = readUnsigned();
            return (value >>> 1) ^ -(value & 1);
        }
    }
}
