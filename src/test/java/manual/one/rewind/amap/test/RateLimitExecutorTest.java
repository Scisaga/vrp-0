package one.rewind.amap.test;

import one.rewind.amap.RateLimitExecutor;
import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.time.Duration;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeoutException;

@Disabled("Manual script: requires explicit local data, external dependency, report generation, or long-running solver flow.")
@Tag("manual")
public class RateLimitExecutorTest {


    // TODO 需要调整测试用例格式
    @Test
    public void test0() {

        RateLimitExecutor<String> rle = new RateLimitExecutor<>("Default", 2, 10, Duration.ofSeconds(10), Duration.ofSeconds(2));

        for(int i=0; i<100; i++) {

            try {
                System.err.println(i);
                long t1 = System.currentTimeMillis();
                rle.exec(() -> "AAA");
                long duration = System.currentTimeMillis() - t1;

                System.err.println("Exec in " + duration + "ms");

            } catch (RateLimitExecutor.QuotaExhaustedException | ExecutionException | TimeoutException |
                     InterruptedException e) {
                System.err.println(e.getClass().getName() + " " + e.getMessage());
            }
        }
    }

    @Test
    public void test00() throws InterruptedException {

        RateLimitExecutor<String> rle = new RateLimitExecutor<>("Default", 2, 10, Duration.ofSeconds(10), Duration.ofSeconds(2));

        for(int k=0; k<2; k++) {
            int finalK = k;
            new Thread(){
                @Override
                public void run() {
                    for(int i=0; i<50; i++) {

                        try {
                            System.err.println(finalK + "-" + i);
                            long t1 = System.currentTimeMillis();
                            rle.exec(() -> "AAA");
                            long duration = System.currentTimeMillis() - t1;

                            System.err.println("Exec in " + duration + "ms");

                        } catch (RateLimitExecutor.QuotaExhaustedException | ExecutionException | TimeoutException |
                                 InterruptedException e) {
                            System.err.println(e.getClass().getName() + " " + e.getMessage());
                        }
                    }
                }
            }.start();
        }

        Thread.sleep(60000);
    }

    @Test
    public void test1() {

        RateLimitExecutor<String> rle = new RateLimitExecutor<>("Default", 2, 10, Duration.ofSeconds(10), Duration.ofSeconds(2));

        for(int i=0; i<100; i++) {

            try {
                System.err.println(i);
                long t1 = System.currentTimeMillis();
                int finalI = i;

                rle.exec(() -> {
                    if(finalI % 2 == 0){
                        Thread.sleep(2500);
                    }
                    else {
                        throw new IOException("No reason");
                    }

                    return "BBB";
                });
                long duration = System.currentTimeMillis() - t1;

                System.err.println("Exec in " + duration + "ms");

            } catch (RateLimitExecutor.QuotaExhaustedException | ExecutionException | TimeoutException |
                     InterruptedException e) {
                System.err.println(e.getClass().getName() + " " + e.getMessage());
            }
        }
    }
}
