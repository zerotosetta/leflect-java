package io.lefectjava.worker.parser;

import com.github.javaparser.JavaParser;

public class ParserFactory {
  private ParserFactory() {
  }

  public static JavaParser createJavaParser() {
    return new JavaParser();
  }
}
