package one.rewind.xforce.vehicle_routing.store;

import com.fasterxml.jackson.core.JsonProcessingException;
import one.rewind.xforce.json.OM;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.UUID;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;

public final class FileStoreUtil {

    private FileStoreUtil() {}

    public static void ensureDir(Path dir) throws IOException {
        Files.createDirectories(dir);
    }

    public static void writeJsonAtomic(Path path, Object value) throws IOException {
        byte[] bytes;
        try {
            bytes = OM.toJson(value).getBytes(StandardCharsets.UTF_8);
        } catch (JsonProcessingException e) {
            throw new IOException("Serialize json failed: " + path, e);
        }
        writeBytesAtomic(path, bytes);
    }

    public static <T> T readJson(Path path, Class<T> type) throws IOException {
        if (!Files.exists(path)) {
            return null;
        }
        byte[] bytes = Files.readAllBytes(path);
        try {
            return OM.fromJson(new String(bytes, StandardCharsets.UTF_8), type);
        } catch (JsonProcessingException e) {
            throw new IOException("Parse json failed: " + path, e);
        }
    }

    public static void writeGzipJsonAtomic(Path path, Object value) throws IOException {
        byte[] jsonBytes;
        try {
            jsonBytes = OM.toJson(value).getBytes(StandardCharsets.UTF_8);
        } catch (JsonProcessingException e) {
            throw new IOException("Serialize json failed: " + path, e);
        }

        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        try (GZIPOutputStream gos = new GZIPOutputStream(bos)) {
            gos.write(jsonBytes);
        }
        writeBytesAtomic(path, bos.toByteArray());
    }

    public static <T> T readGzipJson(Path path, Class<T> type) throws IOException {
        if (!Files.exists(path)) {
            return null;
        }
        byte[] bytes = Files.readAllBytes(path);
        try (InputStream bis = new ByteArrayInputStream(bytes);
             GZIPInputStream gis = new GZIPInputStream(bis);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = gis.read(buffer)) >= 0) {
                out.write(buffer, 0, read);
            }
            String json = out.toString(StandardCharsets.UTF_8);
            return OM.fromJson(json, type);
        } catch (JsonProcessingException e) {
            throw new IOException("Parse gzip json failed: " + path, e);
        }
    }

    public static void writeBytesAtomic(Path path, byte[] bytes) throws IOException {
        Path dir = path.getParent();
        if (dir != null) {
            ensureDir(dir);
        }
        Path tmp = path.resolveSibling(path.getFileName().toString() + ".tmp-" + UUID.randomUUID());
        try (OutputStream out = Files.newOutputStream(tmp)) {
            out.write(bytes);
        }
        moveAtomic(tmp, path);
    }

    public static void deleteIfExists(Path path) throws IOException {
        Files.deleteIfExists(path);
    }

    private static void moveAtomic(Path src, Path dst) throws IOException {
        try {
            Files.move(src, dst, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException e) {
            Files.move(src, dst, StandardCopyOption.REPLACE_EXISTING);
        }
    }
}
