package io.lefectjava.worker.parser;

import com.github.javaparser.JavaParser;
import com.github.javaparser.ParserConfiguration;
import com.github.javaparser.symbolsolver.JavaSymbolSolver;
import com.github.javaparser.symbolsolver.resolution.typesolvers.ClassLoaderTypeSolver;
import com.github.javaparser.symbolsolver.resolution.typesolvers.CombinedTypeSolver;
import com.github.javaparser.symbolsolver.resolution.typesolvers.JavaParserTypeSolver;
import com.github.javaparser.symbolsolver.resolution.typesolvers.ReflectionTypeSolver;

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
    CombinedTypeSolver typeSolver = new CombinedTypeSolver();
    typeSolver.add(new ReflectionTypeSolver());

    for (Path sourceRoot : discoverSourceRoots(root, sourceFiles)) {
      typeSolver.add(new JavaParserTypeSolver(sourceRoot));
    }

    URLClassLoader classLoader = createClasspathClassLoader(classpathEntries);
    if (classLoader != null) {
      typeSolver.add(new ClassLoaderTypeSolver(classLoader));
    }

    ParserConfiguration configuration = new ParserConfiguration();
    configuration.setSymbolResolver(new JavaSymbolSolver(typeSolver));
    return new JavaParser(configuration);
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

  private static URLClassLoader createClasspathClassLoader(List<String> classpathEntries) {
    if (classpathEntries == null || classpathEntries.isEmpty()) {
      return null;
    }

    try {
      URL[] urls = classpathEntries.stream()
          .map(Path::of)
          .map(Path::normalize)
          .filter(Files::exists)
          .map(ParserFactory::toUrl)
          .toArray(URL[]::new);

      if (urls.length == 0) {
        return null;
      }

      return new URLClassLoader(urls, ParserFactory.class.getClassLoader());
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
