package io.lefectjava.worker.io;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;

import java.io.BufferedWriter;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

public class JsonWriters {
  private static final ObjectMapper JSONL_MAPPER = new ObjectMapper();

  private JsonWriters() {
  }

  public static ObjectMapper createMapper() {
    ObjectMapper mapper = new ObjectMapper();
    mapper.enable(SerializationFeature.INDENT_OUTPUT);
    return mapper;
  }

  public static void writeJson(ObjectMapper mapper, Path target, Object payload) throws IOException {
    if (target.getParent() != null) {
      Files.createDirectories(target.getParent());
    }
    mapper.writeValue(target.toFile(), payload);
  }

  public static void appendJsonLine(BufferedWriter writer, Object payload) throws IOException {
    writer.write(toJsonLine(payload));
    writer.newLine();
  }

  public static String toJsonLine(Object payload) throws IOException {
    return JSONL_MAPPER.writeValueAsString(payload);
  }
}
