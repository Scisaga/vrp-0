package one.rewind.xforce.geo.map;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class MapProviderTest {

    @Test
    void parsesConfiguredProviderCaseInsensitivelyAndRejectsInvalidValues() {
        assertEquals(MapProvider.AMAP, MapProvider.parse("amap"));
        assertEquals(MapProvider.HERE, MapProvider.parse(" HERE "));
        assertThrows(IllegalArgumentException.class, () -> MapProvider.parse("google"));
        assertThrows(IllegalArgumentException.class, () -> MapProvider.parse(""));
    }
}
