package one.rewind.xforce.vehicle_routing.service.test;

import one.rewind.xforce.vehicle_routing.service.SingletonOperationCoordinator;
import org.junit.jupiter.api.Test;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SingletonOperationCoordinatorTest {

    @Test
    void withLockSerializesConcurrentCalls() throws Exception {
        SingletonOperationCoordinator coordinator = new SingletonOperationCoordinator();
        AtomicInteger activeCalls = new AtomicInteger();
        AtomicInteger maxConcurrentCalls = new AtomicInteger();
        CountDownLatch firstEntered = new CountDownLatch(1);
        CountDownLatch releaseFirst = new CountDownLatch(1);

        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<?> first = executor.submit(() -> coordinator.withLock(() -> {
                int current = activeCalls.incrementAndGet();
                maxConcurrentCalls.accumulateAndGet(current, Math::max);
                firstEntered.countDown();
                await(releaseFirst);
                activeCalls.decrementAndGet();
            }));

            assertTrue(firstEntered.await(2, TimeUnit.SECONDS));

            Future<?> second = executor.submit(() -> coordinator.withLock(() -> {
                int current = activeCalls.incrementAndGet();
                maxConcurrentCalls.accumulateAndGet(current, Math::max);
                activeCalls.decrementAndGet();
            }));

            Thread.sleep(200);
            assertEquals(1, activeCalls.get());

            releaseFirst.countDown();
            first.get(2, TimeUnit.SECONDS);
            second.get(2, TimeUnit.SECONDS);

            assertEquals(1, maxConcurrentCalls.get());
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    void withLockSupplierReturnsResult() {
        SingletonOperationCoordinator coordinator = new SingletonOperationCoordinator();
        String result = coordinator.withLock(() -> "ok");
        assertEquals("ok", result);
    }

    private void await(CountDownLatch latch) {
        try {
            latch.await(2, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AssertionError("Interrupted while waiting on test latch", e);
        }
    }
}
