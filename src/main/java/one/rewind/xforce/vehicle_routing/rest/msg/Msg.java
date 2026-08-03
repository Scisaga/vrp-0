package one.rewind.xforce.vehicle_routing.rest.msg;

import io.quarkus.runtime.annotations.RegisterForReflection;

@RegisterForReflection(serialization = true)
public record Msg(int code, String msg) {

    public static Msg Success() {
        return new Msg(1, "success");
    }

    public static Msg Failure() {
        return new Msg(0, "failure");
    }
}
