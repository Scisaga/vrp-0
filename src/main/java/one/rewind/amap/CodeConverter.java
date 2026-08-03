package one.rewind.amap;

import java.util.Map;
import java.util.SortedMap;
import java.util.TreeMap;

public class CodeConverter {

    SortedMap<String, String> codes;

    public CodeConverter(Map<String, String> rawCodes) {
        codes = new TreeMap<>(rawCodes);
    }

    public SortedMap<String, String> filter(String prefix) {
        return filterPrefix(codes, prefix);
    }

    public <V> SortedMap<String, V> filterPrefix(SortedMap<String,V> baseMap, String prefix) {
        if(!prefix.isEmpty()) {
            char nextLetter = (char) (prefix.charAt(prefix.length() -1) + 1);
            String end = prefix.substring(0, prefix.length()-1) + nextLetter;
            return baseMap.subMap(prefix, end);
        }
        return baseMap;
    }
}
