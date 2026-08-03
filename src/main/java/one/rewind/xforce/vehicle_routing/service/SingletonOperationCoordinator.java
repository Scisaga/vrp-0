package one.rewind.xforce.vehicle_routing.service;

import jakarta.enterprise.context.ApplicationScoped;

import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Supplier;

@ApplicationScoped
public class SingletonOperationCoordinator {

    private final ReentrantLock lock = new ReentrantLock();

    public void withLock(Runnable action) {
        lock.lock();
        try {
            action.run();
        } finally {
            lock.unlock();
        }
    }

    public <T> T withLock(Supplier<T> action) {
        lock.lock();
        try {
            return action.get();
        } finally {
            lock.unlock();
        }
    }
}
