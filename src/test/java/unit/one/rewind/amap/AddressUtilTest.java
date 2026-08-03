package one.rewind.amap;

import one.rewind.xforce.geo.POI;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;

class AddressUtilTest {

    @Test
    void addressHelpersExtractBuildingParts() {
        assertEquals("云海村3号楼", AddressUtil.clearAddrCellAndRoomInfo("云海村3号楼2单元301"));
        assertEquals("3", AddressUtil.getBuildingNumber("云海村3号楼"));
        assertEquals("A", AddressUtil.getBuildingNumber("云海村A座"));
        assertEquals("", AddressUtil.getBuildingNumber("云海村"));
        assertEquals("号楼", AddressUtil.getMostCommonQuantifier(List.of("1号楼", "2号楼", "A座")));
    }

    @Test
    void guessBestPoiReturnsNoWhereWhenNoSuggestionExists() throws Exception {
        POI result = AddressUtil.guessBestPOI("宁波市", "云海村3号楼", (city, address) -> List.of());

        assertSame(POI.NoWhere, result);
    }

    @Test
    void guessBestPoiAddsDefaultBuildingQuantifierForTrailingNumber() throws Exception {
        List<String> queried = new ArrayList<>();
        POI expected = poi("poi-3", "云海村3号楼");

        POI result = AddressUtil.guessBestPOI("宁波市", "云海村3", (city, address) -> {
            queried.add(address);
            return List.of(expected);
        });

        assertSame(expected, result);
        assertEquals(List.of("云海村3号楼"), queried);
    }

    @Test
    void guessBestPoiRetriesWithCommonQuantifierAndCorrectBuildingNumber() throws Exception {
        List<String> queried = new ArrayList<>();
        POI wrongBuilding = poi("poi-8", "云海村8栋");
        POI corrected = poi("poi-3", "云海村3栋");

        POI result = AddressUtil.guessBestPOI("宁波市", "云海村3", (city, address) -> {
            queried.add(address);
            if ("云海村3栋".equals(address)) {
                return List.of(corrected);
            }
            return List.of(wrongBuilding);
        });

        assertSame(corrected, result);
        assertEquals(List.of("云海村3号楼", "云海村3栋"), queried);
    }

    private static POI poi(String id, String name) {
        POI poi = new POI(id);
        poi.name = name;
        poi.address = "浙江省宁波市慈溪市" + name;
        poi.cityname = "宁波市";
        return poi;
    }
}
