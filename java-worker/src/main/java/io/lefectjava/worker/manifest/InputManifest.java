package io.lefectjava.worker.manifest;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.nio.file.Path;
import java.util.List;

public class InputManifest {
  public String root;
  public List<String> files;
  public String outputDir;
  public String errorLog;

  public static InputManifest fromFile(Path path) throws IOException {
    ObjectMapper mapper = new ObjectMapper();
    return mapper.readValue(path.toFile(), InputManifest.class);
  }
}
