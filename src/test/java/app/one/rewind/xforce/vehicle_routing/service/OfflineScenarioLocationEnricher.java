package one.rewind.xforce.vehicle_routing.service;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Alternative;
import one.rewind.xforce.vehicle_routing.db.dto.Scenario;

/**
 * Stable REST/MCP fixtures already contain coordinates and use local matrices.
 * Only the stable Gradle test tasks select this alternative; external tests do not.
 * Location enrichment itself is covered by ScenarioLocationEnricherTest.
 */
@Alternative
@ApplicationScoped
public class OfflineScenarioLocationEnricher extends ScenarioLocationEnricher {

    @Override
    public void enrich(Scenario scenario) {
        // Keep fixture data unchanged without calling a real geocoding service.
    }
}
