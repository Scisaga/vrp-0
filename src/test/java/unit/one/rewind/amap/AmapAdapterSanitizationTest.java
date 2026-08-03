package one.rewind.amap;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

class AmapAdapterSanitizationTest {

    @Test
    void keepsNormalReverseGeocodeAddressUnchanged() {
        assertEquals(
                "北京市海淀区中关村大街27号",
                AmapAdapter.sanitizeReverseGeocodeAddress("北京市海淀区中关村大街27号")
        );
    }

    @Test
    void removesLeadingNullSegmentsFromReverseGeocodeAddress() {
        assertEquals(
                "北京市朝阳区阜通东大街6号",
                AmapAdapter.sanitizeReverseGeocodeAddress("null,null,北京市朝阳区阜通东大街6号")
        );
    }

    @Test
    void removesLeadingEmptySegmentsFromReverseGeocodeAddress() {
        assertEquals(
                "北京市朝阳区酒仙桥路10号",
                AmapAdapter.sanitizeReverseGeocodeAddress(",,北京市朝阳区酒仙桥路10号")
        );
    }

    @Test
    void geocodeFallbackIdsStayStableAndDoNotMergeDifferentAddressesInOneAdcode() {
        String first = AmapAdapter.stableGeocodePoiId("116.397128,39.916527", "北京市东城区东华门大街");
        String same = AmapAdapter.stableGeocodePoiId("116.397128,39.916527", "北京市东城区东华门大街");
        String second = AmapAdapter.stableGeocodePoiId("116.397629,39.916782", "北京市东城区景山前街");

        assertEquals(first, same);
        assertNotEquals(first, second);
    }
}
