package io.lefectjava.worker.jsp;

import org.apache.jasper.JspC;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Collectors;

public class JasperJspCompiler {
  public Path compile(Path webappRoot, Path jspSource, Path servletOutputRoot) throws Exception {
    Path absoluteJsp = jspSource.isAbsolute() ? jspSource : webappRoot.resolve(jspSource);
    Path relativeJsp = webappRoot.relativize(absoluteJsp);
    Path outputDir = servletOutputRoot.resolve(sanitize(relativeJsp.toString()));
    Files.createDirectories(outputDir);

    JspC jspc = new JspC();
    jspc.setUriroot(webappRoot.toString());
    jspc.setOutputDir(outputDir.toString());
    jspc.setCompile(false);
    jspc.setJspFiles(relativeJsp.toString().replace("\\", "/"));
    jspc.execute();

    List<Path> generatedFiles = listJavaFiles(outputDir);
    if (generatedFiles.isEmpty()) {
      throw new IOException("Jasper did not generate servlet java for " + relativeJsp);
    }

    return generatedFiles.get(0);
  }

  private List<Path> listJavaFiles(Path dir) throws IOException {
    try (var stream = Files.walk(dir)) {
      return stream
          .filter(path -> Files.isRegularFile(path) && path.toString().endsWith(".java"))
          .sorted(Comparator.naturalOrder())
          .collect(Collectors.toList());
    }
  }

  private String sanitize(String value) {
    return value.replace("\\", "_").replace("/", "_").replace(".", "_");
  }
}
