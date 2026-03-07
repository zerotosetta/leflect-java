package io.lefectjava.worker.manifest;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.nio.file.Path;
import java.util.List;

public class JspInputManifest {
  public String root;
  public List<String> files;
  public String webappRoot;
  public String servletOutputDir;
  public String astOutputDir;
  public String errorLog;

  public static JspInputManifest fromFile(Path path) throws IOException {
    ObjectMapper mapper = new ObjectMapper();
    return mapper.readValue(path.toFile(), JspInputManifest.class);
  }
}
