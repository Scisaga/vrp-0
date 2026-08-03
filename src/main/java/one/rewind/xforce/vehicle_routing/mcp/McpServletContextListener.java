package one.rewind.xforce.vehicle_routing.mcp;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.quarkus.arc.Arc;
import jakarta.servlet.DispatcherType;
import jakarta.servlet.FilterRegistration;
import jakarta.servlet.ServletContextEvent;
import jakarta.servlet.ServletContextListener;
import jakarta.servlet.ServletRegistration;
import jakarta.servlet.annotation.WebListener;

import java.util.EnumSet;

@WebListener
public class McpServletContextListener implements ServletContextListener {

    @Override
    public void contextInitialized(ServletContextEvent sce) {
        McpProperties properties = Arc.container().instance(McpProperties.class).get();
        if (!properties.enabled()) {
            return;
        }

        McpServerRuntime runtime = Arc.container().instance(McpServerRuntime.class).get();
        ObjectMapper objectMapper = Arc.container().instance(ObjectMapper.class).get();
        String path = properties.path();

        ServletRegistration.Dynamic servlet = sce.getServletContext()
                .addServlet("vrpMcpServlet", new McpHttpServlet(runtime.httpServlet()));
        servlet.setAsyncSupported(true);
        servlet.addMapping(path);
        if (!"/".equals(path)) {
            servlet.addMapping(path + "/");
        }

        FilterRegistration.Dynamic filter = sce.getServletContext()
                .addFilter("vrpMcpAuthFilter", new McpAuthFilter(properties, objectMapper));
        filter.setAsyncSupported(true);
        filter.addMappingForUrlPatterns(EnumSet.of(DispatcherType.REQUEST, DispatcherType.ASYNC), false, path);
        if (!"/".equals(path)) {
            filter.addMappingForUrlPatterns(EnumSet.of(DispatcherType.REQUEST, DispatcherType.ASYNC), false, path + "/");
        }
    }
}
