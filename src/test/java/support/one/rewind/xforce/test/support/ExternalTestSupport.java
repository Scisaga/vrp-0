package one.rewind.xforce.test.support;

import org.junit.jupiter.api.Assumptions;

public final class ExternalTestSupport {

    private static final String PROPERTY = "vrp.external.enabled";
    private static final String ENV = "VRP_EXTERNAL_TESTS";

    private ExternalTestSupport() {}

    public static void requireExternalTestsEnabled() {
        String value = System.getProperty(PROPERTY);
        if (value == null || value.isBlank()) {
            value = System.getenv(ENV);
        }
        Assumptions.assumeTrue(
                Boolean.parseBoolean(value),
                "External tests are disabled. Set -D" + PROPERTY + "=true or " + ENV + "=true to run them."
        );
    }
}
