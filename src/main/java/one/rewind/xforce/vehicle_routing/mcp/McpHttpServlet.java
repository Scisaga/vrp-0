package one.rewind.xforce.vehicle_routing.mcp;

import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;

public class McpHttpServlet extends HttpServlet {

    private final HttpServlet delegate;

    public McpHttpServlet(HttpServlet delegate) {
        this.delegate = delegate;
    }

    @Override
    protected void service(HttpServletRequest req, HttpServletResponse resp) throws ServletException, IOException {
        delegate.service(req, resp);
    }
}
