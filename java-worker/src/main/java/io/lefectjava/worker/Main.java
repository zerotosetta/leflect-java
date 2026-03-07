package io.lefectjava.worker;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class Main {
    private Main() {}

    public static void main(String[] args) {
        WorkerOptions options = WorkerOptions.parse(args);

        if (options.isHelp()) {
            printHelp();
            return;
        }

        if (!"parse-java".equals(options.command())) {
            System.err.println("Unknown command: " + options.command());
            printHelp();
            System.exit(1);
            return;
        }

        try {
            Path outDir = options.outDir();
            Files.createDirectories(outDir);

            List<String> files = options.manifestPath() != null
                ? ManifestReader.readFiles(options.manifestPath())
                : List.of();

            String payload = JsonWriter.writeIndexPayload(files);
            Path output = outDir.resolve("java-index.json");
            Files.writeString(output, payload, StandardCharsets.UTF_8);

            System.out.println("java-worker: wrote " + output.toAbsolutePath());
        } catch (IOException e) {
            System.err.println("java-worker error: " + e.getMessage());
            System.exit(1);
        }
    }

    private static void printHelp() {
        System.out.println("LeflectJava Java Worker");
        System.out.println("\nUsage:");
        System.out.println("  java -jar leflectjava-java-worker.jar parse-java --manifest <path> --out <dir>");
    }

    static final class WorkerOptions {
        private final String command;
        private final Path manifestPath;
        private final Path outDir;
        private final boolean help;

        private WorkerOptions(String command, Path manifestPath, Path outDir, boolean help) {
            this.command = command;
            this.manifestPath = manifestPath;
            this.outDir = outDir;
            this.help = help;
        }

        static WorkerOptions parse(String[] args) {
            if (args.length == 0 || "--help".equals(args[0]) || "-h".equals(args[0])) {
                return new WorkerOptions("help", null, Path.of("."), true);
            }

            String command = args[0];
            Path manifestPath = null;
            Path outDir = Path.of("analysis", "java-worker");

            for (int i = 1; i < args.length; i += 1) {
                String arg = args[i];
                if ("--manifest".equals(arg) && i + 1 < args.length) {
                    manifestPath = Path.of(args[i + 1]);
                    i += 1;
                } else if ("--out".equals(arg) && i + 1 < args.length) {
                    outDir = Path.of(args[i + 1]);
                    i += 1;
                }
            }

            return new WorkerOptions(command, manifestPath, outDir, false);
        }

        String command() {
            return command;
        }

        Path manifestPath() {
            return manifestPath;
        }

        Path outDir() {
            return outDir;
        }

        boolean isHelp() {
            return help;
        }
    }

    static final class ManifestReader {
        private static final Pattern FILES_SECTION = Pattern.compile("\\\"files\\\"\\s*:\\s*\\[(.*?)\\]", Pattern.DOTALL);
        private static final Pattern STRING_VALUE = Pattern.compile("\\\"(.*?)\\\"");

        private ManifestReader() {}

        static List<String> readFiles(Path manifestPath) throws IOException {
            String content = Files.readString(manifestPath, StandardCharsets.UTF_8);
            Matcher section = FILES_SECTION.matcher(content);
            if (!section.find()) {
                return List.of();
            }

            String body = section.group(1);
            Matcher values = STRING_VALUE.matcher(body);
            List<String> files = new ArrayList<>();
            while (values.find()) {
                files.add(values.group(1));
            }
            return files;
        }
    }

    static final class JsonWriter {
        private JsonWriter() {}

        static String writeIndexPayload(List<String> files) {
            StringBuilder builder = new StringBuilder();
            builder.append("{\n");
            builder.append("  \"generatedAt\": \"").append(Instant.now().toString()).append("\",\n");
            builder.append("  \"fileCount\": ").append(files.size()).append(",\n");
            builder.append("  \"files\": ");
            builder.append("[\n");
            for (int i = 0; i < files.size(); i += 1) {
                builder.append("    \"").append(escape(files.get(i))).append("\"");
                if (i < files.size() - 1) {
                    builder.append(",");
                }
                builder.append("\n");
            }
            builder.append("  ]\n");
            builder.append("}\n");
            return builder.toString();
        }

        private static String escape(String value) {
            return value.replace("\\\\", "\\\\\\\\").replace("\"", "\\\\\"");
        }
    }
}
