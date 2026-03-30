package io.lefectjava.worker.model;

import java.io.PrintWriter;
import java.io.StringWriter;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class ParseProblemSupport {
  private static final Pattern ABSOLUTE_URI_PATTERN =
      Pattern.compile("absolute uri:\\s*\\[(.+?)\\]\\s*cannot be resolved", Pattern.CASE_INSENSITIVE);
  private static final Pattern MISSING_CLASS_PATTERN =
      Pattern.compile("(?:NoClassDefFoundError|ClassNotFoundException):\\s*([A-Za-z0-9_/$\\.]+)");
  private static final Pattern MISSING_JSP_PATH_PATTERN =
      Pattern.compile("JSP file\\s*\\[([^\\]]+)\\]\\s*not found", Pattern.CASE_INSENSITIVE);
  private static final Pattern MISSING_RESOURCE_PATH_PATTERN =
      Pattern.compile("path\\s*\\[([^\\]]+)\\].*?The specified path does not exist", Pattern.CASE_INSENSITIVE);
  private static final Pattern LOCATION_PATTERN =
      Pattern.compile("\\(line:\\s*\\[(\\d+)\\],\\s*column:\\s*\\[(\\d+)\\]\\)");
  private static final Pattern GENERIC_ERROR_COUNT_PATTERN =
      Pattern.compile("^Generation completed with \\[\\d+\\] errors? in \\[\\d+\\] milliseconds$");

  private ParseProblemSupport() {
  }

  public static void populateThrowableDetails(
      ParseProblemRecord record,
      Throwable error,
      String diagnostics
  ) {
    if (error == null) {
      return;
    }

    List<Throwable> chain = flatten(error);
    Throwable rootCause = chain.get(chain.size() - 1);

    record.exceptionClass = error.getClass().getName();
    record.rootCauseClass = rootCause.getClass().getName();
    record.rootCauseMessage = firstNonBlank(rootCause.getMessage(), rootCause.toString());
    record.rawCause = rootCause.toString();
    record.causeChain = chain.stream().map(ParseProblemSupport::formatThrowable).toList();
    record.stackTrace = buildStackTrace(error);
    record.workerDiagnostics = blankToNull(diagnostics);

    List<String> extractedUris = extractUnresolvedTaglibUris(composeEvidence(error, diagnostics));
    if (!extractedUris.isEmpty()) {
      record.unresolvedTaglibUris = extractedUris;
    }

    List<String> missingClasses = extractMissingClasses(composeEvidence(error, diagnostics));
    if (!missingClasses.isEmpty()) {
      record.missingClasses = missingClasses;
    }

    List<String> missingPaths = extractMissingPaths(composeEvidence(error, diagnostics));
    if (!missingPaths.isEmpty()) {
      record.missingPaths = missingPaths;
    }

    String meaningfulMessage = selectMeaningfulMessage(chain, diagnostics);
    if (meaningfulMessage != null && !meaningfulMessage.isBlank()) {
      record.message = meaningfulMessage;
    }
  }

  public static SourceLocation extractFirstLocation(String... texts) {
    for (String text : texts) {
      if (text == null || text.isBlank()) {
        continue;
      }

      Matcher matcher = LOCATION_PATTERN.matcher(text);
      if (matcher.find()) {
        Integer line = parseInteger(matcher.group(1));
        Integer column = parseInteger(matcher.group(2));
        if (line != null && column != null) {
          return new SourceLocation(line, column, line, column);
        }
      }
    }
    return null;
  }

  public static String buildSnippet(String sourceContent, SourceLocation location) {
    if (sourceContent == null || location == null || location.line == null) {
      return null;
    }

    String[] lines = sourceContent.split("\\R", -1);
    int index = location.line - 1;
    if (index < 0 || index >= lines.length) {
      return null;
    }

    return lines[index].trim();
  }

  public static List<String> extractUnresolvedTaglibUris(String... texts) {
    Set<String> values = new LinkedHashSet<>();
    for (String text : texts) {
      if (text == null || text.isBlank()) {
        continue;
      }
      Matcher matcher = ABSOLUTE_URI_PATTERN.matcher(text);
      while (matcher.find()) {
        values.add(matcher.group(1));
      }
    }
    return new ArrayList<>(values);
  }

  public static List<String> extractMissingClasses(String... texts) {
    Set<String> values = new LinkedHashSet<>();
    for (String text : texts) {
      if (text == null || text.isBlank()) {
        continue;
      }
      Matcher matcher = MISSING_CLASS_PATTERN.matcher(text);
      while (matcher.find()) {
        String rawValue = matcher.group(1);
        if (rawValue != null && !rawValue.isBlank()) {
          values.add(rawValue.replace('/', '.'));
        }
      }
    }
    return new ArrayList<>(values);
  }

  public static List<String> extractMissingPaths(String... texts) {
    Set<String> values = new LinkedHashSet<>();
    for (String text : texts) {
      if (text == null || text.isBlank()) {
        continue;
      }
      collectPatternValues(values, MISSING_JSP_PATH_PATTERN, text);
      collectPatternValues(values, MISSING_RESOURCE_PATH_PATTERN, text);
    }
    return new ArrayList<>(values);
  }

  private static void collectPatternValues(Set<String> values, Pattern pattern, String text) {
    Matcher matcher = pattern.matcher(text);
    while (matcher.find()) {
      String value = matcher.group(1);
      if (value != null && !value.isBlank()) {
        values.add(value);
      }
    }
  }

  private static List<Throwable> flatten(Throwable error) {
    List<Throwable> chain = new ArrayList<>();
    Throwable current = error;
    while (current != null && !chain.contains(current)) {
      chain.add(current);
      current = current.getCause();
    }
    return chain;
  }

  private static String formatThrowable(Throwable error) {
    String message = blankToNull(error.getMessage());
    return message == null
        ? error.getClass().getName()
        : error.getClass().getName() + ": " + message;
  }

  private static String buildStackTrace(Throwable error) {
    StringWriter writer = new StringWriter();
    error.printStackTrace(new PrintWriter(writer));
    return writer.toString().trim();
  }

  private static String selectMeaningfulMessage(List<Throwable> chain, String diagnostics) {
    for (int index = chain.size() - 1; index >= 0; index -= 1) {
      String message = blankToNull(chain.get(index).getMessage());
      if (isMeaningfulMessage(message)) {
        return message;
      }
    }

    for (Throwable error : chain) {
      String message = blankToNull(error.getMessage());
      if (isMeaningfulMessage(message)) {
        return message;
      }
    }

    if (diagnostics != null) {
      for (String line : diagnostics.split("\\R")) {
        String candidate = blankToNull(line);
        if (candidate != null && !candidate.startsWith("INFO:")) {
          return candidate;
        }
      }
    }

    return null;
  }

  private static boolean isMeaningfulMessage(String value) {
    return value != null && !GENERIC_ERROR_COUNT_PATTERN.matcher(value).matches();
  }

  private static String[] composeEvidence(Throwable error, String diagnostics) {
    List<String> values = new ArrayList<>();
    Throwable current = error;
    while (current != null) {
      values.add(blankToNull(current.getMessage()));
      values.add(current.toString());
      current = current.getCause();
    }
    values.add(blankToNull(diagnostics));
    return values.toArray(String[]::new);
  }

  private static Integer parseInteger(String value) {
    if (value == null || value.isBlank()) {
      return null;
    }
    return Integer.parseInt(value);
  }

  private static String blankToNull(String value) {
    return value == null || value.isBlank() ? null : value;
  }

  private static String firstNonBlank(String... values) {
    for (String value : values) {
      if (value != null && !value.isBlank()) {
        return value;
      }
    }
    return null;
  }
}
