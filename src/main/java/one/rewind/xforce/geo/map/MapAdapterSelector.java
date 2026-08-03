package one.rewind.xforce.geo.map;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import one.rewind.amap.AmapAdapter;
import one.rewind.here.HereAdapter;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/** Selects exactly one provider for the lifetime of a process. */
@ApplicationScoped
public class MapAdapterSelector {

    private final MapProvider provider;
    private final MapAdapter adapter;

    @Inject
    public MapAdapterSelector(
            AmapAdapter amapAdapter,
            HereAdapter hereAdapter,
            @ConfigProperty(name = "map.provider", defaultValue = "AMAP") String configuredProvider
    ) {
        this.provider = MapProvider.parse(configuredProvider);
        this.adapter = provider == MapProvider.AMAP ? amapAdapter : hereAdapter;
    }

    public MapProvider provider() {
        return provider;
    }

    public MapAdapter adapter() {
        return adapter;
    }

    public void requireEnabled() {
        adapter.requireEnabled();
    }
}
