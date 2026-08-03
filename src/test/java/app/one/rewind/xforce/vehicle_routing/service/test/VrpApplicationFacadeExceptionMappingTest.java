package one.rewind.xforce.vehicle_routing.service.test;

import jakarta.inject.Inject;
import jakarta.ws.rs.core.Response;
import one.rewind.xforce.vehicle_routing.rest.exception.SolverJobException;
import one.rewind.xforce.vehicle_routing.service.VrpApplicationException;
import one.rewind.xforce.vehicle_routing.service.VrpApplicationFacade;
import one.rewind.xforce.vehicle_routing.service.VrpErrorCode;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Method;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;

@io.quarkus.test.junit.QuarkusTest
@Tag("app")
class VrpApplicationFacadeExceptionMappingTest {

    @Inject
    VrpApplicationFacade facade;

    @Test
    void mapSolverJobExceptionPreservesStackTraceStrategyForNoSolverJobFound() throws Exception {
        SolverJobException source = new SolverJobException(
                null,
                Response.Status.NOT_FOUND,
                "No SolverJob found",
                false
        );

        Method method = VrpApplicationFacade.class.getDeclaredMethod("mapSolverJobException", SolverJobException.class);
        method.setAccessible(true);

        VrpApplicationException mapped = (VrpApplicationException) method.invoke(facade, source);

        assertSame(Response.Status.NOT_FOUND, mapped.getStatus());
        assertSame(VrpErrorCode.SOLVER_JOB_NOT_FOUND, mapped.getErrorCode());
        assertEquals("No SolverJob found", mapped.getMessage());
        assertSame(source, mapped.getCause());
        assertFalse(mapped.shouldLogStackTrace());
    }
}
