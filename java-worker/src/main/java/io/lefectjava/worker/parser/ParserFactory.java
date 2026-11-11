package io.lefectjava.worker.parser;

import com.github.javaparser.JavaParser;
import com.github.javaparser.ParserConfiguration;
import com.github.javaparser.symbolsolver.resolution.typesolvers.ClassLoaderTypeSolver;
import com.github.javaparser.symbolsolver.resolution.typesolvers.CombinedTypeSolver;
import com.github.javaparser.symbolsolver.resolution.typesolvers.JavaParserTypeSolver;
import com.github.javaparser.symbolsolver.resolution.typesolvers.JarTypeSolver;

import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.Path;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.nio.file.Files;

public class ParserFactory {
  private static final Pattern PACKAGE_PATTERN =
      Pattern.compile("(?m)^\\s*package\\s+([\\w.]+)\\s*;");

  private ParserFactory() {
  }

  public static JavaParser createJavaParser() {
    return new JavaParser();
  }

  public static JavaParser createJavaParser(
      Path root,
      List<Path> sourceFiles,
      List<String> classpathEntries
  ) {
    return createJavaParser(root, sourceFiles, classpathEntries, false);
  }

  public static JavaParser createJavaParser(
      Path root,
      List<Path> sourceFiles,
      List<String> classpathEntries,
      boolean isolatedClasspath
  ) {
    CombinedTypeSolver typeSolver = new CombinedTypeSolver();

    for (Path sourceRoot : discoverSourceRoots(root, sourceFiles)) {
      typeSolver.add(new JavaParserTypeSolver(sourceRoot));
    }

    URLClassLoader classLoader = createClasspathClassLoader(classpathEntries, isolatedClasspath);
    if (classpathEntries != null) {
      for (String entry : classpathEntries) {
        Path binary = Path.of(entry).normalize();
        if (Files.isDirectory(binary) && classLoader != null) {
          typeSolver.add(new ClassLoaderTypeSolver(classLoader) {
            @Override protected boolean filterName(String name) {
              return containsBinaryClass(binary, name);
            }
          });
        } else if (Files.isRegularFile(binary) && entry.toLowerCase(java.util.Locale.ROOT).endsWith(".jar")) {
          try {
            // Read signatures without loading every reflected method. Optional
            // API types (e.g. JSP's ELContext) may be absent from the project.
            typeSolver.add(new JarTypeSolver(binary));
          } catch (java.io.IOException ignored) {
            // Invalid configured archives remain unresolved; never use worker APIs.
          }
        }
      }
    }
    // Platform delegation keeps Java SE (including javax.crypto/sql) available,
    // without exposing the worker's Jasper/Servlet implementation to analysis.
    typeSolver.add(new ClassLoaderTypeSolver(ClassLoader.getPlatformClassLoader()));

    ParserConfiguration configuration = new ParserConfiguration();
    configuration.setSymbolResolver(new AnalysisSymbolResolver(typeSolver));
    return new JavaParser(configuration);
  }

  private static boolean containsBinaryClass(Path directory, String qualifiedName) {
    String candidate = qualifiedName;
    while (true) {
      if (Files.isRegularFile(directory.resolve(candidate.replace('.', '/') + ".class"))) return true;
      int separator = candidate.lastIndexOf('.');
      if (separator < 0) return false;
      candidate = candidate.substring(0, separator) + "$" + candidate.substring(separator + 1);
    }
  }

  private static List<Path> discoverSourceRoots(Path root, List<Path> sourceFiles) {
    Set<Path> roots = new LinkedHashSet<>();

    for (Path sourceFile : sourceFiles) {
      Path normalized = sourceFile.isAbsolute() ? sourceFile.normalize() : root.resolve(sourceFile).normalize();
      Path sourceRoot = inferSourceRoot(normalized);
      if (sourceRoot != null && Files.isDirectory(sourceRoot)) {
        roots.add(sourceRoot);
      }
    }

    if (roots.isEmpty() && Files.isDirectory(root)) {
      roots.add(root.normalize());
    }

    return List.copyOf(roots);
  }

  private static Path inferSourceRoot(Path sourceFile) {
    Path parent = sourceFile.getParent();
    if (parent == null || !Files.exists(sourceFile)) {
      return parent;
    }

    String packageName = readPackageName(sourceFile);
    if (packageName == null || packageName.isBlank()) {
      return parent;
    }

    Path packagePath = Path.of("", packageName.split("\\."));
    if (!parent.endsWith(packagePath)) {
      return parent;
    }

    Path current = parent;
    for (int index = 0; index < packagePath.getNameCount(); index += 1) {
      current = current.getParent();
    }
    return current;
  }

  private static String readPackageName(Path sourceFile) {
    try {
      String content = Files.readString(sourceFile);
      Matcher matcher = PACKAGE_PATTERN.matcher(content);
      return matcher.find() ? matcher.group(1) : "";
    } catch (Exception ex) {
      return "";
    }
  }

  private static URLClassLoader createClasspathClassLoader(List<String> classpathEntries, boolean isolatedClasspath) {
    if (classpathEntries == null || classpathEntries.isEmpty()) {
      return null;
    }

    try {
      URL[] urls = classpathEntries.stream()
          .map(Path::of)
          .map(Path::normalize)
          .filter(Files::exists)
          // JarTypeSolver reads JAR signatures directly. Exclude JARs from the
          // snapshot class loader so manifest Class-Path cannot add live inputs.
          .filter(entry -> !isolatedClasspath || Files.isDirectory(entry))
          .map(ParserFactory::toUrl)
          .toArray(URL[]::new);

      if (urls.length == 0) {
        return null;
      }

      return new URLClassLoader(urls, ClassLoader.getPlatformClassLoader());
    } catch (Exception ex) {
      return null;
    }
  }

  private static URL toUrl(Path path) {
    try {
      return path.toUri().toURL();
    } catch (Exception ex) {
      throw new IllegalArgumentException("Invalid classpath entry: " + path, ex);
    }
  }
}
